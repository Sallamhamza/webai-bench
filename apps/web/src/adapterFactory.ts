import {
  createWebLLMAdapter,
  createTransformersJsAdapter,
  createWllamaAdapter,
  type CellAdapter,
} from "@webai-bench/harness";
import type { CellRegistryEntry } from "@webai-bench/registry";
// wllama ships esm/wasm-from-cdn.d.ts but not the .js it describes — a real gap in the 3.5.1
// npm package (adapters/QUIRKS.md), not something fixable on our end. Rather than depend on a
// module file that doesn't exist, this imports the .wasm binary the package *does* ship
// (esm/wasm/wllama.wasm) directly as a Vite asset URL, so wllama loads from our own bundle
// instead of jsDelivr — one less runtime dependency on a third-party CDN staying up.
import wllamaWasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import { EMBEDDING_SENTENCES, LLM_PROMPT } from "./fixtures";

// Builds a real CellAdapter for a registry cell, dispatching on runtime (E4-S3). This is the
// piece that turns "the user picked these cells" into "something runCell()/runSuite() can
// actually drive" — the vertical-slice gate (adapters/QUIRKS.md) already exercised the WebLLM
// path against real hardware; Transformers.js and wllama get their first real-browser exercise
// through this same factory once a user actually runs one of their cells.
export function createAdapterForCell(cell: CellRegistryEntry): CellAdapter {
  switch (cell.runtime) {
    case "webllm":
      return createWebLLMAdapter({ modelId: cell.adapter_model_ref, prompt: LLM_PROMPT });

    case "transformers.js":
      return createTransformersJsAdapter({
        modelId: cell.adapter_model_ref,
        device: cell.backend,
        sentences: EMBEDDING_SENTENCES,
      });

    case "wllama":
      return createWllamaAdapter({
        assetsPath: { default: wllamaWasmUrl },
        modelUrl: cell.adapter_model_ref,
        prompt: LLM_PROMPT,
      });
  }
}
