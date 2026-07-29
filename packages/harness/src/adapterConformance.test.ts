import { describe, expect, it, vi } from "vitest";
import {
  checkAdapterMeta,
  checkErrorSurfacing,
  checkInitAndDispose,
  checkMidRunDisposeAborts,
  checkRunOnceLifecycle,
} from "./adapterConformance";
import type { AdapterMeta, CellAdapter, CellSample } from "./runner";

function goodMeta(overrides: Partial<AdapterMeta> = {}): AdapterMeta {
  return { runtime: "fake-runtime", runtimeVersion: "1.2.3", supportsWorker: false, ...overrides };
}

function goodSample(overrides: Partial<CellSample> = {}): CellSample {
  return {
    ttftMs: 900,
    decodeTps: 14,
    tokensGenerated: 128,
    runtimeReportedTps: 14.5,
    embedSps: null,
    batching: null,
    ...overrides,
  };
}

function wellBehavedAdapter(overrides: Partial<CellAdapter> = {}): CellAdapter {
  return {
    meta: goodMeta(),
    init: vi.fn().mockResolvedValue(undefined),
    runOnce: vi.fn().mockResolvedValue(goodSample()),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// A well-behaved adapter should pass every check — sanity baseline before proving each check
// also catches its specific violation.
describe("conformance checks — well-behaved adapter passes everything", () => {
  it("checkAdapterMeta", () => {
    expect(() => checkAdapterMeta(() => wellBehavedAdapter())).not.toThrow();
  });

  it("checkInitAndDispose", async () => {
    await expect(checkInitAndDispose(() => wellBehavedAdapter())).resolves.toBeUndefined();
  });

  it("checkRunOnceLifecycle", async () => {
    await expect(checkRunOnceLifecycle(() => wellBehavedAdapter())).resolves.toBeUndefined();
  });

  it("checkMidRunDisposeAborts", async () => {
    // A well-behaved adapter's dispose() makes any in-flight runOnce() reject immediately
    // rather than leaving it to hang until it naturally resolves (or never does).
    let abort: (() => void) | undefined;
    const adapter = wellBehavedAdapter({
      runOnce: vi.fn(
        () =>
          new Promise<CellSample>((_resolve, reject) => {
            abort = () => reject(new Error("aborted"));
          }),
      ),
      dispose: vi.fn(async () => {
        abort?.();
      }),
    });

    await expect(checkMidRunDisposeAborts(() => adapter, 200)).resolves.toBeUndefined();
  });

  it("checkErrorSurfacing", async () => {
    const failingAdapter = wellBehavedAdapter({
      init: vi.fn().mockRejectedValue(new Error("adapter unavailable")),
    });
    await expect(checkErrorSurfacing(() => failingAdapter)).resolves.toBeUndefined();
  });
});

describe("checkAdapterMeta — catches violations", () => {
  it("rejects an empty runtime string", () => {
    expect(() =>
      checkAdapterMeta(() => wellBehavedAdapter({ meta: goodMeta({ runtime: "" }) })),
    ).toThrow(/runtime/);
  });

  it("rejects an empty runtimeVersion string", () => {
    expect(() =>
      checkAdapterMeta(() => wellBehavedAdapter({ meta: goodMeta({ runtimeVersion: "" }) })),
    ).toThrow(/runtimeVersion/);
  });

  it("rejects a non-boolean supportsWorker", () => {
    const badMeta = { ...goodMeta(), supportsWorker: "yes" as unknown as boolean };
    expect(() => checkAdapterMeta(() => wellBehavedAdapter({ meta: badMeta }))).toThrow(
      /supportsWorker/,
    );
  });
});

describe("checkInitAndDispose — catches violations", () => {
  it("propagates a throwing init()", async () => {
    const adapter = wellBehavedAdapter({ init: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(checkInitAndDispose(() => adapter)).rejects.toThrow("boom");
  });

  it("propagates a throwing dispose()", async () => {
    const adapter = wellBehavedAdapter({ dispose: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(checkInitAndDispose(() => adapter)).rejects.toThrow("boom");
  });
});

describe("checkRunOnceLifecycle — catches violations", () => {
  it("rejects a negative ttftMs", async () => {
    const adapter = wellBehavedAdapter({
      runOnce: vi.fn().mockResolvedValue(goodSample({ ttftMs: -1 })),
    });
    await expect(checkRunOnceLifecycle(() => adapter)).rejects.toThrow(/ttftMs/);
  });

  it("rejects a non-integer tokensGenerated", async () => {
    const adapter = wellBehavedAdapter({
      runOnce: vi.fn().mockResolvedValue(goodSample({ tokensGenerated: 12.5 })),
    });
    await expect(checkRunOnceLifecycle(() => adapter)).rejects.toThrow(/tokensGenerated/);
  });

  it("rejects a negative decodeTps", async () => {
    const adapter = wellBehavedAdapter({
      runOnce: vi.fn().mockResolvedValue(goodSample({ decodeTps: -5 })),
    });
    await expect(checkRunOnceLifecycle(() => adapter)).rejects.toThrow(/decodeTps/);
  });

  it("still calls dispose() even when a sample fails validation", async () => {
    const adapter = wellBehavedAdapter({
      runOnce: vi.fn().mockResolvedValue(goodSample({ ttftMs: -1 })),
    });
    await expect(checkRunOnceLifecycle(() => adapter)).rejects.toThrow();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
});

describe("checkMidRunDisposeAborts — catches violations", () => {
  it("times out when neither runOnce() nor dispose() ever settle", async () => {
    const hangingAdapter = wellBehavedAdapter({
      runOnce: vi.fn(() => new Promise<CellSample>(() => {})),
      dispose: vi.fn(() => new Promise<void>(() => {})),
    });
    await expect(checkMidRunDisposeAborts(() => hangingAdapter, 50)).rejects.toThrow(/did not/);
  });
});

describe("checkErrorSurfacing — catches violations", () => {
  it("fails when init() resolves instead of rejecting", async () => {
    const adapter = wellBehavedAdapter(); // init() resolves
    await expect(checkErrorSurfacing(() => adapter)).rejects.toThrow(/expected/);
  });

  it("fails when init() rejects with a non-Error value", async () => {
    // Deliberately simulating a bad adapter that violates the "reject with an Error" contract.
    const adapter = wellBehavedAdapter({ init: vi.fn().mockRejectedValue("just a string") });
    await expect(checkErrorSurfacing(() => adapter)).rejects.toThrow(/non-Error/);
  });

  it("fails when init() rejects with an empty-message Error", async () => {
    const adapter = wellBehavedAdapter({ init: vi.fn().mockRejectedValue(new Error("")) });
    await expect(checkErrorSurfacing(() => adapter)).rejects.toThrow(/empty message/);
  });
});
