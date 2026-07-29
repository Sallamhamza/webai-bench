import type { ProbeResult } from "./probe";
import { clearCrashMarker, writeCrashMarker } from "./crashMarker";

// Runner state machine (E1-S2/E1-S3/E1-S4, docs/04-benchmark-methodology.md §4 — normative,
// "law"). This implements steps 1-6 and 8 of the 8-step sequence exactly as specified, plus
// per-step watchdog timeouts (FR2.4). The visibility-guard half of step 7 (E1-S5) is a
// deliberately separate story — this file has no knowledge of it. Stats/median computation and
// assembling a schema-conformant ResultDraft are E1-S6, also out of scope here: runCell() returns
// raw per-rep samples, not aggregated numbers.
//
// CellAdapter is deliberately minimal, not the full C3 RuntimeAdapter shape from
// 03-architecture.md (init/generate/embed/dispose/meta) — real per-runtime adapters (E2) will
// each implement whichever of generate/embed/etc. their task needs, then present a single
// runOnce() to this runner. That mapping is E2's concern; this story only proves the sequencing,
// tested against fake adapters (matching the plan's own testing approach for E1-S3).

export type CellRunStatus =
  "unsupported" | "download-error" | "init-error" | "timeout" | "error" | "success";

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
   * for unsupported; error message for the rest; "<stage> exceeded its <n>ms timeout" for
   * timeouts). Never surfaced to end users verbatim without sanitization — that's a UI (E4)
   * concern; E4 is also responsible for naming the cell alongside this reason (FR2.4 AC6). */
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
  /** Watchdog budget for cold init (FR2.4). Registry-declared per cell (`timeout_init_ms`), not
   * a hardcoded constant here — the default (120s) only applies when a caller doesn't supply
   * the registry's actual value. */
  timeoutInitMs?: number;
  /** Watchdog budget per warmup/measured-rep call (FR2.4, registry's `timeout_run_ms`). Same
   * caveat: this default (90s) is a fallback, not the source of truth. */
  timeoutRunMs?: number;
}

const DEFAULT_REPS_PER_CELL = 3;
const DEFAULT_COOLDOWN_MS = 500;
const DEFAULT_TIMEOUT_INIT_MS = 120_000;
const DEFAULT_TIMEOUT_RUN_MS = 90_000;

export class WatchdogTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`${stage} exceeded its ${timeoutMs}ms timeout`);
    this.name = "WatchdogTimeoutError";
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Races `promise` against a timeout. On timeout, rejects with WatchdogTimeoutError — the
 * original promise is left to settle on its own (there is no general way to cancel an arbitrary
 * in-flight adapter call without adapter-specific AbortController support, which isn't part of
 * the CellAdapter contract). Whichever settles first, the timer is always cleared (FR2.4 AC3:
 * watchdogs must not leave stray timers behind after a successful, non-timed-out step).
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WatchdogTimeoutError(stage, timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err as Error);
      },
    );
  });
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
 * Runs one cell through the normative sequence (04-benchmark-methodology.md §4, steps 1-6, 8),
 * with per-step watchdog timeouts (FR2.4) and a crash marker (FR2.5) bracketing steps 3-8. Never
 * throws — every failure mode, including a timeout, is a terminal CellRunResult status, so one
 * hung cell never blocks the rest of a run (the caller simply moves on to the next cell instead
 * of awaiting forever).
 */
export async function runCell(
  cellId: string,
  adapter: CellAdapter,
  minRequirements: MinRequirements,
  probeResult: ProbeResult,
  options: RunCellOptions = {},
): Promise<CellRunResult> {
  const repsPerCell = options.repsPerCell ?? DEFAULT_REPS_PER_CELL;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const timeoutInitMs = options.timeoutInitMs ?? DEFAULT_TIMEOUT_INIT_MS;
  const timeoutRunMs = options.timeoutRunMs ?? DEFAULT_TIMEOUT_RUN_MS;

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

  // 2. Acquire weights (no watchdog — FR2.4 only names timeout_init_ms/timeout_run_ms; download
  // progress/hang handling is a separate concern, not part of this story)
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

  // 3. Crash marker: written now that weights are acquired and init is about to be attempted.
  // Cleared in the finally below (step 8). If the tab is killed anywhere between here and then,
  // this marker survives to be found stale on the next page load (checkForStaleCrashMarker).
  writeCrashMarker(cellId);

  // From here on, adapter.init() is attempted, so teardown (step 8) must always be attempted
  // too — even if init() itself throws or times out partway through allocating GPU/engine
  // resources. Only the preflight-fail and download-error paths above skip dispose(), since
  // adapter.init() was never called and there is nothing on the adapter to tear down.
  let initMs: number | null = null;
  try {
    // 4. Cold init, watchdog: timeout_init_ms
    try {
      const t0 = performance.now();
      await withTimeout(adapter.init(), timeoutInitMs, "init");
      initMs = performance.now() - t0;
    } catch (err) {
      return {
        status: err instanceof WatchdogTimeoutError ? "timeout" : "init-error",
        reason: errorMessage(err),
        download,
        cacheHit,
        initMs: null,
        samples: [],
      };
    }

    // 5. Warmup (discarded), watchdog: timeout_run_ms
    await withTimeout(adapter.runOnce(), timeoutRunMs, "warmup");

    // 6. Measured repetitions, watchdog: timeout_run_ms per rep
    const samples: CellSample[] = [];
    for (let rep = 0; rep < repsPerCell; rep++) {
      samples.push(await withTimeout(adapter.runOnce(), timeoutRunMs, `measured rep ${rep + 1}`));
      if (rep < repsPerCell - 1) {
        await sleep(cooldownMs);
      }
    }

    return { status: "success", download, cacheHit, initMs, samples };
  } catch (err) {
    return {
      status: err instanceof WatchdogTimeoutError ? "timeout" : "error",
      reason: errorMessage(err),
      download,
      cacheHit,
      initMs,
      samples: [],
    };
  } finally {
    // 8. Teardown — always attempted, even on failure or timeout mid-measurement. A failing
    // dispose() must not mask the real result or crash the runner. Clearing the crash marker
    // here (not in a separate try) is deliberate: if dispose() hangs or throws, we still want
    // the marker cleared, since dispose failing isn't the kind of catastrophic failure the
    // marker exists to catch.
    clearCrashMarker();
    try {
      await adapter.dispose();
    } catch {
      // Intentionally swallowed — see above.
    }
  }
}
