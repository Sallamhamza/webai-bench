import { afterEach, describe, expect, it, vi } from "vitest";
import { Wllama } from "@wllama/wllama/esm/index.js";
import { createWllamaAdapter } from "./wllama";
import {
  checkAdapterMeta,
  checkErrorSurfacing,
  checkInitAndDispose,
  checkMidRunDisposeAborts,
  checkRunOnceLifecycle,
} from "../adapterConformance";

vi.mock("@wllama/wllama/esm/index.js", () => ({
  Wllama: vi.fn(),
}));

interface FakeChunk {
  choices: [{ delta: { content?: string } }];
  usage?: { completion_tokens: number };
  timings?: { predicted_per_second: number };
}

function fakeStream(chunks: FakeChunk[]): AsyncIterable<FakeChunk> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () =>
          Promise.resolve(
            i < chunks.length
              ? { value: chunks[i++]!, done: false }
              : { value: undefined, done: true },
          ),
      };
    },
  };
}

function tokenChunks(n: number, predictedPerSecond = 40): FakeChunk[] {
  const chunks: FakeChunk[] = [];
  for (let i = 0; i < n; i++) {
    chunks.push({ choices: [{ delta: { content: "x" } }] });
  }
  chunks.push({
    choices: [{ delta: {} }],
    usage: { completion_tokens: n },
    timings: { predicted_per_second: predictedPerSecond },
  });
  return chunks;
}

function fakeInstance(overrides: Record<string, unknown> = {}) {
  return {
    cacheManager: {
      open: vi.fn().mockResolvedValue(null),
      download: vi.fn().mockResolvedValue(undefined),
    },
    loadModelFromUrl: vi.fn().mockResolvedValue(undefined),
    createChatCompletion: vi.fn().mockResolvedValue(fakeStream(tokenChunks(128))),
    exit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const ASSETS_PATH = { default: "https://example.com/wllama.wasm" };

afterEach(() => {
  vi.mocked(Wllama).mockReset();
});

describe("createWllamaAdapter — meta", () => {
  it("reports runtime/runtimeVersion/supportsWorker", () => {
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });
    expect(adapter.meta).toEqual({
      runtime: "wllama",
      runtimeVersion: "3.5.1",
      supportsWorker: false,
    });
  });

  it("passes the adapter conformance meta check", () => {
    expect(() =>
      checkAdapterMeta(() =>
        createWllamaAdapter({
          assetsPath: ASSETS_PATH,
          modelUrl: "https://example.com/model.gguf",
          prompt: "hi",
        }),
      ),
    ).not.toThrow();
  });
});

describe("createWllamaAdapter — download", () => {
  it("returns null (cache hit) when cacheManager.open finds an existing blob", async () => {
    const instance = fakeInstance({
      cacheManager: { open: vi.fn().mockResolvedValue(new Blob(["x"])), download: vi.fn() },
    });
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    const result = await adapter.download?.();
    expect(result).toBeNull();
    expect(instance.cacheManager.download).not.toHaveBeenCalled();
  });

  it("downloads and reports mb/ms from progressCallback on a cache miss", async () => {
    const instance = fakeInstance({
      cacheManager: {
        open: vi.fn().mockResolvedValue(null),
        download: vi
          .fn()
          .mockImplementation(
            async (
              _url: string,
              opts: { progressCallback?: (p: { loaded: number; total: number }) => void },
            ) => {
              opts.progressCallback?.({ loaded: 5 * 1024 * 1024, total: 5 * 1024 * 1024 });
            },
          ),
      },
    });
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    const result = await adapter.download?.();
    expect(result).not.toBeNull();
    expect(result?.mb).toBeCloseTo(5, 5);
    expect(result?.ms).toBeGreaterThanOrEqual(0);
  });

  it("wraps a download failure with model URL context", async () => {
    const instance = fakeInstance({
      cacheManager: {
        open: vi.fn().mockResolvedValue(null),
        download: vi.fn().mockRejectedValue(new Error("network down")),
      },
    });
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    await expect(adapter.download?.()).rejects.toThrow(/model\.gguf/);
    await expect(adapter.download?.()).rejects.toThrow(/network down/);
  });
});

