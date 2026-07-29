import { afterEach, describe, expect, it, vi } from "vitest";
import { pipeline } from "@huggingface/transformers";
import { createTransformersJsAdapter } from "./transformersjs";
import {
  checkAdapterMeta,
  checkErrorSurfacing,
  checkInitAndDispose,
  checkMidRunDisposeAborts,
  checkRunOnceLifecycle,
} from "../adapterConformance";

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
}));

const SENTENCES = ["one", "two", "three"];

function fakeExtractor(overrides: Record<string, unknown> = {}) {
  const fn = vi.fn().mockResolvedValue({ dims: [SENTENCES.length, 384] });
  return Object.assign(fn, {
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

afterEach(() => {
  vi.mocked(pipeline).mockReset();
});

describe("createTransformersJsAdapter — meta", () => {
  it("reports runtime/runtimeVersion/supportsWorker", () => {
    const adapter = createTransformersJsAdapter({
      modelId: "Xenova/all-MiniLM-L6-v2",
      device: "wasm",
      sentences: SENTENCES,
    });
    expect(adapter.meta).toEqual({
      runtime: "transformers.js",
      runtimeVersion: "4.2.0",
      supportsWorker: false,
    });
  });

  it("passes the adapter conformance meta check", () => {
    expect(() =>
      checkAdapterMeta(() =>
        createTransformersJsAdapter({
          modelId: "Xenova/all-MiniLM-L6-v2",
          device: "wasm",
          sentences: SENTENCES,
        }),
      ),
    ).not.toThrow();
  });
});

describe("createTransformersJsAdapter — init/dispose", () => {
  it("calls pipeline('feature-extraction', modelId, { device }) with the configured device", async () => {
    vi.mocked(pipeline).mockResolvedValue(fakeExtractor() as never);
    const adapter = createTransformersJsAdapter({
      modelId: "Xenova/all-MiniLM-L6-v2",
      device: "webgpu",
      sentences: SENTENCES,
    });

    await adapter.init();

    expect(pipeline).toHaveBeenCalledWith("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      device: "webgpu",
    });
  });

  it("wraps a pipeline() failure with model id + device context", async () => {
    vi.mocked(pipeline).mockRejectedValue(new Error("unsupported dtype"));
    const adapter = createTransformersJsAdapter({
      modelId: "bad-model",
      device: "wasm",
      sentences: SENTENCES,
    });

    await expect(adapter.init()).rejects.toThrow(/bad-model/);
    await expect(adapter.init()).rejects.toThrow(/wasm/);
    await expect(adapter.init()).rejects.toThrow(/unsupported dtype/);
  });

  it("passes the init/dispose conformance check", async () => {
    vi.mocked(pipeline).mockImplementation(() => Promise.resolve(fakeExtractor() as never));
    await expect(
      checkInitAndDispose(() =>
        createTransformersJsAdapter({
          modelId: "Xenova/all-MiniLM-L6-v2",
          device: "wasm",
          sentences: SENTENCES,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("dispose() is a no-op when init() was never called", async () => {
    const adapter = createTransformersJsAdapter({
      modelId: "Xenova/all-MiniLM-L6-v2",
      device: "wasm",
      sentences: SENTENCES,
    });
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});

describe("createTransformersJsAdapter — runOnce", () => {
  it("throws a clear error if called before init()", async () => {
    const adapter = createTransformersJsAdapter({
      modelId: "Xenova/all-MiniLM-L6-v2",
      device: "wasm",
      sentences: SENTENCES,
    });
    await expect(adapter.runOnce()).rejects.toThrow(/init\(\) must be called/);
  });

  it("throws if sentences is empty", async () => {
    vi.mocked(pipeline).mockResolvedValue(fakeExtractor() as never);
    const adapter = createTransformersJsAdapter({
      modelId: "Xenova/all-MiniLM-L6-v2",
      device: "wasm",
      sentences: [],
    });
    await adapter.init();
    await expect(adapter.runOnce()).rejects.toThrow(/sentences must not be empty/);
  });

  it("with useBatching: true (default), calls the extractor once with the full array", async () => {
    const extractor = fakeExtractor();
    vi.mocked(pipeline).mockResolvedValue(extractor as never);
    const adapter = createTransformersJsAdapter({
      modelId: "Xenova/all-MiniLM-L6-v2",
      device: "wasm",
      sentences: SENTENCES,
    });

    await adapter.init();
    const sample = await adapter.runOnce();

    expect(extractor).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenCalledWith(SENTENCES, { pooling: "mean", normalize: true });
    expect(sample.batching).toBe(true);
  });

  it("with useBatching: false, calls the extractor once per sentence", async () => {
    const extractor = fakeExtractor();
    vi.mocked(pipeline).mockResolvedValue(extractor as never);
    const adapter = createTransformersJsAdapter({
      modelId: "Xenova/all-MiniLM-L6-v2",
      device: "wasm",
      sentences: SENTENCES,
      useBatching: false,
    });

    await adapter.init();
    const sample = await adapter.runOnce();

    expect(extractor).toHaveBeenCalledTimes(SENTENCES.length);
    for (const s of SENTENCES) {
      expect(extractor).toHaveBeenCalledWith(s, { pooling: "mean", normalize: true });
    }
    expect(sample.batching).toBe(false);
  });

  it("computes a positive, finite embedSps and leaves generation fields null", async () => {
    vi.mocked(pipeline).mockResolvedValue(fakeExtractor() as never);
    const adapter = createTransformersJsAdapter({
      modelId: "Xenova/all-MiniLM-L6-v2",
      device: "wasm",
      sentences: SENTENCES,
    });

    await adapter.init();
    const sample = await adapter.runOnce();

    expect(Number.isFinite(sample.embedSps)).toBe(true);
    expect(sample.embedSps).toBeGreaterThan(0);
    expect(sample.ttftMs).toBeNull();
    expect(sample.decodeTps).toBeNull();
    expect(sample.tokensGenerated).toBeNull();
    expect(sample.runtimeReportedTps).toBeNull();
  });

  it("passes the runOnce lifecycle conformance check", async () => {
    vi.mocked(pipeline).mockImplementation(() => Promise.resolve(fakeExtractor() as never));
    await expect(
      checkRunOnceLifecycle(() =>
        createTransformersJsAdapter({
          modelId: "Xenova/all-MiniLM-L6-v2",
          device: "wasm",
          sentences: SENTENCES,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("createTransformersJsAdapter — error surfacing (conformance)", () => {
  it("passes checkErrorSurfacing when pipeline() rejects", async () => {
    vi.mocked(pipeline).mockRejectedValue(new Error("out of memory"));
    await expect(
      checkErrorSurfacing(() =>
        createTransformersJsAdapter({
          modelId: "Xenova/all-MiniLM-L6-v2",
          device: "wasm",
          sentences: SENTENCES,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("createTransformersJsAdapter — mid-run dispose: a REAL, documented limitation", () => {
  it("does NOT satisfy checkMidRunDisposeAborts — dispose() cannot cancel an in-flight call", async () => {
    // Unlike WebLLM's interruptGenerate(), Transformers.js exposes no way to abort a
    // synchronous WASM/WebGPU compute call already in flight. dispose() only frees the
    // underlying session; it does not reject whatever extractor() call is currently running.
    // This test documents that gap rather than pretending it's covered — see
    // adapters/QUIRKS.md. The Stop button (06-security-privacy.md §6.4) will not promptly
    // interrupt a Transformers.js embedding cell until this is solved (candidate: run the
    // pipeline in a Worker and terminate() it, which *is* abortable from outside).
    const hangingExtractor = Object.assign(
      vi.fn(() => new Promise(() => {})),
      {
        dispose: vi.fn().mockResolvedValue(undefined),
      },
    );
    vi.mocked(pipeline).mockResolvedValue(hangingExtractor as never);

    await expect(
      checkMidRunDisposeAborts(
        () =>
          createTransformersJsAdapter({
            modelId: "Xenova/all-MiniLM-L6-v2",
            device: "wasm",
            sentences: SENTENCES,
          }),
        200,
      ),
    ).rejects.toThrow(/did not/);
  });
});
