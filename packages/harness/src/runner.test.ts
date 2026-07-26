import { describe, expect, it, vi } from "vitest";
import { checkMinRequirements, runCell, type CellAdapter } from "./runner";
import type { ProbeResult } from "./probe";

function fakeProbe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    webgpu: {
      available: true,
      vendor: "nvidia",
      architecture: "ampere",
      features: ["shader-f16"],
      limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824 },
    },
    wasm: { simd: true, threads: true },
    crossOriginIsolated: true,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    browser: { family: "chrome", major: 138 },
    os: { family: "windows", versionCoarse: "11" },
    ...overrides,
  };
}

function fakeAdapter(overrides: Partial<CellAdapter> = {}): CellAdapter {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    runOnce: vi
      .fn()
      .mockResolvedValue({ ttftMs: 100, tokensGenerated: 128, runtimeReportedTps: 14.5 }),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("checkMinRequirements", () => {
  it("passes when no requirements are declared", () => {
    expect(checkMinRequirements({}, fakeProbe())).toBeNull();
  });

  it("rejects when webgpu is required but unavailable", () => {
    const reason = checkMinRequirements(
      { webgpu: true },
      fakeProbe({ webgpu: { ...fakeProbe().webgpu, available: false } }),
    );
    expect(reason).toMatch(/WebGPU/);
  });

  it("rejects when a required webgpu feature is missing", () => {
    const reason = checkMinRequirements(
      { webgpuFeatures: ["shader-f16"] },
      fakeProbe({ webgpu: { ...fakeProbe().webgpu, features: [] } }),
    );
    expect(reason).toMatch(/shader-f16/);
  });

  it("rejects when wasm simd is required but unsupported", () => {
    const reason = checkMinRequirements(
      { wasmSimd: true },
      fakeProbe({ wasm: { simd: false, threads: true } }),
    );
    expect(reason).toMatch(/SIMD/);
  });

  it("rejects when wasm threads is required but unsupported", () => {
    const reason = checkMinRequirements(
      { wasmThreads: true },
      fakeProbe({ wasm: { simd: true, threads: false } }),
    );
    expect(reason).toMatch(/threads/);
  });
});

describe("runCell — preflight (step 1)", () => {
  it("returns unsupported and never touches the adapter when preflight fails", async () => {
    const adapter = fakeAdapter();
    const probe = fakeProbe({ webgpu: { ...fakeProbe().webgpu, available: false } });

    const result = await runCell(adapter, { webgpu: true }, probe);

    expect(result.status).toBe("unsupported");
    expect(result.reason).toMatch(/WebGPU/);
    expect(result.samples).toEqual([]);
    expect(adapter.init).not.toHaveBeenCalled();
    expect(adapter.dispose).not.toHaveBeenCalled();
  });
});

describe("runCell — download (step 2)", () => {
  it("returns download-error and never calls init when download rejects", async () => {
    const adapter = fakeAdapter({ download: vi.fn().mockRejectedValue(new Error("network down")) });

    const result = await runCell(adapter, {}, fakeProbe());

    expect(result.status).toBe("download-error");
    expect(result.reason).toBe("network down");
    expect(adapter.init).not.toHaveBeenCalled();
    expect(adapter.dispose).not.toHaveBeenCalled();
  });

  it("records cache_hit when download resolves null", async () => {
    const adapter = fakeAdapter({ download: vi.fn().mockResolvedValue(null) });

    const result = await runCell(adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
    expect(result.cacheHit).toBe(true);
    expect(result.download).toBeNull();
  });

  it("records download stats on a cache miss", async () => {
    const adapter = fakeAdapter({
      download: vi.fn().mockResolvedValue({ mb: 1042.7, ms: 183200 }),
    });

    const result = await runCell(adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
    expect(result.cacheHit).toBe(false);
    expect(result.download).toEqual({ mb: 1042.7, ms: 183200 });
  });

  it("defaults to cache_hit: true when the adapter has no download method at all", async () => {
    const adapter = fakeAdapter();
    delete adapter.download;

    const result = await runCell(adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
    expect(result.cacheHit).toBe(true);
    expect(result.download).toBeNull();
  });
});

describe("runCell — init (step 4)", () => {
  it("returns init-error and still calls dispose when init throws", async () => {
    const adapter = fakeAdapter({
      init: vi.fn().mockRejectedValue(new Error("adapter unavailable")),
    });

    const result = await runCell(adapter, {}, fakeProbe());

    expect(result.status).toBe("init-error");
    expect(result.reason).toBe("adapter unavailable");
    expect(result.initMs).toBeNull();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it("measures a non-negative initMs on success", async () => {
    const adapter = fakeAdapter();
    const result = await runCell(adapter, {}, fakeProbe(), { cooldownMs: 0 });
    expect(result.initMs).toBeGreaterThanOrEqual(0);
  });
});

describe("runCell — warmup + measured reps (steps 5-6)", () => {
  it("calls runOnce warmup + repsPerCell times, discarding the warmup sample", async () => {
    const samples = [
      { ttftMs: 999, tokensGenerated: 1, runtimeReportedTps: 1 }, // warmup — must be discarded
      { ttftMs: 100, tokensGenerated: 128, runtimeReportedTps: 14 },
      { ttftMs: 101, tokensGenerated: 128, runtimeReportedTps: 14.1 },
      { ttftMs: 102, tokensGenerated: 128, runtimeReportedTps: 14.2 },
    ];
    const runOnce = vi.fn();
    for (const s of samples) runOnce.mockResolvedValueOnce(s);
    const adapter = fakeAdapter({ runOnce });

    const result = await runCell(adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
    expect(runOnce).toHaveBeenCalledTimes(4); // 1 warmup + 3 measured
    expect(result.samples).toEqual(samples.slice(1));
  });

  it("respects a custom repsPerCell", async () => {
    const adapter = fakeAdapter();
    const result = await runCell(adapter, {}, fakeProbe(), { repsPerCell: 5, cooldownMs: 0 });
    expect(result.status).toBe("success");
    expect(result.samples).toHaveLength(5);
    expect(adapter.runOnce).toHaveBeenCalledTimes(6); // 1 warmup + 5 measured
  });

  it("waits cooldownMs between measured reps but not after the last one", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter();
      const promise = runCell(adapter, {}, fakeProbe(), { repsPerCell: 3, cooldownMs: 500 });

      // init + warmup + rep 1 are all already-resolved mocks, so flushing microtasks (advancing
      // by 0) is enough to reach the first inter-rep cooldown.
      await vi.advanceTimersByTimeAsync(0);
      expect(adapter.runOnce).toHaveBeenCalledTimes(2); // warmup + rep 1

      await vi.advanceTimersByTimeAsync(500); // cooldown after rep 1 -> rep 2 runs
      expect(adapter.runOnce).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(500); // cooldown after rep 2 -> rep 3 runs, then no more cooldown
      expect(adapter.runOnce).toHaveBeenCalledTimes(4);

      const result = await promise;
      expect(result.status).toBe("success");
      expect(result.samples).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns status 'error' and still tears down when a measured rep throws", async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce({ ttftMs: 1, tokensGenerated: 1, runtimeReportedTps: 1 }) // warmup
      .mockResolvedValueOnce({ ttftMs: 1, tokensGenerated: 1, runtimeReportedTps: 1 }) // rep 1
      .mockRejectedValueOnce(new Error("GPUDevice lost")); // rep 2
    const adapter = fakeAdapter({ runOnce });

    const result = await runCell(adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("GPUDevice lost");
    expect(result.samples).toEqual([]);
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
});

describe("runCell — teardown (step 8)", () => {
  it("does not let a failing dispose() mask a successful result", async () => {
    const adapter = fakeAdapter({ dispose: vi.fn().mockRejectedValue(new Error("dispose boom")) });

    const result = await runCell(adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
  });

  it("does not let a failing dispose() mask an error-status result", async () => {
    const adapter = fakeAdapter({
      runOnce: vi.fn().mockRejectedValue(new Error("measurement failed")),
      dispose: vi.fn().mockRejectedValue(new Error("dispose boom")),
    });

    const result = await runCell(adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("measurement failed");
  });
});
