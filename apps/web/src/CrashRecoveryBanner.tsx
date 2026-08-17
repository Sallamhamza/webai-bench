import { useState } from "react";
import { checkForStaleCrashMarker, clearCrashMarker } from "@webai-bench/harness";

// FR2.5's recovery half (04-benchmark-methodology.md §4 step 3): the harness already writes a
// crash marker before a cell's model load and clears it on that cell's teardown
// (packages/harness/src/crashMarker.ts) — if the tab is killed between those two points, the
// marker survives to be found stale on the next page load. This component is that next-page-load
// check: read once on mount, and if something's there, tell the visitor plainly rather than
// silently discarding the evidence.
//
// Deliberately scoped to the *prompt* only, not "feed a crash-suspected result" (FR2.5's other
// clause): there's no cross-session results store to merge a synthetic result into yet — RunPanel
// keeps its results in memory for the current run only, dropped on reload. Assembling an actual
// crash-suspected CellRunResult for that cell is still open (see traceability.md's FR2.5 row).
export function CrashRecoveryBanner() {
  const [marker, setMarker] = useState(() => checkForStaleCrashMarker());

  if (!marker) return null;

  const handleDismiss = () => {
    clearCrashMarker();
    setMarker(null);
  };

  const when = new Date(marker.ts);
  const whenText = Number.isNaN(when.getTime()) ? marker.ts : when.toLocaleString();

  return (
    <div role="alert">
      <p>
        It looks like the browser closed or crashed while running <strong>{marker.cellId}</strong>{" "}
        (started {whenText}) — that run never got to report a result. This is just a heads-up;
        nothing else to do here.
      </p>
      <button type="button" onClick={handleDismiss}>
        Dismiss
      </button>
    </div>
  );
}
