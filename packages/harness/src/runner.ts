import type { ProbeResult } from "./probe";

// Runner state machine (E1-S2, docs/04-benchmark-methodology.md §4 — normative, "law"). This
// implements steps 1, 2, 4, 5, 6, 8 of the 8-step sequence exactly as specified. Steps 3
// (crash marker, E1-S4), 7's watchdog half (E1-S3) and visibility guard (E1-S5) are deliberately
// separate stories — this file has no knowledge of them. Stats/median computation and assembling
// a schema-conformant ResultDraft are E1-S6, also out of scope here: runCell() returns raw
// per-rep samples, not aggregated numbers.
//
// CellAdapter is deliberately minimal, not the full C3 RuntimeAdapter shape from
// 03-architecture.md (init/generate/embed/dispose/meta) — real per-runtime adapters (E2) will
// each implement whichever of generate/embed/etc. their task needs, then present a single
// runOnce() to this runner. That mapping is E2's concern; this story only proves the sequencing,
// tested against fake adapters (matching the plan's own testing approach for E1-S3).

export type CellRunStatus = "unsupported" | "download-error" | "init-error" | "error" | "success";

export interface CellSample {
  ttftMs: number | null;
  tokensGenerated: number | null;
  runtimeReportedTps: number | null;
}

export interface DownloadResult {
  mb: number;
  ms: number;
}

export interface CellAdapter {
  /** Absent means weights are already local/bundled (e.g. a micro-benchmark with no model) —
   * recorded as cache_hit. Present + resolves null means a cache hit was detected at runtime
   * (e.g. Cache API already had the weights); present + resolves a value means a cache miss. */
  download?(): Promise<DownloadResult | null>;
  init(): Promise<void>;
  /** Executes exactly one measured pass (warmup or a measured rep) against the cell's standard
   * input (04-benchmark-methodology.md §2 fixtures). Called once for warmup (discarded), then
   * `repsPerCell` times for measured reps. */
  runOnce(): Promise<CellSample>;
  dispose(): Promise<void>;
}

export interface MinRequirements {
  webgpu?: boolean;
  webgpuFeatures?: readonly string[];
  wasmSimd?: boolean;
  wasmThreads?: boolean;
}

export interface CellRunResult {
  status: CellRunStatus;
  /** Human-readable reason, always present on non-success (FR1.3-style "requires X — reason"
   * for unsupported; error message for the rest). Never surfaced to end users verbatim without
   * sanitization — that's a UI (E4) concern. */
  reason?: string;
  download: DownloadResult | null;
  cacheHit: boolean;
  initMs: number | null;
  /** Exactly `repsPerCell` entries on success; empty otherwise. Raw samples — median/min/max is
   * E1-S6's job, not this function's. */
  samples: CellSample[];
}

export interface RunCellOptions {
  /** N measured repetitions after warmup. Default 3, per 04 §4 step 6 / §5. */
  repsPerCell?: number;
  /** Macrotask yield between measured reps. Default 500ms, per 04 §4 step 6. */
  cooldownMs?: number;
}

const DEFAULT_REPS_PER_CELL = 3;
const DEFAULT_COOLDOWN_MS = 500;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks a cell's `min_requirements` (registry-declared, E3) against the capability probe
 * (E1-S1). Returns a human-readable reason when unsupported, or null when the cell is runnable —
 * matching FR1.3's "unrunnable cells are shown greyed-out with the reason" contract, though
 * surfacing that in the UI is E4's job, not this function's.
 */
export function checkMinRequirements(
  min: MinRequirements,
  probeResult: ProbeResult,
): string | null {
  if (min.webgpu && !probeResult.webgpu.available) {
    return "requires WebGPU — not available on this device/browser";
  }
  if (min.webgpuFeatures) {
    for (const feature of min.webgpuFeatures) {
      if (!probeResult.webgpu.features.includes(feature)) {
        return `requires ${feature} — not supported by this GPU/driver`;
      }
    }
  }
  if (min.wasmSimd && !probeResult.wasm.simd) {
    return "requires WASM SIMD — not supported by this browser";
  }
  if (min.wasmThreads && !probeResult.wasm.threads) {
    return "requires WASM threads — needs cross-origin isolation and SharedArrayBuffer";
  }
  return null;
}

/**
 * Runs one cell through the normative sequence (04-benchmark-methodology.md §4, steps
 * 1/2/4/5/6/8). Never throws — every failure mode is a terminal CellRunResult status, matching
 * the same never-crash-the-run philosophy as the capability probe (FR1.2) and the watchdog
 * story's intent (E1-S3): one bad cell must not take down the whole suite run.
 */
export async function runCell(
  adapter: CellAdapter,
  minRequirements: MinRequirements,
  probeResult: ProbeResult,
  options: RunCellOptions = {},
): Promise<CellRunResult> {
  const repsPerCell = options.repsPerCell ?? DEFAULT_REPS_PER_CELL;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  // 1. Preflight
  const unsupportedReason = checkMinRequirements(minRequirements, probeResult);
  if (unsupportedReason) {
    return {
      status: "unsupported",
      reason: unsupportedReason,
      download: null,
      cacheHit: false,
      initMs: null,
      samples: [],
    };
  }

  // 2. Acquire weights
  let download: DownloadResult | null = null;
  let cacheHit = true;
  if (adapter.download) {
    try {
      download = await adapter.download();
      cacheHit = download === null;
    } catch (err) {
      return {
        status: "download-error",
        reason: errorMessage(err),
        download: null,
        cacheHit: false,
        initMs: null,
        samples: [],
      };
    }
  }

  // From here on, adapter.init() is attempted, so teardown (step 8) must always be attempted
  // too — even if init() itself throws partway through allocating GPU/engine resources. Only
  // the preflight-fail and download-error paths above skip dispose(), since adapter.init() was
  // never called and there is nothing on the adapter to tear down.
  let initMs: number | null = null;
  try {
    // 4. Cold init
    try {
      const t0 = performance.now();
      await adapter.init();
      initMs = performance.now() - t0;
    } catch (err) {
      return {
        status: "init-error",
        reason: errorMessage(err),
        download,
        cacheHit,
        initMs: null,
        samples: [],
      };
    }

    // 5. Warmup (discarded)
    await adapter.runOnce();

    // 6. Measured repetitions
    const samples: CellSample[] = [];
    for (let rep = 0; rep < repsPerCell; rep++) {
      samples.push(await adapter.runOnce());
      if (rep < repsPerCell - 1) {
        await sleep(cooldownMs);
      }
    }

    return { status: "success", download, cacheHit, initMs, samples };
  } catch (err) {
    return {
      status: "error",
      reason: errorMessage(err),
      download,
      cacheHit,
      initMs,
      samples: [],
    };
  } finally {
    // 8. Teardown — always attempted, even on failure mid-measurement. A failing dispose()
    // must not mask the real result or crash the runner.
    try {
      await adapter.dispose();
    } catch {
      // Intentionally swallowed — see above.
    }
  }
}
