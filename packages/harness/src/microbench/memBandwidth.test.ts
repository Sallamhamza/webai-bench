import { describe, expect, it, vi } from "vitest";
import { computeWorkingSetBytes, runMemBandwidthBenchmark } from "./memBandwidth";
import { fakeGpuDevice } from "./gpuTestDevice";

describe("computeWorkingSetBytes", () => {
  it("caps at 256 MB when 25% of maxBufferSize is larger", () => {
    const bytes = computeWorkingSetBytes(4 * 1024 * 1024 * 1024); // 4 GB device limit
    expect(bytes).toBe(256 * 1024 * 1024);
  });

  it("uses 25% of maxBufferSize, rounded down to a power of two, on a modest device", () => {
    // 25% of 100 MB = 25 MB; largest power-of-two <= 25 MB is 16 MB
    const bytes = computeWorkingSetBytes(100 * 1024 * 1024);
    expect(bytes).toBe(16 * 1024 * 1024);
    expect(Math.log2(bytes)).toEqual(Math.floor(Math.log2(bytes)));
  });

  it("never returns less than 4 bytes even for a degenerate maxBufferSize", () => {
    expect(computeWorkingSetBytes(0)).toBe(4);
  });
});

describe("runMemBandwidthBenchmark", () => {
  it("returns a StatValue from the fixed warmup+measured dispatch sequence", async () => {
    const { device, dispatchCalls } = fakeGpuDevice();
    const result = await runMemBandwidthBenchmark(device, 4 * 1024 * 1024 * 1024);

    expect(result).not.toBeNull();
    expect(result?.median).toBeGreaterThan(0);
    // 3 warmup + 10 measured (same convention as matmul.ts)
    expect(dispatchCalls).toHaveLength(13);
  });

  it("returns null instead of throwing when the device can't allocate the working set", async () => {
    const { device } = fakeGpuDevice();
    vi.mocked(device.createBuffer).mockImplementation(() => {
      throw new Error("out of GPU memory");
    });

    const result = await runMemBandwidthBenchmark(device, 4 * 1024 * 1024 * 1024);
    expect(result).toBeNull();
  });
});
