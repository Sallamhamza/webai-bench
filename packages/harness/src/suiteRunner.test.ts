import { describe, expect, it, vi } from "vitest";
import { runSuite, type SuiteCellSpec, type SuiteProgressEvent } from "./suiteRunner";
import type { CellAdapter, CellSample } from "./runner";
import type { ProbeResult } from "./probe";

function fakeProbe(): ProbeResult {
  return {
    webgpu: {
      available: true,
      vendor: "nvidia",
      architecture: "ampere",
      features: [],
      limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1 },
    },
    wasm: { simd: true, threads: true },
    crossOriginIsolated: true,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    browser: { family: "chrome", major: 138 },
    os: { family: "windows", versionCoarse: "11" },
  };
}

function goodSample(): CellSample {
  return {
    ttftMs: 1,
    decodeTps: 1,
    tokensGenerated: 1,
    runtimeReportedTps: 1,
    embedSps: null,
    batching: null,
  };
}

function fakeAdapter(overrides: Partial<CellAdapter> = {}): CellAdapter {
  return {
    meta: { runtime: "fake", runtimeVersion: "0.0.0", supportsWorker: false },
    init: vi.fn().mockResolvedValue(undefined),
    runOnce: vi.fn().mockResolvedValue(goodSample()),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function cellSpec(cellId: string, adapter: CellAdapter): SuiteCellSpec {
  return { cellId, createAdapter: () => adapter, minRequirements: {} };
}

describe("runSuite — happy path", () => {
  it("runs every cell in order and collects results by cell_id", async () => {
    const adapterA = fakeAdapter();
    const adapterB = fakeAdapter();
    const { result } = runSuite(
      [cellSpec("cell-a", adapterA), cellSpec("cell-b", adapterB)],
      fakeProbe(),
      { cooldownMs: 0 },
    );

    const results = await result;
    expect(results.size).toBe(2);
    expect(results.get("cell-a")?.status).toBe("success");
    expect(results.get("cell-b")?.status).toBe("success");
  });

  it("calls createAdapter once per cell, not shared across cells", async () => {
    const createAdapter = vi.fn(() => fakeAdapter());
    const { result } = runSuite(
      [
        { cellId: "a", createAdapter, minRequirements: {} },
        { cellId: "b", createAdapter, minRequirements: {} },
      ],
      fakeProbe(),
      { cooldownMs: 0 },
    );
    await result;
    expect(createAdapter).toHaveBeenCalledTimes(2);
  });

  it("passes RunCellOptions (e.g. repsPerCell) through to runCell", async () => {
    const adapter = fakeAdapter();
    const { result } = runSuite([cellSpec("a", adapter)], fakeProbe(), {
      cooldownMs: 0,
      repsPerCell: 5,
    });
    const results = await result;
    expect(results.get("a")?.samples).toHaveLength(5);
  });

  it("fires onProgress with starting then done, correct index/total, for each cell", async () => {
    const events: SuiteProgressEvent[] = [];
    const { result } = runSuite(
      [cellSpec("a", fakeAdapter()), cellSpec("b", fakeAdapter())],
      fakeProbe(),
      { cooldownMs: 0, onProgress: (e) => events.push(e) },
    );
    await result;

    expect(events.map((e) => [e.cellId, e.phase, e.index, e.total])).toEqual([
      ["a", "starting", 0, 2],
      ["a", "done", 0, 2],
      ["b", "starting", 1, 2],
      ["b", "done", 1, 2],
    ]);
    expect(events[1]?.result?.status).toBe("success");
  });
});

describe("runSuite — stop()", () => {
  it("stopping before any cell starts runs nothing", async () => {
    const adapter = fakeAdapter();
    const { result, stop } = runSuite([cellSpec("a", adapter)], fakeProbe(), { cooldownMs: 0 });
    stop();
    const results = await result;

    expect(results.size).toBe(0);
    expect(adapter.init).not.toHaveBeenCalled();
  });

  it("stopping after the first cell completes skips remaining cells", async () => {
    const adapterA = fakeAdapter();
    const adapterB = fakeAdapter();
    const { result, stop } = runSuite(
      [cellSpec("a", adapterA), cellSpec("b", adapterB)],
      fakeProbe(),
      {
        cooldownMs: 0,
        onProgress: (e) => {
          if (e.cellId === "a" && e.phase === "done") stop();
        },
      },
    );
    const results = await result;

    expect(results.has("a")).toBe(true);
    expect(results.has("b")).toBe(false);
    expect(adapterB.init).not.toHaveBeenCalled();
  });

  it("stopping mid-run disposes the currently active adapter", async () => {
    let releaseRunOnce: (() => void) | undefined;
    const adapter = fakeAdapter({
      runOnce: vi.fn(
        () =>
          new Promise<CellSample>((resolve, reject) => {
            releaseRunOnce = () => reject(new Error("stopped"));
            void resolve; // keep resolve referenced; only the reject path is exercised here
          }),
      ),
    });
    const dispose = vi.fn(async () => {
      releaseRunOnce?.();
    });
    const stoppableAdapter = { ...adapter, dispose };

    const { result, stop } = runSuite([cellSpec("a", stoppableAdapter)], fakeProbe(), {
      cooldownMs: 0,
    });

    // Give the adapter a moment to reach the in-flight runOnce() call, then stop.
    await new Promise((resolve) => setTimeout(resolve, 10));
    stop();

    const results = await result;
    expect(dispose).toHaveBeenCalled();
    expect(results.get("a")?.status).toBe("error");
  });

  it("does not dispose an adapter twice just because stop() and runCell's own teardown both fire", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = fakeAdapter({ dispose });
    const { result, stop } = runSuite([cellSpec("a", adapter)], fakeProbe(), { cooldownMs: 0 });

    const results = await result; // cell already finished naturally
    stop(); // stop() called after the fact — should be a harmless no-op

    expect(results.get("a")?.status).toBe("success");
    expect(dispose).toHaveBeenCalledOnce();
  });
});
