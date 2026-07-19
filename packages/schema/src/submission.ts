import { z } from "zod";

// Submission payload schema (docs/05-data-model-and-api.md §2). This is the single source of
// truth for validation on both client and server (NFR-M1). Data-minimization rule (§1): a field
// may exist only if it's required for an aggregate dimension, a plausibility gate, or
// reproducibility — nothing else. High-entropy values (full UA, GPU description, exact device
// memory, screen size, timezone, locale) are forbidden.

export const SCHEMA_VERSION = "1.0" as const;

export const MAX_PAYLOAD_BYTES = 32 * 1024;
export const MAX_CELLS = 16;

const StatValueSchema = z
  .object({
    median: z.number(),
    min: z.number(),
    max: z.number(),
  })
  .strict()
  .nullable();

// Only value documented in 05 §2 today; extend this whitelist (with an ADR, per 03 §7) as more
// flags are defined — deliberately not guessing undocumented values.
const FlagSchema = z.enum(["thermal_variance"]);

const EnvSchema = z
  .object({
    browser: z
      .object({
        family: z.enum(["chrome", "edge", "firefox", "safari", "other"]),
        major: z.number().int().nonnegative(),
      })
      .strict(),
    os: z
      .object({
        family: z.enum(["windows", "macos", "linux", "android", "ios", "other"]),
        version_coarse: z.string().nullable(),
      })
      .strict(),
    gpu: z
      .object({
        vendor: z.enum(["nvidia", "amd", "intel", "apple", "arm", "qualcomm", "other"]).nullable(),
        architecture: z.string().nullable(),
      })
      .strict(),
    webgpu: z
      .object({
        available: z.boolean(),
        features: z.array(z.enum(["shader-f16", "timestamp-query"])),
        limits: z
          .object({
            maxBufferSize: z.number().nonnegative(),
            maxStorageBufferBindingSize: z.number().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    wasm: z.object({ simd: z.boolean(), threads: z.boolean() }).strict(),
    cross_origin_isolated: z.boolean(),
    hardware_concurrency: z.number().int().min(1).max(32),
    device_memory_gb: z.number().positive().nullable(),
    execution_context: z.enum(["main", "worker"]),
  })
  .strict();

const MicroSchema = z
  .object({
    matmul_f32_gflops: StatValueSchema,
    matmul_f16_gflops: StatValueSchema,
    mem_bw_gbps: StatValueSchema,
    wasm_score_single: StatValueSchema,
    wasm_score_multi: StatValueSchema,
  })
  .strict();

// error_code is a fixed enum in packages/schema/errors.ts once that module exists (05 §2: "NEVER
// free text"); tracked as a follow-up rather than guessing the full list here.
const CellSchema = z
  .object({
    cell_id: z.string().min(1),
    model_id: z.string().min(1),
    revision: z.string().min(1),
    quant: z.string().min(1),
    runtime: z.string().min(1),
    runtime_version: z.string().min(1),
    backend: z.enum(["webgpu", "wasm"]),
    status: z.enum([
      "success",
      "unsupported",
      "download-error",
      "init-error",
      "oom",
      "timeout",
      "crash-suspected",
      "visibility-interrupted",
      "error",
    ]),
    error_code: z.string().nullable(),
    download: z
      .object({ mb: z.number().nonnegative(), ms: z.number().nonnegative() })
      .strict()
      .nullable(),
    cache_hit: z.boolean(),
    integrity_verified: z.union([z.boolean(), z.literal("unknown")]),
    init_ms: z.number().nonnegative(),
    ttft_ms: StatValueSchema,
    decode_tps: StatValueSchema,
    tokens_generated: z.number().int().nonnegative(),
    runtime_reported_tps: z.number().nonnegative(),
    fixture_sha256: z.string().min(1),
  })
  .strict();

export const SubmissionPayloadSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    suite_version: z.string().min(1),
    client_nonce: z.string().uuid(),
    consent: z.object({ submit: z.literal(true), consent_version: z.string().min(1) }).strict(),
    env: EnvSchema,
    micro: MicroSchema,
    cells: z.array(CellSchema).min(1).max(MAX_CELLS),
    flags: z.array(FlagSchema),
  })
  .strict();

export type SubmissionPayload = z.infer<typeof SubmissionPayloadSchema>;

/**
 * Validates a raw submission against the schema and the 32 KB payload-size limit (05 §2).
 * Size is checked against the UTF-8 byte length of the caller-supplied raw JSON string, not a
 * re-serialization, since re-serializing could hide an oversized payload behind key reordering.
 */
export function parseSubmissionPayload(
  rawJson: string,
):
  | { ok: true; payload: SubmissionPayload }
  | { ok: false; error: "payload_too_large" | "schema_invalid"; detail: string } {
  if (new TextEncoder().encode(rawJson).length > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: "payload_too_large", detail: `exceeds ${MAX_PAYLOAD_BYTES} bytes` };
  }
  const parsed = SubmissionPayloadSchema.safeParse(JSON.parse(rawJson));
  if (!parsed.success) {
    return { ok: false, error: "schema_invalid", detail: parsed.error.message };
  }
  return { ok: true, payload: parsed.data };
}
