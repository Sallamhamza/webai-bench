import { describe, expect, it } from "vitest";
import { REGISTRY } from "@webai-bench/registry";
import { presetCellIds, runnablePresetCellIds } from "./presets";
import type { CellViewModel } from "./registryView";

function allRunnable(): CellViewModel[] {
  return REGISTRY.cells.map((cell) => ({ cell, runnable: true, reason: null }));
}

describe("presetCellIds", () => {
  it("quick preset selects only tier-0 cells", () => {
    const ids = presetCellIds("quick", allRunnable());
    const tier0Ids = REGISTRY.cells.filter((c) => c.tier === "0").map((c) => c.cell_id);
    expect(ids.sort()).toEqual(tier0Ids.sort());
  });

  it("full preset selects every registry cell", () => {
    const ids = presetCellIds("full", allRunnable());
    expect(ids.sort()).toEqual(REGISTRY.cells.map((c) => c.cell_id).sort());
  });
});

describe("runnablePresetCellIds", () => {
  it("excludes preset cells the device can't run", () => {
    const models = allRunnable().map((vm) =>
      vm.cell.cell_id === "smollm2-360m__q4__webllm__webgpu"
        ? {
            ...vm,
            runnable: false,
            reason: "requires WebGPU — not available on this device/browser",
          }
        : vm,
    );
    const ids = runnablePresetCellIds("quick", models);
    expect(ids).not.toContain("smollm2-360m__q4__webllm__webgpu");
    expect(ids).toContain("all-minilm-l6-v2__default__transformers.js__wasm");
  });
});
