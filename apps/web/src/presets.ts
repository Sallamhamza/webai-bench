import type { CellViewModel } from "./registryView";

// FR2.8 (S): a "quick run" preset (probe + micro + embedding + smallest LLM tier) and a "full
// run" preset. The registry's tier field already encodes this split — tier "0" is exactly the
// always-runnable-class set (03-architecture.md §5.5), so "quick" is just a tier filter, no
// separate curated list to keep in sync.
export type PresetId = "quick" | "full";

export function presetCellIds(
  preset: PresetId,
  cellViewModels: readonly CellViewModel[],
): string[] {
  const cells =
    preset === "quick" ? cellViewModels.filter((vm) => vm.cell.tier === "0") : cellViewModels;
  return cells.map((vm) => vm.cell.cell_id);
}

/** Preset selection intersected with what's actually runnable on this device — a preset should
 * never pre-check a cell the device can't run (it'd just be immediately disabled anyway). */
export function runnablePresetCellIds(
  preset: PresetId,
  cellViewModels: readonly CellViewModel[],
): string[] {
  return presetCellIds(preset, cellViewModels).filter((cellId) => {
    const vm = cellViewModels.find((c) => c.cell.cell_id === cellId);
    return vm?.runnable === true;
  });
}
