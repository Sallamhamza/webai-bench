import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProbeResult } from "../probe";
import { runMicroBenchmarks } from "./index";

const wasmBytes = readFileSync(join(process.cwd(), "src/microbench/wasm/dotproduct.wasm"));

function probeWithWebgpu(available: boolean): ProbeResult {
  return {
    webgpu: {
      available,
      vendor: null,
      architecture: null,
      features: [],
      limits: {
        maxBufferSize: 1024 * 1024 * 1024,
        maxStorageBufferBindingSize: 1024 * 1024 * 1024,
      },
    },
    wasm: { simd: true, threads: false },
    crossOriginIsolated: false,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    browser: { family: "chrome", major: 138 },
    os: { family: "windows", versionCoarse: "11" },
  };
}

describe("runMicroBenchmarks", () => {
  it("always runs the WASM single-thread score even without WebGPU", async () => {
    const result = await runMicroBenchmarks(probeWithWebgpu(false), wasmBytes);

    expect(result.wasmScoreSingle).not.toBeNull();
    expect(result.matmulF32Gflops).toBeNull();
    expect(result.matmulF16Gflops).toBeNull();
    expect(result.memBwGbps).toBeNull();
  }, 20_000);

  it("passes wasmScoreMulti through unchanged (multi-thread orchestration is the caller's job)", async () => {
    const multi = { median: 100, min: 90, max: 110 };
    const result = await runMicroBenchmarks(probeWithWebgpu(false), wasmBytes, multi);
    expect(result.wasmScoreMulti).toEqual(multi);
  }, 20_000);

  it("defaults wasmScoreMulti to null when the caller doesn't supply it", async () => {
    const result = await runMicroBenchmarks(probeWithWebgpu(false), wasmBytes);
    expect(result.wasmScoreMulti).toBeNull();
  }, 20_000);

  it("degrades GPU metrics to null (not a throw) when the probe says WebGPU is available but this environment can't actually acquire a device", async () => {
    // jsdom/Node has no navigator.gpu — exercises acquireDevice()'s own null-device path, the
    // same "probe said yes, reality said no" gap a real browser could hit too (e.g. a device
    // lost between probe time and run time).
    const result = await runMicroBenchmarks(probeWithWebgpu(true), wasmBytes);
    expect(result.matmulF32Gflops).toBeNull();
    expect(result.memBwGbps).toBeNull();
    expect(result.wasmScoreSingle).not.toBeNull();
  }, 20_000);
});
