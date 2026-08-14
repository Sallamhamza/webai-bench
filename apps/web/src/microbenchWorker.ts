import { runWasmKernel } from "@webai-bench/harness";

// Worker entry for wasm_score_multi (E1-S7). Fetches the wasm binary itself (given just a URL,
// not the bytes) rather than having the main thread transfer/clone an ArrayBuffer to every
// worker — the browser's own HTTP cache makes N workers fetching the same URL cheap after the
// first request, and it sidesteps ArrayBuffer-transfer ownership issues entirely (a transferred
// buffer is detached from the sender, so re-sending the same bytes to multiple workers would
// need a copy per worker anyway).

export type MicrobenchWorkerRequest = { type: "init"; wasmUrl: string } | { type: "run" };
export type MicrobenchWorkerResponse = { type: "result"; opsPerSec: number };

let wasmBytesPromise: Promise<ArrayBuffer> | null = null;

addEventListener("message", (event: MessageEvent<MicrobenchWorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "init") {
    wasmBytesPromise = fetch(msg.wasmUrl).then((res) => res.arrayBuffer());
    return;
  }

  // msg.type === "run"
  void (async () => {
    if (!wasmBytesPromise) {
      throw new Error("microbenchWorker: received 'run' before 'init'");
    }
    const wasmBytes = await wasmBytesPromise;
    const opsPerSec = await runWasmKernel(wasmBytes);
    const response: MicrobenchWorkerResponse = { type: "result", opsPerSec };
    postMessage(response);
  })();
});
