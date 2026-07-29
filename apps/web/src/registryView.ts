import { checkMinRequirements, type MinRequirements, type ProbeResult } from "@webai-bench/harness";
import {
  REGISTRY,
  type CellRegistryEntry,
  type MinRequirements as RegistryMinRequirements,
} from "@webai-bench/registry";

// FR1.3: probe results determine which matrix cells are runnable on this device; unrunnable
// cells are shown greyed-out with the reason (checkMinRequirements already produces the exact
// human-readable string this UI needs, so this module just fans that out over the whole registry).
export interface CellViewModel {
  cell: CellRegistryEntry;
  runnable: boolean;
  /** Human-readable reason the cell can't run here, e.g. "requires WebGPU — not available on
   * this device/browser". Null when runnable. */
  reason: string | null;
}

// registry and harness deliberately keep structurally independent MinRequirements types (no
// import from registry to harness). Zod's .optional() infers `T | undefined`, which — under
// exactOptionalPropertyTypes — isn't assignable to harness's `T?` fields, so this drops
// explicit-undefined keys rather than just passing them through.
function toHarnessMinRequirements(min: RegistryMinRequirements): MinRequirements {
  const result: MinRequirements = {};
  if (min.webgpu !== undefined) result.webgpu = min.webgpu;
  if (min.webgpuFeatures !== undefined) result.webgpuFeatures = min.webgpuFeatures;
  if (min.wasmSimd !== undefined) result.wasmSimd = min.wasmSimd;
  if (min.wasmThreads !== undefined) result.wasmThreads = min.wasmThreads;
  return result;
}

export function buildCellViewModels(probeResult: ProbeResult): CellViewModel[] {
  return REGISTRY.cells.map((cell) => {
    const reason = checkMinRequirements(
      toHarnessMinRequirements(cell.min_requirements),
      probeResult,
    );
    return { cell, runnable: reason === null, reason };
  });
}
