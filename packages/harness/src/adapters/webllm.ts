import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";
import type { CellAdapter, CellSample } from "../runner";

// WebLLM adapter (E2-S1). SP2 (docs/spikes/sp2-findings.md) already validated the timing
// bracket approach against this exact library (~1.4% agreement with WebLLM's self-reported
// stats) and SP4 (docs/spikes/sp4-findings.md) validated N=3+median against it — this is the
// best-understood of the three runtimes, which is why it's built first per the E2 sequencing.
//
// No separate download() step: CreateMLCEngine() does weight fetch *and* engine setup as one
// continuous async call with no way to pause in between, so both live inside init() here.
// download stays unmeasured for WebLLM cells (download: null, cache_hit: true always) — a real,
// documented limitation (see adapters/QUIRKS.md), not an oversight. The alternative (parsing
// WebLLM's free-text initProgressCallback messages to guess byte counts and phase boundaries)
// is exactly the kind of fragile, version-coupled hack the conformance-suite-first sequencing
// was meant to avoid.
//
// Also see QUIRKS.md: the one-time WebGPU shader/pipeline compile cost shows up on the *first
// generate call* (i.e. during warmup), not during CreateMLCEngine/init — confirmed empirically
// by SP2/SP4. The normative doc's own parenthetical ("one-time costs — already captured in
// init_ms") doesn't hold precisely for this adapter, though the outcome is still methodologically
// sound since warmup's result is discarded either way.

const WEBLLM_VERSION = "0.2.84"; // matches the exact pin in package.json (ADR 5.4)

export interface WebLLMAdapterConfig {
  modelId: string;
  /** The standard prompt text (04-benchmark-methodology.md §2's fixed fixture) — supplied by
   * the caller since packages/registry's real fixtures don't exist yet (E3). Not hardcoded here. */
  prompt: string;
  /** N_tokens per 04 §2 (128 in the normative spec); overridable for tests/smaller cells. */
  maxTokens?: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createWebLLMAdapter(config: WebLLMAdapterConfig): CellAdapter {
  let engine: MLCEngine | null = null;
  const maxTokens = config.maxTokens ?? 128;

  return {
    meta: {
      runtime: "webllm",
      runtimeVersion: WEBLLM_VERSION,
      // Web Worker execution is a real WebLLM capability (03-architecture.md §5.6) but wiring
      // an adapter through a worker boundary is separate scope from this story — false until
      // that's actually built, not a promise this adapter can't keep.
      supportsWorker: false,
    },

    async init() {
      try {
        engine = await CreateMLCEngine(config.modelId);
      } catch (err) {
        throw new Error(`WebLLM init failed for ${config.modelId}: ${errorMessage(err)}`);
      }
    },

    async runOnce(): Promise<CellSample> {
      if (!engine) {
        throw new Error("WebLLM adapter: init() must be called before runOnce()");
      }

      // Fresh prefill each rep, not a continued conversation — matches the SP4 spike's approach
      // and keeps reps comparable to each other.
      await engine.resetChat();

      const tRequestStart = performance.now();
      let tFirstToken: number | null = null;
      let completionTokens = 0;
      let runtimeReportedTps: number | null = null;

      const stream = await engine.chat.completions.create({
        messages: [{ role: "user", content: config.prompt }],
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta && tFirstToken === null) {
          tFirstToken = performance.now();
        }
        if (chunk.usage) {
          completionTokens = chunk.usage.completion_tokens;
          runtimeReportedTps = chunk.usage.extra.decode_tokens_per_s;
        }
      }

      if (tFirstToken === null) {
        throw new Error("WebLLM adapter: no tokens were generated");
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
      };
    },

    async dispose() {
      if (!engine) return;
      const current = engine;
      engine = null;
      // interruptGenerate() is what actually aborts an in-flight chat.completions.create()
      // stream (per the conformance suite's checkMidRunDisposeAborts contract, E2-S4) — unload()
      // alone frees engine resources but isn't documented to cancel an active generation.
      // Real-browser confirmation that this reliably unblocks an in-flight runOnce() is device-
      // lab/Playwright territory (adapters/README.md's test boundary) — this session can only
      // verify our own wiring against a mocked engine, not WebLLM's actual abort semantics.
      try {
        await current.interruptGenerate();
      } catch {
        // No-op to interrupt (nothing in flight) throws in some WebLLM versions — not fatal.
      }
      await current.unload();
    },
  };
}
