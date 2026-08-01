import type { ProbeResult } from "./probe";
import {
  runCell,
  type CellAdapter,
  type CellRunResult,
  type MinRequirements,
  type RunCellOptions,
} from "./runner";

// Suite orchestrator (E4-S1). Drives a user-selected subset of the matrix (FR2.1) by calling
// runCell() once per cell, sequentially — this is the piece that's been a documented gap since
// E2 ("a multi-cell orchestrator to actually drive a whole run doesn't exist yet"). Framework-
// agnostic (no React imports, 03-architecture.md §3 C2), so apps/web just renders around it.

export interface SuiteCellSpec {
  cellId: string;
  /** Called once per cell to construct a fresh adapter instance — not shared across cells,
   * since each cell may need a different runtime/model/config entirely. */
  createAdapter: () => CellAdapter;
  minRequirements: MinRequirements;
  /** Per-cell watchdog overrides (FR2.4: "configurable per registry entry"), e.g. the
   * registry's timeout_init_ms/timeout_run_ms for this specific cell. Cells in one suite can be
   * wildly different sizes (a 360M model next to a 1.7B one), so a single RunSuiteOptions-level
   * timeout applied to every cell isn't just imprecise, it's wrong — found via a real download
   * timing out under the global default despite the registry declaring a larger budget for that
   * cell (docs/adr — see adapters/QUIRKS.md's vertical-slice notes). Falls back to
   * RunSuiteOptions' value, then runCell()'s own default, when omitted. */
  timeoutInitMs?: number;
  timeoutRunMs?: number;
}

export interface SuiteProgressEvent {
  cellId: string;
  index: number;
  total: number;
  phase: "starting" | "done";
  /** Present only when phase is "done". */
  result?: CellRunResult;
}

export interface RunSuiteOptions extends RunCellOptions {
  onProgress?: (event: SuiteProgressEvent) => void;
}

export interface SuiteRunHandle {
  /** Resolves once every cell has either run to completion or been skipped because stop() was
   * called. Never rejects — same never-throws philosophy as runCell() itself; a cell's own
   * failure is a terminal CellRunResult, not a rejected promise. */
  result: Promise<Map<string, CellRunResult>>;
  /**
   * Stops the run: disposes whichever adapter is currently active (triggering that adapter's
   * own cancellation contract — checkMidRunDisposeAborts, E2-S4) and skips every cell after the
   * one currently in flight. The in-flight cell still gets a terminal result in the returned
   * map (typically status "error" from the induced dispose, since CellRunStatus has no distinct
   * "stopped" value yet — a deliberate simplification, not an oversight: the UI layer already
   * knows a stop was user-initiated from its own state, so the map doesn't need to represent it
   * specially too).
   */
  stop: () => void;
}

/**
 * Runs each cell in `cells` in order via runCell(), reporting progress and collecting results
 * into a Map keyed by cell_id. Stops early (without starting further cells) if `stop()` is
 * called on the returned handle.
 */
export function runSuite(
  cells: readonly SuiteCellSpec[],
  probeResult: ProbeResult,
  options: RunSuiteOptions = {},
): SuiteRunHandle {
  let stopped = false;
  let currentAdapter: CellAdapter | null = null;

  const stop = () => {
    stopped = true;
    // Fire-and-forget: dispose() is async, but stop() itself is a synchronous "request to
    // stop" — the in-flight runCell() call will settle on its own once its awaited dispose()
    // resolves (or the adapter's cancellation causes runOnce() to reject first).
    void currentAdapter?.dispose();
  };

  const result = (async () => {
    // Yield one microtask before touching the first cell — without this, the loop below starts
    // executing synchronously (up through its first `await`) before runSuite() even returns to
    // its caller, so a stop() called immediately after construction would arrive too late to
    // prevent cell 0 from starting. This guarantees stop() is always honored, no matter how
    // soon after creation it's called.
    await Promise.resolve();

    const results = new Map<string, CellRunResult>();

    for (let index = 0; index < cells.length; index++) {
      if (stopped) break;

      const cell = cells[index];
      if (!cell) continue; // unreachable given the loop bound, satisfies noUncheckedIndexedAccess

      options.onProgress?.({ cellId: cell.cellId, index, total: cells.length, phase: "starting" });

      const adapter = cell.createAdapter();
      currentAdapter = adapter;

      const cellOptions: RunCellOptions = { ...options };
      const timeoutInitMs = cell.timeoutInitMs ?? options.timeoutInitMs;
      const timeoutRunMs = cell.timeoutRunMs ?? options.timeoutRunMs;
      if (timeoutInitMs !== undefined) cellOptions.timeoutInitMs = timeoutInitMs;
      if (timeoutRunMs !== undefined) cellOptions.timeoutRunMs = timeoutRunMs;
      const cellResult = await runCell(
        cell.cellId,
        adapter,
        cell.minRequirements,
        probeResult,
        cellOptions,
      );
      currentAdapter = null;
      results.set(cell.cellId, cellResult);

      options.onProgress?.({
        cellId: cell.cellId,
        index,
        total: cells.length,
        phase: "done",
        result: cellResult,
      });
    }

    return results;
  })();

  return { result, stop };
}
