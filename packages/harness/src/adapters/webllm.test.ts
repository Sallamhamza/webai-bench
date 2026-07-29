import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { createWebLLMAdapter } from "./webllm";
import {
  checkAdapterMeta,
  checkErrorSurfacing,
  checkInitAndDispose,
  checkMidRunDisposeAborts,
  checkRunOnceLifecycle,
} from "../adapterConformance";

vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: vi.fn(),
}));

interface FakeChunk {
  choices: [{ delta: { content?: string } }];
  usage?: { completion_tokens: number; extra: { decode_tokens_per_s: number } };
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

function tokenChunks(n: number, decodeTokensPerS = 14): FakeChunk[] {
  const chunks: FakeChunk[] = [];
  for (let i = 0; i < n; i++) {
    chunks.push({ choices: [{ delta: { content: "x" } }] });
  }
  chunks.push({
    choices: [{ delta: {} }],
    usage: { completion_tokens: n, extra: { decode_tokens_per_s: decodeTokensPerS } },
  });
  return chunks;
}

function fakeEngine(overrides: Record<string, unknown> = {}) {
  return {
    resetChat: vi.fn().mockResolvedValue(undefined),
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(fakeStream(tokenChunks(128))),
      },
    },
    interruptGenerate: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.mocked(CreateMLCEngine).mockReset();
});

describe("createWebLLMAdapter — meta", () => {
  it("reports runtime/runtimeVersion/supportsWorker", () => {
    const adapter = createWebLLMAdapter({ modelId: "test-model", prompt: "hello" });
    expect(adapter.meta).toEqual({
      runtime: "webllm",
      runtimeVersion: "0.2.84",
      supportsWorker: false,
    });
  });

  it("passes the adapter conformance meta check", () => {
    expect(() =>
      checkAdapterMeta(() => createWebLLMAdapter({ modelId: "test-model", prompt: "hello" })),
    ).not.toThrow();
  });
});

describe("createWebLLMAdapter — init/dispose", () => {
  it("calls CreateMLCEngine with the configured model id", async () => {
    const engine = fakeEngine();
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine as never);

    const adapter = createWebLLMAdapter({
      modelId: "SmolLM2-360M-Instruct-q4f16_1-MLC",
      prompt: "hi",
    });
    await adapter.init();

    expect(CreateMLCEngine).toHaveBeenCalledWith("SmolLM2-360M-Instruct-q4f16_1-MLC");
  });

  it("wraps a CreateMLCEngine failure with a descriptive message", async () => {
    vi.mocked(CreateMLCEngine).mockRejectedValue(new Error("model not found"));
    const adapter = createWebLLMAdapter({ modelId: "bad-model", prompt: "hi" });

    await expect(adapter.init()).rejects.toThrow(/bad-model/);
    await expect(adapter.init()).rejects.toThrow(/model not found/);
  });

  it("passes the init/dispose conformance check", async () => {
    vi.mocked(CreateMLCEngine).mockImplementation(() => Promise.resolve(fakeEngine() as never));
    await expect(
      checkInitAndDispose(() => createWebLLMAdapter({ modelId: "test-model", prompt: "hi" })),
    ).resolves.toBeUndefined();
  });

  it("calls interruptGenerate before unload on dispose", async () => {
    const engine = fakeEngine();
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine as never);
    const adapter = createWebLLMAdapter({ modelId: "test-model", prompt: "hi" });

    await adapter.init();
    await adapter.dispose();

    expect(engine.interruptGenerate).toHaveBeenCalledOnce();
    expect(engine.unload).toHaveBeenCalledOnce();
  });

  it("does not throw when interruptGenerate itself rejects (nothing in flight)", async () => {
    const engine = fakeEngine({
      interruptGenerate: vi.fn().mockRejectedValue(new Error("nothing to interrupt")),
    });
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine as never);
    const adapter = createWebLLMAdapter({ modelId: "test-model", prompt: "hi" });

    await adapter.init();
    await expect(adapter.dispose()).resolves.toBeUndefined();
    expect(engine.unload).toHaveBeenCalledOnce();
  });

  it("dispose() is a no-op when init() was never called", async () => {
    const adapter = createWebLLMAdapter({ modelId: "test-model", prompt: "hi" });
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});

