// Framework-agnostic measurement core: suite loading, orchestration, timing, statistics,
// crash markers, result assembly. No React imports (docs/03-architecture.md §3, C2).
export const HARNESS_VERSION = "0.0.0" as const;

export { probe, type ProbeResult, type BrowserFamily, type OsFamily } from "./probe";
export {
  runCell,
  checkMinRequirements,
  WatchdogTimeoutError,
  type CellAdapter,
  type CellSample,
  type DownloadResult,
  type MinRequirements,
  type CellRunResult,
  type CellRunStatus,
  type RunCellOptions,
} from "./runner";
export {
  writeCrashMarker,
  clearCrashMarker,
  checkForStaleCrashMarker,
  type CrashMarker,
} from "./crashMarker";
export { isVisible, waitForVisible } from "./visibilityGuard";
