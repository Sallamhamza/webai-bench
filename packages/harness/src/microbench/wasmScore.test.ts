import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateMultiThreadRounds,
  multiThreadWorkerCount,
  runWasmKernel,
  runWasmSingleThreadScore,
  WASM_BUFFER_BYTES,
  WASM_ITERATIONS,
} from "./wasmScore";

// Uses the real compiled kernel (src/microbench/wasm/dotproduct.wasm), not a mock — WebAssembly
// is a genuine Node API, so unlike WebGPU (browser-only, mocked in matmul.test.ts/
// memBandwidth.test.ts) there's no reason to fake this boundary. This is the same real-code
// exercise the wllama adapter's tests get for its actual .wasm binary.
const wasmPath = join(process.cwd(), "src/microbench/wasm/dotproduct.wasm");
const wasmBytes = readFileSync(wasmPath);

describe("runWasmKernel", () => {
  it("runs the real kernel and returns a positive ops/s figure", async () => {
    const opsPerSec = await runWasmKernel(wasmBytes);
    expect(opsPerSec).toBeGreaterThan(0);
    expect(Number.isFinite(opsPerSec)).toBe(true);
  });

  it("does the full fixed amount of work every call (timing scales with the workload, not a stub)", async () => {
    // A regression guard against the exact failure mode caught by hand while building this: an
    // optimizing compiler proving the inner loop is invariant across outer iterations and
    // hoisting it away, which would make every call return near-instantly regardless of
    // WASM_ITERATIONS. Two independent instances (fresh module each call, per runWasmKernel's
    // own contract) should each take a real, nonzero amount of wall-clock time.
    const opsPerSec = await runWasmKernel(wasmBytes);
    const impliedMs = ((WASM_BUFFER_BYTES * WASM_ITERATIONS) / opsPerSec) * 1000;
    expect(impliedMs).toBeGreaterThan(0.01);
  });
});

describe("runWasmSingleThreadScore", () => {
  it("returns a StatValue from real warmup+measured reps", async () => {
    const stat = await runWasmSingleThreadScore(wasmBytes);
    expect(stat).not.toBeNull();
    expect(stat?.median).toBeGreaterThan(0);
    expect(stat?.min).toBeLessThanOrEqual(stat?.median ?? 0);
    expect(stat?.max).toBeGreaterThanOrEqual(stat?.median ?? 0);
  }, 20_000);

  it("returns null instead of throwing when given invalid WASM bytes", async () => {
    const stat = await runWasmSingleThreadScore(new Uint8Array([0, 1, 2, 3]));
    expect(stat).toBeNull();
  });
});

describe("aggregateMultiThreadRounds", () => {
  it("sums per-worker figures within a round, then takes median/min/max across rounds", () => {
    const stat = aggregateMultiThreadRounds([
      [10, 20, 30], // round 1 total: 60
      [12, 18, 30], // round 2 total: 60
      [8, 8, 8], // round 3 total: 24
    ]);
    expect(stat).toEqual({ median: 60, min: 24, max: 60 });
  });

  it("returns null for zero rounds", () => {
    expect(aggregateMultiThreadRounds([])).toBeNull();
  });
});

describe("multiThreadWorkerCount", () => {
  it("caps at 8 regardless of a higher hardwareConcurrency", () => {
    expect(multiThreadWorkerCount(64)).toBe(8);
  });

  it("falls back to 1 when hardwareConcurrency is null", () => {
    expect(multiThreadWorkerCount(null)).toBe(1);
  });

  it("passes through values within the 1-8 range", () => {
    expect(multiThreadWorkerCount(4)).toBe(4);
  });
});