describe("createWebLLMAdapter — runOnce", () => {
  it("throws a clear error if called before init()", async () => {
    const adapter = createWebLLMAdapter({ modelId: "test-model", prompt: "hi" });
    await expect(adapter.runOnce()).rejects.toThrow(/init\(\) must be called/);
  });

  it("resets chat before each call", async () => {
    const engine = fakeEngine();
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine as never);
    const adapter = createWebLLMAdapter({ modelId: "test-model", prompt: "hi" });

    await adapter.init();
    await adapter.runOnce();
    await adapter.runOnce();

    expect(engine.resetChat).toHaveBeenCalledTimes(2);
  });

  it("computes ttftMs/decodeTps/tokensGenerated/runtimeReportedTps from the stream", async () => {
    const engine = fakeEngine({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(fakeStream(tokenChunks(128, 14.5))),
        },
      },
    });
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine as never);
    const adapter = createWebLLMAdapter({ modelId: "test-model", prompt: "hi" });

    await adapter.init();
    const sample = await adapter.runOnce();

    expect(sample.tokensGenerated).toBe(128);
    expect(sample.runtimeReportedTps).toBe(14.5);
    expect(sample.ttftMs).toBeGreaterThanOrEqual(0);
    expect(sample.decodeTps).toBeGreaterThan(0);
  });

  it("throws if no tokens are ever generated", async () => {
    const engine = fakeEngine({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(
            fakeStream([
              {
                choices: [{ delta: {} }],
                usage: { completion_tokens: 0, extra: { decode_tokens_per_s: 0 } },
              },
            ]),
          ),
        },
      },
    });
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine as never);
    const adapter = createWebLLMAdapter({ modelId: "test-model", prompt: "hi" });

    await adapter.init();
    await expect(adapter.runOnce()).rejects.toThrow(/no tokens/);
  });

  it("passes the runOnce lifecycle conformance check", async () => {
    vi.mocked(CreateMLCEngine).mockImplementation(() => Promise.resolve(fakeEngine() as never));
    await expect(
      checkRunOnceLifecycle(() => createWebLLMAdapter({ modelId: "test-model", prompt: "hi" })),
    ).resolves.toBeUndefined();
  });
});

describe("createWebLLMAdapter — mid-run dispose (conformance)", () => {
  it("passes checkMidRunDisposeAborts when interruptGenerate causes the stream to end", async () => {
    let rejectStream: (() => void) | undefined;
    const hangingStream: AsyncIterable<FakeChunk> = {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise((_resolve, reject) => {
              rejectStream = () => reject(new Error("interrupted"));
            }),
        };
      },
    };

    const engine = fakeEngine({
      chat: { completions: { create: vi.fn().mockResolvedValue(hangingStream) } },
      interruptGenerate: vi.fn(async () => {
        rejectStream?.();
      }),
    });
    vi.mocked(CreateMLCEngine).mockResolvedValue(engine as never);

    await expect(
      checkMidRunDisposeAborts(
        () => createWebLLMAdapter({ modelId: "test-model", prompt: "hi" }),
        500,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("createWebLLMAdapter — error surfacing (conformance)", () => {
  it("passes checkErrorSurfacing when CreateMLCEngine rejects", async () => {
    vi.mocked(CreateMLCEngine).mockRejectedValue(new Error("out of memory"));
    await expect(
      checkErrorSurfacing(() => createWebLLMAdapter({ modelId: "test-model", prompt: "hi" })),
    ).resolves.toBeUndefined();
  });
});
