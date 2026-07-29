import { z } from "zod";

// Registry schema (E3, C4 in 03-architecture.md §3). Data-only definition of the benchmark
// matrix: which cells exist, what they need to run, and what license/provenance backs them.
// This is deliberately a *separate* shape from packages/schema's CellSchema (the submission
// wire format) — a registry entry describes a cell's *definition* (what to run, how long to
// wait, what license), not a *result* (what happened when it ran). The runner's MinRequirements
// type (packages/harness) is structurally compatible with `min_requirements` below by
// convention, not by import — packages/registry must not depend on packages/harness (dependency
// direction rule, 03-architecture.md §6).

export const MinRequirementsSchema = z
  .object({
    webgpu: z.boolean().optional(),
    webgpuFeatures: z.array(z.string()).optional(),
    wasmSimd: z.boolean().optional(),
    wasmThreads: z.boolean().optional(),
  })
  .strict();

export const CellRegistryEntrySchema = z
  .object({
    /** 4 double-underscore-separated segments, lowercase alphanumerics/dots/hyphens/underscores
     * — enforced by registry.test.ts, not by this schema (uniqueness across the whole array
     * can't be expressed per-field in zod without a superRefine on the parent). */
    cell_id: z.string().min(1),
    tier: z.enum(["micro", "0", "1", "1s", "2"]),
    model_id: z.string().min(1),
    model_license: z.string().min(1),
    /** Pinned commit of whatever's actually fetched at runtime (the adapter-specific artifact —
     * an MLC-format repo for WebLLM, a GGUF repo for wllama, the HF repo itself for
     * Transformers.js) — not necessarily the upstream source model's own revision. */
    revision: z.string().min(1),
    quant: z.string().min(1),
    runtime: z.enum(["webllm", "transformers.js", "wllama"]),
    backend: z.enum(["webgpu", "wasm"]),
    /** The exact string/URL passed to the adapter's config to load this cell's weights —
     * runtime-specific (WebLLM: short MLC model id; Transformers.js: HF repo id; wllama: a GGUF
     * file URL). */
    adapter_model_ref: z.string().min(1),
    /** Best-effort estimate for the size-warning UI (FR2.7) — NOT a measured figure unless the
     * registry.json entry says otherwise in this field's context. As of the v1 registry
     * (2026-07-30), only the wllama GGUF cell's figure comes from a verified listing; the rest
     * are parameter-count-based estimates pending a real download measurement (device-lab). */
    expected_download_mb: z.number().positive(),
    timeout_init_ms: z.number().int().positive(),
    timeout_run_ms: z.number().int().positive(),
    min_requirements: MinRequirementsSchema,
    /** Path (relative to packages/registry/fixtures/) to the standard input fixture this cell's
     * measured reps use — 04-benchmark-methodology.md §2. Null only for micro-benchmark cells
     * (no model, no fixture). */
    fixture_path: z.string().min(1).nullable(),
  })
  .strict();

export const SuiteRegistrySchema = z
  .object({
    suite_version: z.string().min(1),
    cells: z.array(CellRegistryEntrySchema).min(1),
  })
  .strict();

export type MinRequirements = z.infer<typeof MinRequirementsSchema>;
export type CellRegistryEntry = z.infer<typeof CellRegistryEntrySchema>;
export type SuiteRegistry = z.infer<typeof SuiteRegistrySchema>;
