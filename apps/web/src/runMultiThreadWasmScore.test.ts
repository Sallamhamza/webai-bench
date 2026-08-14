import { afterEach, describe, expect, it, vi } from "vitest";
import { runMultiThreadWasmScore } from "./runMultiThreadWasmScore";
import type { MicrobenchWorkerRequest } from "./microbenchWorker";

// Fake Worker — the platform boundary (jsdom has no real Worker/postMessage-to-a-thread), same
// reasoning as mocking GPUDevice in packages/harness/src/microbench/*.test.ts. Each fake worker
// answers every "run" message with a fixed ops/s value (configurable per instance) after a
// microtask tick, so tests can assert on real async sequencing rather than synchronous stubs.
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminated = false;
  requests: MicrobenchWorkerRequest[] = [];
  opsPerSec: number;

  constructor(opsPerSec: number) {
    super();
    this.opsPerSec = opsPerSec;
    FakeWorker.instances.push(this);
  }

  postMessage(request: MicrobenchWorkerRequest) {
    this.requests.push(request);
    if (request.type === "run") {
      void Promise.resolve().then(() => {
        this.dispatchEvent(
          new MessageEvent("message", { data: { type: "result", opsPerSec: this.opsPerSec } }),
        );
      });
    }
  }

  terminate() {
    this.terminated = true;
  }
}

describe("runMultiThreadWasmScore", () => {
  afterEach(() => {
    FakeWorker.instances = [];
    vi.unstubAllGlobals();
  });

  it("returns null without spawning any workers when not cross-origin isolated", async () => {
    vi.stubGlobal(
      "Worker",
      vi.fn(() => {
        throw new Error("should not construct a worker");
      }),
    );

    const result = await runMultiThreadWasmScore("wasm-url", 8, false);
    expect(result).toBeNull();
  });

  it("spawns min(hardwareConcurrency, 8) workers, runs 3 rounds, and aggregates", async () => {
    let nextOps = 100;
    vi.stubGlobal(
      "Worker",
      vi.fn(() => new FakeWorker(nextOps++)),
    );

    const result = await runMultiThreadWasmScore("wasm-url", 4, true);

    expect(FakeWorker.instances).toHaveLength(4);
    // init sent once, run sent 3 times (ROUNDS) per worker
    for (const worker of FakeWorker.instances) {
      expect(worker.requests.filter((r) => r.type === "init")).toHaveLength(1);
      expect(worker.requests.filter((r) => r.type === "run")).toHaveLength(3);
      expect(worker.terminated).toBe(true);
    }
    // Each round sums the 4 workers' ops/s (100+101+102+103 = 406, constant across all 3 rounds
    // since every worker returns the same fixed value every time it's asked)
    expect(result).toEqual({ median: 406, min: 406, max: 406 });
  });

  it("caps worker count at 8 even with a higher hardwareConcurrency", async () => {
    vi.stubGlobal(
      "Worker",
      vi.fn(() => new FakeWorker(1)),
    );

    await runMultiThreadWasmScore("wasm-url", 64, true);
    expect(FakeWorker.instances).toHaveLength(8);
  });

  it("terminates every worker and returns null if one worker errors", async () => {
    let created = 0;
    vi.stubGlobal(
      "Worker",
      vi.fn(() => {
        created++;
        if (created === 2) {
          const w = new FakeWorker(1);
          w.postMessage = (request: MicrobenchWorkerRequest) => {
            if (request.type === "run") {
              void Promise.resolve().then(() => {
                w.dispatchEvent(new ErrorEvent("error", { message: "kernel crashed" }));
              });
            }
          };
          return w;
        }
        return new FakeWorker(1);
      }),
    );

    const result = await runMultiThreadWasmScore("wasm-url", 4, true);

    expect(result).toBeNull();
    for (const worker of FakeWorker.instances) {
      expect(worker.terminated).toBe(true);
    }
  });
});
