import { useEffect, useRef, useState } from "react";
import {
  runSuite,
  type CellRunResult,
  type ProbeResult,
  type SuiteCellSpec,
  type SuiteProgressEvent,
} from "@webai-bench/harness";
import { REGISTRY } from "@webai-bench/registry";
import { toHarnessMinRequirements, type CellViewModel } from "./registryView";
import { createAdapterForCell } from "./adapterFactory";
import { needsSizeWarning, totalDownloadMb } from "./sizeWarning";
import { clearCachedModels } from "./clearCache";
import { buildExportPayload } from "./resultsExport";

export interface RunPanelProps {
  cellViewModels: readonly CellViewModel[];
  selectedIds: ReadonlySet<string>;
  probeResult: ProbeResult;
}

type RunState =
  | { status: "idle" }
  | { status: "confirm-size"; totalMb: number }
  | { status: "running"; stop: () => void; events: SuiteProgressEvent[] }
  | { status: "done"; results: Map<string, CellRunResult> };

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// E4-S3: the actual run flow (FR2.1 orchestration, FR2.7 size warning + Stop, FR3.4 export).
// Cell selection/greying is E4-S2's job (CellList/PresetPicker) — this component only cares
// about turning an already-made selection into a real run.
export function RunPanel({ cellViewModels, selectedIds, probeResult }: RunPanelProps) {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // WAI-ARIA APG: an alertdialog should receive focus when it opens, not leave focus stranded
  // on the (now-hidden) button that triggered it. Cancel, not Continue, gets it — a size
  // warning's safe default is "don't start the download."
  useEffect(() => {
    if (runState.status === "confirm-size") cancelButtonRef.current?.focus();
  }, [runState.status]);

  const selectedCells = cellViewModels
    .filter((vm) => selectedIds.has(vm.cell.cell_id) && vm.runnable)
    .map((vm) => vm.cell);

  const startRun = () => {
    const cells: SuiteCellSpec[] = selectedCells.map((cell) => ({
      cellId: cell.cell_id,
      createAdapter: () => createAdapterForCell(cell),
      minRequirements: toHarnessMinRequirements(cell.min_requirements),
      timeoutInitMs: cell.timeout_init_ms,
      timeoutRunMs: cell.timeout_run_ms,
    }));

    const { result, stop } = runSuite(cells, probeResult, {
      onProgress: (event) => {
        setRunState((prev) =>
          prev.status === "running" ? { ...prev, events: [...prev.events, event] } : prev,
        );
      },
    });

    setRunState({ status: "running", stop, events: [] });
    void result.then((results) => setRunState({ status: "done", results }));
  };

  const handleStartClick = () => {
    const totalMb = totalDownloadMb(selectedCells);
    if (needsSizeWarning(totalMb)) {
      setRunState({ status: "confirm-size", totalMb });
    } else {
      startRun();
    }
  };

  const handleExport = () => {
    if (runState.status !== "done") return;
    void buildExportPayload(selectedCells, runState.results, REGISTRY.suite_version).then(
      (payload) => downloadJson(`webai-bench-results-${Date.now()}.json`, payload),
    );
  };

  return (
    <section>
      <h2>Run</h2>

      {runState.status === "idle" ? (
        <>
          <button type="button" onClick={handleStartClick} disabled={selectedCells.length === 0}>
            Start run
          </button>
          <button type="button" onClick={() => void clearCachedModels()}>
            Clear cached models
          </button>
        </>
      ) : null}

      {runState.status === "confirm-size" ? (
        <div role="alertdialog" aria-label="Large download warning">
          <p>
            This run will download approximately {Math.round(runState.totalMb)} MB of model weights
            (estimate, not a measured figure). Continue?
          </p>
          <button type="button" onClick={startRun}>
            Continue
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={() => setRunState({ status: "idle" })}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {runState.status === "running" ? (
        <div>
          <button type="button" onClick={runState.stop}>
            Stop
          </button>
          <ul aria-live="polite" aria-label="Run progress">
            {runState.events.map((event, i) => (
              <li key={`${event.cellId}-${event.phase}-${i}`}>
                {event.cellId}: {event.phase}
                {event.phase === "done" ? ` (${event.result?.status ?? "unknown"})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {runState.status === "done" ? (
        <div>
          <h3 id="run-results-heading">Results</h3>
          <table aria-labelledby="run-results-heading">
            <thead>
              <tr>
                <th scope="col">Cell</th>
                <th scope="col">Status</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {[...runState.results.entries()].map(([cellId, result]) => (
                <tr key={cellId}>
                  <td>{cellId}</td>
                  <td>{result.status}</td>
                  <td>{result.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={handleExport}>
            Export results (JSON)
          </button>
          <button type="button" onClick={() => setRunState({ status: "idle" })}>
            Run again
          </button>
        </div>
      ) : null}
    </section>
  );
}
