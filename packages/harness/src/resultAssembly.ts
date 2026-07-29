import { CellSchema, type CellDraft } from "@webai-bench/schema";
import type { CellRunResult } from "./runner";
import { computeCellFlags, computeStatValue } from "./stats";

// Result assembly (E1-S6): maps a runCell() output onto the schema's CellDraft shape and
// validates it really does conform — this is the "ResultDraft assembly against schema" half of
// the story, complementing stats.ts's pure computation.

export interface CellMetadata {
  cellId: string;
  modelId: string;
  revision: string;
  quant: string;
  runtime: string;
  runtimeVersion: string;
  backend: "webgpu" | "wasm";
  /** Not tracked by runCell() — comes from the adapter/registry once those exist (E2/E3).
   * Accepted here explicitly rather than guessed. */
  integrityVerified: boolean | "unknown";
  fixtureSha256: string;
}

export interface AssembledCellResult {
  cell: CellDraft;
  /** Per-cell derived flags (04 §5) — see stats.ts's computeCellFlags for why these aren't part
   * of `cell` itself (the schema's `flags` field lives on the payload envelope, not per-cell). */
  flags: string[];
}

/**
 * Assembles and validates a single cell's schema-conformant draft from a runCell() result.
 * Throws (via CellSchema.parse) if the assembled shape doesn't actually validate — a bug here
 * should fail loudly during development, not silently produce data that would be rejected by
 * the real ingest API (05 §2) later.
 */
export function assembleCellResult(
  metadata: CellMetadata,
  runResult: CellRunResult,
): AssembledCellResult {
  const ttftValues = runResult.samples.map((s) => s.ttftMs).filter((v): v is number => v !== null);
  const decodeTpsValues = runResult.samples
    .map((s) => s.decodeTps)
    .filter((v): v is number => v !== null);
  const runtimeReportedValues = runResult.samples
    .map((s) => s.runtimeReportedTps)
    .filter((v): v is number => v !== null);
  const embedSpsValues = runResult.samples
    .map((s) => s.embedSps)
    .filter((v): v is number => v !== null);

  const lastSample = runResult.samples.at(-1);
  const runtimeReportedStat = computeStatValue(runtimeReportedValues);

  const cell: CellDraft = {
    cell_id: metadata.cellId,
    model_id: metadata.modelId,
    revision: metadata.revision,
    quant: metadata.quant,
    runtime: metadata.runtime,
    runtime_version: metadata.runtimeVersion,
    backend: metadata.backend,
    status: runResult.status,
    // packages/schema/errors.ts (05 §2's fixed error_code enum) doesn't exist yet — tracked as
    // a follow-up since SP6 (docs/spikes/sp6-findings.md); always null until it lands.
    error_code: null,
    download: runResult.download,
    cache_hit: runResult.cacheHit,
    integrity_verified: metadata.integrityVerified,
    init_ms: runResult.initMs ?? 0,
    ttft_ms: computeStatValue(ttftValues),
    decode_tps: computeStatValue(decodeTpsValues),
    tokens_generated: lastSample?.tokensGenerated ?? 0,
    runtime_reported_tps: runtimeReportedStat?.median ?? 0,
    embed_sps: computeStatValue(embedSpsValues),
    // Constant across a cell's reps (04 §2) — taken from the last sample rather than asserting
    // every rep agrees; an adapter that somehow varied it rep-to-rep would be a bug elsewhere.
    batching: lastSample?.batching ?? null,
    fixture_sha256: metadata.fixtureSha256,
  };

  return {
    cell: CellSchema.parse(cell),
    flags: computeCellFlags(runResult.samples),
  };
}
