import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkMinRequirements,
  runCell,
  WatchdogTimeoutError,
  type CellAdapter,
  type CellSample,
} from "./runner";
import { checkForStaleCrashMarker, writeCrashMarker } from "./crashMarker";
import type { ProbeResult } from "./probe";

/** A promise that never settles — the "hangs on command" fake adapter behavior FR2.4 AC4 asks for. */
function hang<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

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
    runOnce: vi.fn().mockResolvedValue({
      ttftMs: 100,
      decodeTps: 14,
      tokensGenerated: 128,
      runtimeReportedTps: 14.5,
    }),
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

    const result = await runCell("test-cell", adapter, { webgpu: true }, probe);

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

    const result = await runCell("test-cell", adapter, {}, fakeProbe());

    expect(result.status).toBe("download-error");
    expect(result.reason).toBe("network down");
    expect(adapter.init).not.toHaveBeenCalled();
    expect(adapter.dispose).not.toHaveBeenCalled();
  });

  it("records cache_hit when download resolves null", async () => {
    const adapter = fakeAdapter({ download: vi.fn().mockResolvedValue(null) });

    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
    expect(result.cacheHit).toBe(true);
    expect(result.download).toBeNull();
  });

  it("records download stats on a cache miss", async () => {
    const adapter = fakeAdapter({
      download: vi.fn().mockResolvedValue({ mb: 1042.7, ms: 183200 }),
    });

    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
    expect(result.cacheHit).toBe(false);
    expect(result.download).toEqual({ mb: 1042.7, ms: 183200 });
  });

  it("defaults to cache_hit: true when the adapter has no download method at all", async () => {
    const adapter = fakeAdapter();
    delete adapter.download;

    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

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

    const result = await runCell("test-cell", adapter, {}, fakeProbe());

    expect(result.status).toBe("init-error");
    expect(result.reason).toBe("adapter unavailable");
    expect(result.initMs).toBeNull();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it("measures a non-negative initMs on success", async () => {
    const adapter = fakeAdapter();
    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });
    expect(result.initMs).toBeGreaterThanOrEqual(0);
  });
});