describe("createWllamaAdapter — init/dispose", () => {
  it("calls loadModelFromUrl with useCache: true", async () => {
    const instance = fakeInstance();
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    await adapter.init();

    expect(instance.loadModelFromUrl).toHaveBeenCalledWith("https://example.com/model.gguf", {
      useCache: true,
    });
  });

  it("wraps an init failure with model URL context", async () => {
    const instance = fakeInstance({
      loadModelFromUrl: vi.fn().mockRejectedValue(new Error("bad gguf")),
    });
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    await expect(adapter.init()).rejects.toThrow(/model\.gguf/);
    await expect(adapter.init()).rejects.toThrow(/bad gguf/);
  });

  it("passes the init/dispose conformance check", async () => {
    vi.mocked(Wllama).mockImplementation(() => fakeInstance() as never);
    await expect(
      checkInitAndDispose(() =>
        createWllamaAdapter({
          assetsPath: ASSETS_PATH,
          modelUrl: "https://example.com/model.gguf",
          prompt: "hi",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("dispose() is a no-op when init()/download() were never called", async () => {
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });

  it("reuses the same instance created by download() in init() (no second Wllama construction)", async () => {
    vi.mocked(Wllama).mockImplementation(() => fakeInstance() as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    await adapter.download?.();
    await adapter.init();

    expect(Wllama).toHaveBeenCalledTimes(1);
  });
});

describe("createWllamaAdapter — runOnce", () => {
  it("throws a clear error if called before init()", async () => {
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });
    await expect(adapter.runOnce()).rejects.toThrow(/init\(\) must be called/);
  });

  it("computes ttftMs/decodeTps/tokensGenerated/runtimeReportedTps from the stream", async () => {
    const instance = fakeInstance({
      createChatCompletion: vi.fn().mockResolvedValue(fakeStream(tokenChunks(128, 42))),
    });
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    await adapter.init();
    const sample = await adapter.runOnce();

    expect(sample.tokensGenerated).toBe(128);
    expect(sample.runtimeReportedTps).toBe(42);
    expect(sample.ttftMs).toBeGreaterThanOrEqual(0);
    expect(sample.decodeTps).toBeGreaterThan(0);
    expect(sample.embedSps).toBeNull();
    expect(sample.batching).toBeNull();
  });

  it("passes an AbortSignal to createChatCompletion", async () => {
    const instance = fakeInstance();
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    await adapter.init();
    await adapter.runOnce();

    const call = instance.createChatCompletion.mock.calls[0]?.[0];
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("throws if no tokens are ever generated", async () => {
    const instance = fakeInstance({
      createChatCompletion: vi
        .fn()
        .mockResolvedValue(
          fakeStream([{ choices: [{ delta: {} }], usage: { completion_tokens: 0 } }]),
        ),
    });
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    const adapter = createWllamaAdapter({
      assetsPath: ASSETS_PATH,
      modelUrl: "https://example.com/model.gguf",
      prompt: "hi",
    });

    await adapter.init();
    await expect(adapter.runOnce()).rejects.toThrow(/no tokens/);
  });

  it("passes the runOnce lifecycle conformance check", async () => {
    vi.mocked(Wllama).mockImplementation(() => fakeInstance() as never);
    await expect(
      checkRunOnceLifecycle(() =>
        createWllamaAdapter({
          assetsPath: ASSETS_PATH,
          modelUrl: "https://example.com/model.gguf",
          prompt: "hi",
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("createWllamaAdapter — mid-run dispose (conformance)", () => {
  it("passes checkMidRunDisposeAborts via a real AbortSignal", async () => {
    const instance = fakeInstance({
      createChatCompletion: vi.fn(
        (opts: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    });
    vi.mocked(Wllama).mockImplementation(() => instance as never);

    await expect(
      checkMidRunDisposeAborts(
        () =>
          createWllamaAdapter({
            assetsPath: ASSETS_PATH,
            modelUrl: "https://example.com/model.gguf",
            prompt: "hi",
          }),
        500,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("createWllamaAdapter — error surfacing (conformance)", () => {
  it("passes checkErrorSurfacing when loadModelFromUrl rejects", async () => {
    const instance = fakeInstance({
      loadModelFromUrl: vi.fn().mockRejectedValue(new Error("out of memory")),
    });
    vi.mocked(Wllama).mockImplementation(() => instance as never);
    await expect(
      checkErrorSurfacing(() =>
        createWllamaAdapter({
          assetsPath: ASSETS_PATH,
          modelUrl: "https://example.com/model.gguf",
          prompt: "hi",
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
