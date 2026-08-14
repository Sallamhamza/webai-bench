import {
  aggregateMultiThreadRounds,
  multiThreadWorkerCount,
  type StatValue,
} from "@webai-bench/harness";
import type { MicrobenchWorkerRequest, MicrobenchWorkerResponse } from "./microbenchWorker";

// wasm_score_multi orchestration (E1-S7) — the Worker-pool half packages/harness/src/microbench/
// wasmScore.ts deliberately left to the app shell (see that file's header comment: Worker
// bundling is bundler territory, not harness territory). harness only had to supply the pure
// primitives this module composes: runWasmKernel (run once, inside a worker) and
// aggregateMultiThreadRounds (combine repeated rounds into a StatValue).

const ROUNDS = 3; // same "repeated measurement, not one sample" convention as everything else
// in this project (04 §2's N=3 for model cells, the matmul/mem-bw benchmarks' own repeated
// dispatches) — one round could just be a lucky/unlucky scheduling moment across N workers.

function spawnWorker(): Worker {
  return new Worker(new URL("./microbenchWorker.ts", import.meta.url), { type: "module" });
}

function runOnce(worker: Worker): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<MicrobenchWorkerResponse>) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      resolve(event.data.opsPerSec);
    };
    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(new Error(event.message));
    };
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    const request: MicrobenchWorkerRequest = { type: "run" };
    worker.postMessage(request);
  });
}

/**
 * Runs the wasm kernel across `multiThreadWorkerCount(hardwareConcurrency)` Web Workers,
 * `ROUNDS` times, and reduces the result to a StatValue. Returns `null` without spawning any
 * workers when `crossOriginIsolated` is false (04 §2: "multi only when cross-origin isolated") —
 * gated here even though this implementation's independent, non-shared-memory workers don't
 * strictly require it, both because the normative doc requires the gate and because it's a
 * reasonable proxy for "this browser context supports the threading model we'd want" (see
 * packages/harness/src/microbench/wasmScore.ts's aggregateMultiThreadRounds doc comment for the
 * same reasoning). Never throws: a worker failing degrades the whole multi-thread score to
 * `null` rather than rejecting, matching every other measurement's never-throws contract.
 */
export async function runMultiThreadWasmScore(
  wasmUrl: string,
  hardwareConcurrency: number | null,
  crossOriginIsolated: boolean,
): Promise<StatValue | null> {
  if (!crossOriginIsolated) return null;

  const workerCount = multiThreadWorkerCount(hardwareConcurrency);
  const workers = Array.from({ length: workerCount }, spawnWorker);

  try {
    const initRequest: MicrobenchWorkerRequest = { type: "init", wasmUrl };
    for (const worker of workers) worker.postMessage(initRequest);

    const rounds: number[][] = [];
    for (let round = 0; round < ROUNDS; round++) {
      rounds.push(await Promise.all(workers.map(runOnce)));
    }

    return aggregateMultiThreadRounds(rounds);
  } catch {
    return null;
  } finally {
    for (const worker of workers) worker.terminate();
  }
}