describe("runCell — warmup + measured reps (steps 5-6)", () => {
  it("calls runOnce warmup + repsPerCell times, discarding the warmup sample", async () => {
    const samples = [
      { ttftMs: 999, decodeTps: 14, tokensGenerated: 1, runtimeReportedTps: 1 }, // warmup — must be discarded
      { ttftMs: 100, decodeTps: 14, tokensGenerated: 128, runtimeReportedTps: 14 },
      { ttftMs: 101, decodeTps: 14, tokensGenerated: 128, runtimeReportedTps: 14.1 },
      { ttftMs: 102, decodeTps: 14, tokensGenerated: 128, runtimeReportedTps: 14.2 },
    ];
    const runOnce = vi.fn();
    for (const s of samples) runOnce.mockResolvedValueOnce(s);
    const adapter = fakeAdapter({ runOnce });

    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
    expect(runOnce).toHaveBeenCalledTimes(4); // 1 warmup + 3 measured
    expect(result.samples).toEqual(samples.slice(1));
  });

  it("respects a custom repsPerCell", async () => {
    const adapter = fakeAdapter();
    const result = await runCell("test-cell", adapter, {}, fakeProbe(), {
      repsPerCell: 5,
      cooldownMs: 0,
    });
    expect(result.status).toBe("success");
    expect(result.samples).toHaveLength(5);
    expect(adapter.runOnce).toHaveBeenCalledTimes(6); // 1 warmup + 5 measured
  });

  it("waits cooldownMs between measured reps but not after the last one", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter();
      const promise = runCell("test-cell", adapter, {}, fakeProbe(), {
        repsPerCell: 3,
        cooldownMs: 500,
      });

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
      .mockResolvedValueOnce({
        ttftMs: 1,
        decodeTps: 14,
        tokensGenerated: 1,
        runtimeReportedTps: 1,
      }) // warmup
      .mockResolvedValueOnce({
        ttftMs: 1,
        decodeTps: 14,
        tokensGenerated: 1,
        runtimeReportedTps: 1,
      }) // rep 1
      .mockRejectedValueOnce(new Error("GPUDevice lost")); // rep 2
    const adapter = fakeAdapter({ runOnce });

    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("GPUDevice lost");
    expect(result.samples).toEqual([]);
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
});

describe("runCell — teardown (step 8)", () => {
  it("does not let a failing dispose() mask a successful result", async () => {
    const adapter = fakeAdapter({ dispose: vi.fn().mockRejectedValue(new Error("dispose boom")) });

    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
  });

  it("does not let a failing dispose() mask an error-status result", async () => {
    const adapter = fakeAdapter({
      runOnce: vi.fn().mockRejectedValue(new Error("measurement failed")),
      dispose: vi.fn().mockRejectedValue(new Error("dispose boom")),
    });

    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("measurement failed");
  });
});

describe("runCell — watchdog timeouts (FR2.4)", () => {
  it("times out a hanging init() at timeout_init_ms, still tears down (AC1)", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter({ init: vi.fn(() => hang<void>()) });

      const promise = runCell("test-cell", adapter, {}, fakeProbe(), { timeoutInitMs: 120_000 });
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await promise;

      expect(result.status).toBe("timeout");
      expect(result.reason).toMatch(/^init exceeded its 120000ms timeout$/);
      expect(result.initMs).toBeNull();
      expect(adapter.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hanging measured rep at timeout_run_ms, still tears down (AC2)", async () => {
    vi.useFakeTimers();
    try {
      const runOnce = vi
        .fn()
        .mockResolvedValueOnce({
          ttftMs: 1,
          decodeTps: 14,
          tokensGenerated: 1,
          runtimeReportedTps: 1,
        }) // warmup
        .mockImplementationOnce(() => hang<CellSample>()); // rep 1 hangs
      const adapter = fakeAdapter({ runOnce });

      const promise = runCell("test-cell", adapter, {}, fakeProbe(), {
        cooldownMs: 0,
        timeoutRunMs: 90_000,
      });
      await vi.advanceTimersByTimeAsync(90_000);
      const result = await promise;

      expect(result.status).toBe("timeout");
      expect(result.reason).toMatch(/^measured rep 1 exceeded its 90000ms timeout$/);
      expect(result.samples).toEqual([]);
      expect(adapter.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hanging warmup pass too, naming it distinctly from a measured rep", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter({ runOnce: vi.fn(() => hang<CellSample>()) });

      const promise = runCell("test-cell", adapter, {}, fakeProbe(), { timeoutRunMs: 90_000 });
      await vi.advanceTimersByTimeAsync(90_000);
      const result = await promise;

      expect(result.status).toBe("timeout");
      expect(result.reason).toMatch(/^warmup exceeded its 90000ms timeout$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the registry-supplied timeout values, not a hardcoded constant (AC5)", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter({ init: vi.fn(() => hang<void>()) });

      // A much shorter, cell-specific value than the 120s default — proves the runner actually
      // uses what's passed in rather than an internal constant.
      const promise = runCell("test-cell", adapter, {}, fakeProbe(), { timeoutInitMs: 5_000 });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.status).toBe("timeout");
      expect(result.reason).toMatch(/5000ms/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no stray timers behind after a successful run (AC3)", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter();
      const promise = runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe("success");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no stray timers behind after init-error (non-timeout failure)", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter({ init: vi.fn().mockRejectedValue(new Error("boom")) });
      const promise = runCell("test-cell", adapter, {}, fakeProbe());
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(result.status).toBe("init-error");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with WatchdogTimeoutError internally (exported for callers that need to distinguish it)", () => {
    const err = new WatchdogTimeoutError("init", 120_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WatchdogTimeoutError");
    expect(err.message).toBe("init exceeded its 120000ms timeout");
  });
});

describe("runCell — crash marker (FR2.5, 04 §4 step 3)", () => {
  it("writes the marker before init, clears it on a successful run", async () => {
    let markerDuringInit: ReturnType<typeof checkForStaleCrashMarker> = null;
    const adapter = fakeAdapter({
      init: vi.fn(async () => {
        markerDuringInit = checkForStaleCrashMarker();
      }),
    });

    expect(checkForStaleCrashMarker()).toBeNull();
    const result = await runCell("my-cell-id", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    expect(result.status).toBe("success");
    expect(markerDuringInit).toEqual({ cellId: "my-cell-id", ts: expect.any(String) });
    expect(checkForStaleCrashMarker()).toBeNull(); // cleared at teardown
  });

  it("clears the marker even when the cell ends in init-error", async () => {
    const adapter = fakeAdapter({ init: vi.fn().mockRejectedValue(new Error("boom")) });
    const result = await runCell("my-cell-id", adapter, {}, fakeProbe());
    expect(result.status).toBe("init-error");
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("clears the marker even when the cell times out", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter({ init: vi.fn(() => hang<void>()) });
      const promise = runCell("my-cell-id", adapter, {}, fakeProbe(), { timeoutInitMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.status).toBe("timeout");
      expect(checkForStaleCrashMarker()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the marker even when dispose() itself throws", async () => {
    const adapter = fakeAdapter({ dispose: vi.fn().mockRejectedValue(new Error("dispose boom")) });
    const result = await runCell("my-cell-id", adapter, {}, fakeProbe(), { cooldownMs: 0 });
    expect(result.status).toBe("success");
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("never writes a marker when preflight fails", async () => {
    const adapter = fakeAdapter();
    const probe = fakeProbe({ webgpu: { ...fakeProbe().webgpu, available: false } });
    await runCell("my-cell-id", adapter, { webgpu: true }, probe);
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("never writes a marker when download fails", async () => {
    const adapter = fakeAdapter({ download: vi.fn().mockRejectedValue(new Error("network down")) });
    await runCell("my-cell-id", adapter, {}, fakeProbe());
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("simulates a real crash: a marker left behind by an abandoned run is found stale later", () => {
    // No runCell() call completes here — this stands in for a tab that was killed mid-run,
    // before its finally block ever got a chance to clear the marker.
    writeCrashMarker("abandoned-cell");

    const stale = checkForStaleCrashMarker();
    expect(stale?.cellId).toBe("abandoned-cell");
  });
});

function setVisibilityState(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("runCell — visibility guard (FR2.6, 04 §4 step 7)", () => {
  afterEach(() => {
    setVisibilityState("visible");
  });

  it("stays 'success' when the tab is visible throughout", async () => {
    const adapter = fakeAdapter();
    const result = await runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });
    expect(result.status).toBe("success");
  });

  it("pauses before warmup when hidden, then resumes and reports visibility-interrupted", async () => {
    setVisibilityState("hidden");
    const adapter = fakeAdapter();
    const promise = runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    // Give the guard a chance to register its listener and confirm it's genuinely blocked
    // (a bare microtask flush isn't enough — init()'s own await chain runs first).
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.runOnce).not.toHaveBeenCalled();

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    const result = await promise;

    expect(result.status).toBe("visibility-interrupted");
    expect(result.samples).toHaveLength(3); // still runs to completion once resumed
  });

  it("pauses at a measured-rep boundary when hidden mid-run", async () => {
    const runOnce = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ttftMs: 1,
        decodeTps: 14,
        tokensGenerated: 1,
        runtimeReportedTps: 1,
      })) // warmup, visible
      .mockImplementationOnce(async () => {
        // rep 1 completes, then the tab goes hidden before rep 2's boundary check.
        setVisibilityState("hidden");
        return { ttftMs: 1, decodeTps: 14, tokensGenerated: 1, runtimeReportedTps: 1 };
      })
      .mockResolvedValue({ ttftMs: 1, decodeTps: 14, tokensGenerated: 1, runtimeReportedTps: 1 });
    const adapter = fakeAdapter({ runOnce });

    const promise = runCell("test-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    // Let it run until it blocks at rep 2's boundary.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runOnce).toHaveBeenCalledTimes(2); // warmup + rep 1 only

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    const result = await promise;

    expect(result.status).toBe("visibility-interrupted");
    expect(result.samples).toHaveLength(3);
  });

  it("does not clear the crash marker while paused, and still clears it once done", async () => {
    setVisibilityState("hidden");
    const adapter = fakeAdapter();
    const promise = runCell("paused-cell", adapter, {}, fakeProbe(), { cooldownMs: 0 });

    await Promise.resolve();
    expect(checkForStaleCrashMarker()?.cellId).toBe("paused-cell");

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await promise;

    expect(checkForStaleCrashMarker()).toBeNull();
  });
});
