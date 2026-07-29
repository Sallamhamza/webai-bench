import { describe, expect, it } from "vitest";
import type { ProbeResult } from "@webai-bench/harness";
import { REGISTRY } from "@webai-bench/registry";
import { buildCellViewModels } from "./registryView";

function probeWith(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    webgpu: {
      available: false,
      vendor: null,
      architecture: null,
      features: [],
      limits: { maxBufferSize: null, maxStorageBufferBindingSize: null },
    },
    wasm: { simd: false, threads: false },
    crossOriginIsolated: false,
    hardwareConcurrency: null,
    deviceMemoryGb: null,
    browser: { family: "chrome", major: 138 },
    os: { family: "windows", versionCoarse: "11" },
    ...overrides,
  };
}

describe("buildCellViewModels", () => {
  it("produces one view model per registry cell", () => {
    const models = buildCellViewModels(probeWith());
    expect(models).toHaveLength(REGISTRY.cells.length);
  });

  it("marks every cell unrunnable with a reason on a bare device (no WebGPU/WASM SIMD)", () => {
    const models = buildCellViewModels(probeWith());
    for (const vm of models) {
      expect(vm.runnable).toBe(false);
      expect(vm.reason).toEqual(expect.any(String));
    }
  });

  it("marks WebGPU+shader-f16 cells runnable when the device reports that support", () => {
    const models = buildCellViewModels(
      probeWith({
        webgpu: {
          available: true,
          vendor: "nvidia",
          architecture: "ampere",
          features: ["shader-f16"],
          limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1 },
        },
      }),
    );
    const webgpuCell = models.find((vm) => vm.cell.cell_id === "smollm2-360m__q4__webllm__webgpu");
    expect(webgpuCell?.runnable).toBe(true);
    expect(webgpuCell?.reason).toBeNull();
  });

  it("marks WASM-SIMD-only cells runnable independent of WebGPU support", () => {
    const models = buildCellViewModels(probeWith({ wasm: { simd: true, threads: false } }));
    const wasmCell = models.find(
      (vm) => vm.cell.cell_id === "all-minilm-l6-v2__default__transformers.js__wasm",
    );
    expect(wasmCell?.runnable).toBe(true);
    expect(wasmCell?.reason).toBeNull();
  });
});
