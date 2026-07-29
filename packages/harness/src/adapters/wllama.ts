// Deep-imports the built esm/ output rather than the bare "@wllama/wllama" specifier: the
// package's package.json has no "types"/"exports" field and ships an unbuilt root index.ts
// (`export * from './src'`) with no compiled sibling — under moduleResolution "Bundler" that
// resolves straight to their raw TS source, pulling their entire src/ into our own typecheck
// under our strict settings (which their source doesn't cleanly satisfy). See adapters/QUIRKS.md.
import { Wllama, type AssetsPathConfig, type WllamaConfig } from "@wllama/wllama/esm/index.js";
import type { CellAdapter, CellSample, DownloadResult } from "../runner";

// wllama adapter (E2-S3, llama.cpp compiled to WASM — the universal CPU fallback). Last per the
// E2 sequencing: least-familiar library of the three, and CPU-fallback correctness matters more
// than being fast to build, since it's the one datapoint every visitor can produce regardless
// of WebGPU support.
//
// Pleasant surprise versus WebLLM (see adapters/QUIRKS.md): wllama's CacheManager genuinely
// separates "is this cached" / "download" from "load into memory," with structured byte-level
// progress (`{ loaded, total }`, not free text) — so unlike WebLLM, this adapter *does*
// implement a real download() step.
//
// Also unlike WebLLM: completion params take a standard `abortSignal: AbortSignal`, so
// dispose() can actually cancel an in-flight generation through a real Web API rather than an
// SDK-specific method of uncertain semantics (WebLLM's interruptGenerate()) or no mechanism at
// all (Transformers.js). Still flagged as unverified against the real library in this session —
// see QUIRKS.md — but the *contract* here is at least a standard one.

const WLLAMA_VERSION = "3.5.1"; // matches the exact pin in package.json (ADR 5.4)

export interface WllamaAdapterConfig {
  /** Paths to wllama's WASM binaries — bundler-specific, not something this adapter can supply
   * on its own. Caller's job (E4/app shell), same reasoning as the standard-prompt fixture. */
  assetsPath: AssetsPathConfig;
  modelUrl: string;
  /** The standard prompt text (04-benchmark-methodology.md §2's fixed fixture) — supplied by
   * the caller since packages/registry's real fixtures don't exist yet (E3). Not hardcoded here. */
  prompt: string;
  /** N_tokens per 04 §2 (128 in the normative spec); overridable for tests/smaller cells. */
  maxTokens?: number;
  wllamaConfig?: WllamaConfig;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createWllamaAdapter(config: WllamaAdapterConfig): CellAdapter {
  let wllama: Wllama | null = null;
  let currentAbortController: AbortController | null = null;
  const maxTokens = config.maxTokens ?? 128;

  function ensureInstance(): Wllama {
    if (!wllama) {
      wllama = new Wllama(config.assetsPath, config.wllamaConfig);
    }
    return wllama;
  }

  return {
    meta: {
      runtime: "wllama",
      runtimeVersion: WLLAMA_VERSION,
      // wllama itself supports worker + multi-thread execution, but this adapter doesn't wire
      // that up (same scope choice as the WebLLM/Transformers.js adapters) — false describes
      // what this implementation does, not the underlying library's ceiling.
      supportsWorker: false,
    },

    async download(): Promise<DownloadResult | null> {
      const instance = ensureInstance();

      try {
        const cached = await instance.cacheManager.open(config.modelUrl);
        if (cached) {
          return null; // cache hit — matches CellAdapter's "null means cache hit" contract
        }

        let loadedBytes = 0;
        const t0 = performance.now();
        await instance.cacheManager.download(config.modelUrl, {
          progressCallback: ({ loaded }) => {
            loadedBytes = loaded;
          },
        });
        const ms = performance.now() - t0;

        return { mb: loadedBytes / (1024 * 1024), ms };
      } catch (err) {
        throw new Error(`wllama download failed for ${config.modelUrl}: ${errorMessage(err)}`);
      }
    },

    async init() {
      try {
        const instance = ensureInstance();
        // useCache: true — download() already fetched it (or it was already cached); this
        // should be a fast cache-backed load, not a re-download.
        await instance.loadModelFromUrl(config.modelUrl, { useCache: true });
      } catch (err) {
        throw new Error(`wllama init failed for ${config.modelUrl}: ${errorMessage(err)}`);
      }
    },

    async runOnce(): Promise<CellSample> {
      if (!wllama) {
        throw new Error("wllama adapter: init() must be called before runOnce()");
      }

      const controller = new AbortController();
      currentAbortController = controller;

      const tRequestStart = performance.now();
      let tFirstToken: number | null = null;
      let completionTokens = 0;
      let runtimeReportedTps: number | null = null;

      try {
        const stream = await wllama.createChatCompletion({
          messages: [{ role: "user", content: config.prompt }],
          max_tokens: maxTokens,
          stream: true,
          abortSignal: controller.signal,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta && tFirstToken === null) {
            tFirstToken = performance.now();
          }
          if (chunk.usage) {
            completionTokens = chunk.usage.completion_tokens;
          }
          if (chunk.timings?.predicted_per_second !== undefined) {
            runtimeReportedTps = chunk.timings.predicted_per_second;
          }
        }
      } finally {
        currentAbortController = null;
      }

      if (tFirstToken === null) {
        throw new Error("wllama adapter: no tokens were generated");
      }

      const tEnd = performance.now();
      const ttftMs = tFirstToken - tRequestStart;
      const decodeTokensAfterFirst = Math.max(completionTokens - 1, 0);
      const decodeTps = decodeTokensAfterFirst / ((tEnd - tFirstToken) / 1000);

      return {
        ttftMs,
        decodeTps,
        tokensGenerated: completionTokens,
        runtimeReportedTps,
        embedSps: null,
        batching: null,
      };
    },

    async dispose() {
      // Abort any in-flight generation first — a real Web API, not an SDK-specific method.
      currentAbortController?.abort();
      currentAbortController = null;
      if (!wllama) return;
      const current = wllama;
      wllama = null;
      await current.exit();
    },
  };
}
