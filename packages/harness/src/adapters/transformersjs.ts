import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { CellAdapter, CellSample } from "../runner";

// Transformers.js embedding adapter (E2-S2). Second per the E2 sequencing — different task
// shape than WebLLM (embeddings, not generation) and dual webgpu/wasm execution providers.
//
// SP3 (docs/spikes/sp3-findings.md) found WASM ~9.6x faster than WebGPU for a MiniLM-class
// embedding model on the lead's device — WebGPU's fixed per-call overhead (shader compile,
// kernel dispatch, host<->device transfer) dominates at this model size and workload. This
// adapter treats both backends as equally first-class (device is just config, no special-casing
// "the fast path"), which is the whole point: the benchmark's job is to measure which backend
// actually wins per device/model, not assume GPU always does.
//
// No ttft_ms/decode_tps/tokens_generated/runtime_reported_tps for this task — those are
// generation-only metrics (04 §2). embed_sps and batching (ADR 0003) are what this adapter
// reports; the other CellSample fields stay null.

const TRANSFORMERS_JS_VERSION = "4.2.0"; // matches the exact pin in package.json (ADR 5.4)

export interface TransformersJsAdapterConfig {
  modelId: string;
  device: "webgpu" | "wasm";
  /** The standard 64-sentence batch (04 §2's fixed fixture) — supplied by the caller since
   * packages/registry's real fixtures don't exist yet (E3). Not hardcoded here. */
  sentences: readonly string[];
  /** Whether to use the pipeline's own batch call (all sentences in one extractor() call) or a
   * sequential per-sentence loop. Recorded as the `batching` dimension (04 §2), not silently
   * chosen — a registry entry decides this per cell, not this adapter. Default true. */
  useBatching?: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createTransformersJsAdapter(config: TransformersJsAdapterConfig): CellAdapter {
  let extractor: FeatureExtractionPipeline | null = null;
  const useBatching = config.useBatching ?? true;

  return {
    meta: {
      runtime: "transformers.js",
      runtimeVersion: TRANSFORMERS_JS_VERSION,
      supportsWorker: false,
    },

    async init() {
      try {
        extractor = await pipeline("feature-extraction", config.modelId, {
          device: config.device,
        });
      } catch (err) {
        throw new Error(
          `Transformers.js init failed for ${config.modelId} (${config.device}): ${errorMessage(err)}`,
        );
      }
    },

    async runOnce(): Promise<CellSample> {
      if (!extractor) {
        throw new Error("Transformers.js adapter: init() must be called before runOnce()");
      }
      if (config.sentences.length === 0) {
        throw new Error("Transformers.js adapter: sentences must not be empty");
      }

      const t0 = performance.now();

      if (useBatching) {
        await extractor(config.sentences as string[], { pooling: "mean", normalize: true });
      } else {
        for (const sentence of config.sentences) {
          await extractor(sentence, { pooling: "mean", normalize: true });
        }
      }

      const elapsedS = (performance.now() - t0) / 1000;
      const embedSps = config.sentences.length / elapsedS;

      return {
        ttftMs: null,
        decodeTps: null,
        tokensGenerated: null,
        runtimeReportedTps: null,
        embedSps,
        batching: useBatching,
      };
    },

    async dispose() {
      if (!extractor) return;
      const current = extractor;
      extractor = null;
      await current.dispose();
    },
  };
}
