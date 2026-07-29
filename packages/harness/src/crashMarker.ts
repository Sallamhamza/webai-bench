// Crash marker (E1-S4, FR2.5 / docs/04-benchmark-methodology.md §4 step 3). Persists a
// run-started marker to localStorage before a cell's model load begins, cleared on that cell's
// teardown (step 8). If the tab is killed (OOM, hard crash) between those two points, our own
// JS never runs again to clear it — the marker survives, and the NEXT page load finds it stale.
// checkForStaleCrashMarker() is what that next page load calls; prompting the user to confirm
// and recording the crash-suspected result for that cell is E4/E1-S6's job, not this module's.
//
// Every function here is defensive the same way probe.ts is (FR1.2 spirit, not a hard
// requirement for FR2.5 specifically): localStorage can throw (Safari private browsing in old
// versions, storage disabled by policy) and crash detection is a nicety, never something that
// should be allowed to break an actual run.

const STORAGE_KEY = "webai-bench:run-started";

export interface CrashMarker {
  cellId: string;
  ts: string;
}

function isCrashMarker(value: unknown): value is CrashMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<CrashMarker>).cellId === "string" &&
    typeof (value as Partial<CrashMarker>).ts === "string"
  );
}

export function writeCrashMarker(cellId: string): void {
  try {
    const marker: CrashMarker = { cellId, ts: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Storage unavailable — crash detection degrades silently, the run itself must not be
    // affected.
  }
}

export function clearCrashMarker(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See writeCrashMarker.
  }
}

/**
 * Reads a leftover marker from a previous session, if any. Returns null both when there is no
 * marker and when the stored value is corrupt/unparseable — a malformed marker is not usable
 * evidence of a crash, so it's treated the same as no marker at all.
 */
export function checkForStaleCrashMarker(): CrashMarker | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCrashMarker(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
