import { describe, expect, it, vi } from "vitest";
import { runMatmulBenchmark } from "./matmul";
import { fakeGpuDevice } from "./gpuTestDevice";

describe("runMatmulBenchmark", () => {
  it("runs only the f32 variant when shader-f16 isn't available", async () => {
    const { device, dispatchCalls } = fakeGpuDevice();
    const result = await runMatmulBenchmark(device, false);

    expect(result.f32Gflops).not.toBeNull();
    expect(result.f32Gflops?.median).toBeGreaterThan(0);
    expect(result.f16Gflops).toBeNull();
    // 3 warmup + 10 measured dispatches for the one variant run (04 §2's "3 warmup ... ≥10 measured")
    expect(dispatchCalls).toHaveLength(13);
  });

  it("runs both variants when shader-f16 is available", async () => {
    const { device, dispatchCalls } = fakeGpuDevice();
    const result = await runMatmulBenchmark(device, true);

    expect(result.f32Gflops).not.toBeNull();
    expect(result.f16Gflops).not.toBeNull();
    // 13 dispatches per variant, two variants
    expect(dispatchCalls).toHaveLength(26);
  });

  it("returns null for a variant instead of throwing when buffer creation fails", async () => {
    const { device } = fakeGpuDevice();
    vi.mocked(device.createBuffer).mockImplementation(() => {
      throw new Error("out of GPU memory");
    });

    const result = await runMatmulBenchmark(device, true);
    expect(result.f32Gflops).toBeNull();
    expect(result.f16Gflops).toBeNull();
  });
});
