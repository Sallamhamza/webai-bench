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
  type AdapterMeta,
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
export { computeStatValue, computeCellFlags, type StatValue } from "./stats";
export { assembleCellResult, type CellMetadata, type AssembledCellResult } from "./resultAssembly";
export {
  checkAdapterMeta,
  checkInitAndDispose,
  checkRunOnceLifecycle,
  checkMidRunDisposeAborts,
  checkErrorSurfacing,
} from "./adapterConformance";
export { createWebLLMAdapter, type WebLLMAdapterConfig } from "./adapters/webllm";
export {
  createTransformersJsAdapter,
  type TransformersJsAdapterConfig,
} from "./adapters/transformersjs";
export { createWllamaAdapter, type WllamaAdapterConfig } from "./adapters/wllama";
export {
  runSuite,
  type SuiteCellSpec,
  type SuiteProgressEvent,
  type RunSuiteOptions,
  type SuiteRunHandle,
} from "./suiteRunner";
