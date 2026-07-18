import { useCallback, useRef, useState } from "react";
import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";

// SP2 spike (docs/08-delivery-plan.md §2): can we bracket WebLLM timing reliably?
// Loads SmolLM2-360M, generates a fixed prompt, and compares our own performance.now()
// brackets against WebLLM's self-reported usage.extra stats. Throwaway — delete once the
// real harness runner (E1-S2) + adapters (E2-S1) land.

const MODEL_ID = "SmolLM2-360M-Instruct-q4f16_1-MLC";
const PROMPT = "Explain what a tokenizer does in one short paragraph.";
const MAX_TOKENS = 128;

type Phase = "idle" | "loading" | "generating" | "done" | "error";

interface Report {
  initMs: number;
  ourTtftMs: number;
  ourDecodeTps: number;
  runtimeTtftMs: number;
  runtimeDecodeTps: number;
  completionTokens: number;
  ttftDeltaPct: number;
  decodeTpsDeltaPct: number;
}

function pct(ours: number, runtime: number): number {
  if (runtime === 0) return NaN;
  return ((ours - runtime) / runtime) * 100;
}

export function Sp2WebllmSpike() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const engineRef = useRef<MLCEngine | null>(null);

  const run = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setReport(null);

    try {
      const t0 = performance.now();
      const engine = await CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (r) => setProgressText(r.text),
      });
      engineRef.current = engine;
      const initMs = performance.now() - t0;

      setPhase("generating");
      const tRequestStart = performance.now();
      let tFirstToken: number | null = null;

      const stream = await engine.chat.completions.create({
        messages: [{ role: "user", content: PROMPT }],
        max_tokens: MAX_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
      });

      let completionTokens = 0;
      let runtimeTtftS = 0;
      let runtimeDecodeTps = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta && tFirstToken === null) {
          tFirstToken = performance.now();
        }
        if (chunk.usage) {
          completionTokens = chunk.usage.completion_tokens;
          runtimeTtftS = chunk.usage.extra.time_to_first_token_s;
          runtimeDecodeTps = chunk.usage.extra.decode_tokens_per_s;
        }
      }

      const tEnd = performance.now();
      if (tFirstToken === null) {
        throw new Error("No tokens were generated — first-token timestamp never recorded");
      }

      const ourTtftMs = tFirstToken - tRequestStart;
      const decodeTokensAfterFirst = Math.max(completionTokens - 1, 0);
      const ourDecodeTps = decodeTokensAfterFirst / ((tEnd - tFirstToken) / 1000);
      const runtimeTtftMs = runtimeTtftS * 1000;

      setReport({
        initMs,
        ourTtftMs,
        ourDecodeTps,
        runtimeTtftMs,
        runtimeDecodeTps,
        completionTokens,
        ttftDeltaPct: pct(ourTtftMs, runtimeTtftMs),
        decodeTpsDeltaPct: pct(ourDecodeTps, runtimeDecodeTps),
      });
      setPhase("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      await engineRef.current?.unload();
      engineRef.current = null;
    }
  }, []);

  const webgpuAvailable = typeof navigator !== "undefined" && "gpu" in navigator;

  return (
    <section>
      <h2>SP2 spike — WebLLM timing bracket</h2>
      <p>
        Model: <code>{MODEL_ID}</code> · WebGPU available:{" "}
        <span data-testid="sp2-webgpu">{String(webgpuAvailable)}</span>
      </p>
      <button type="button" onClick={() => void run()} disabled={phase === "loading" || phase === "generating"}>
        Run SP2 WebLLM timing spike
      </button>
      {phase === "loading" && <p data-testid="sp2-progress">Loading: {progressText}</p>}
      {phase === "generating" && <p>Generating…</p>}
      {phase === "error" && <p data-testid="sp2-error">failed: {error}</p>}
      {report && (
        <div data-testid="sp2-report">
          <p>init: {report.initMs.toFixed(0)} ms</p>
          <p>completion tokens: {report.completionTokens}</p>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>ours (performance.now bracket)</th>
                <th>runtime-reported (usage.extra)</th>
                <th>delta</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>TTFT (ms)</td>
                <td>{report.ourTtftMs.toFixed(1)}</td>
                <td>{report.runtimeTtftMs.toFixed(1)}</td>
                <td>{report.ttftDeltaPct.toFixed(1)}%</td>
              </tr>
              <tr>
                <td>decode TPS</td>
                <td>{report.ourDecodeTps.toFixed(2)}</td>
                <td>{report.runtimeDecodeTps.toFixed(2)}</td>
                <td>{report.decodeTpsDeltaPct.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
