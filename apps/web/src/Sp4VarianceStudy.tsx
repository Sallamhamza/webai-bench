import { useCallback, useRef, useState } from "react";
import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";

// SP4 spike (docs/08-delivery-plan.md §2): is N=3 measured reps enough? Loads the model once,
// then runs many repetitions of the same fixed prompt on the same engine (resetChat() between
// reps, no re-download/re-init), recording per-rep TTFT/decode TPS plus whether the tab lost
// visibility during that rep. Feeds the N=3 recommendation into 04-benchmark-methodology.md §5.
// Single-device only in this session — see docs/spikes/sp4-findings.md for the multi-device
// caveat. Throwaway — delete once the real runner (E1-S2) lands.

const MODEL_ID = "SmolLM2-360M-Instruct-q4f16_1-MLC";
const PROMPT = "List three uses for a kitchen timer.";
const MAX_TOKENS = 32;
const NUM_REPS = 12;
const WARMUP_REPS = 1;

type Phase = "idle" | "loading" | "running" | "done" | "error";

interface RepResult {
  rep: number;
  isWarmup: boolean;
  visibilityInterrupted: boolean;
  ttftMs: number;
  decodeTps: number;
  completionTokens: number;
}

interface GroupStats {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdev: number;
  cvPct: number;
}

function stats(values: number[]): GroupStats {
  const n = values.length;
  if (n === 0) return { n: 0, mean: NaN, median: NaN, min: NaN, max: NaN, stdev: NaN, cvPct: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  return {
    n,
    mean,
    median,
    min: sorted[0] ?? NaN,
    max: sorted[n - 1] ?? NaN,
    stdev,
    cvPct: (stdev / mean) * 100,
  };
}

export function Sp4VarianceStudy() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressText, setProgressText] = useState("");
  const [currentRep, setCurrentRep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reps, setReps] = useState<RepResult[]>([]);
  const engineRef = useRef<MLCEngine | null>(null);

  const run = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setReps([]);

    try {
      let engine = engineRef.current;
      if (!engine) {
        engine = await CreateMLCEngine(MODEL_ID, {
          initProgressCallback: (r) => setProgressText(r.text),
        });
        engineRef.current = engine;
      }

      setPhase("running");
      const results: RepResult[] = [];

      for (let rep = 0; rep < NUM_REPS; rep++) {
        setCurrentRep(rep);
        await engine.resetChat();

        let visibilityInterrupted = document.hidden;
        const onVisibilityChange = () => {
          if (document.hidden) visibilityInterrupted = true;
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        const tRequestStart = performance.now();
        let tFirstToken: number | null = null;
        let completionTokens = 0;

        const stream = await engine.chat.completions.create({
          messages: [{ role: "user", content: PROMPT }],
          max_tokens: MAX_TOKENS,
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
          }
        }
        const tEnd = performance.now();
        document.removeEventListener("visibilitychange", onVisibilityChange);

        if (tFirstToken === null) {
          throw new Error(`Rep ${rep}: no tokens generated`);
        }

        const ttftMs = tFirstToken - tRequestStart;
        const decodeTokensAfterFirst = Math.max(completionTokens - 1, 0);
        const decodeTps = decodeTokensAfterFirst / ((tEnd - tFirstToken) / 1000);

        results.push({
          rep,
          isWarmup: rep < WARMUP_REPS,
          visibilityInterrupted,
          ttftMs,
          decodeTps,
          completionTokens,
        });
        setReps([...results]);
      }

      setPhase("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);

  const clean = reps.filter((r) => !r.isWarmup && !r.visibilityInterrupted);
  const withWarmup = reps.filter((r) => !r.visibilityInterrupted);
  const interrupted = reps.filter((r) => r.visibilityInterrupted);

  return (
    <section>
      <h2>SP4 spike — N=3 variance study (single device)</h2>
      <p>
        Model: <code>{MODEL_ID}</code> · {NUM_REPS} reps, {WARMUP_REPS} warmup discarded ·{" "}
        {MAX_TOKENS} max tokens/rep
      </p>
      <p>
        Tip: to test the visibility-loss path, switch to another tab partway through a run, then
        switch back — that rep will be flagged below.
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={phase === "loading" || phase === "running"}
      >
        Run SP4 variance study
      </button>
      {phase === "loading" && <p data-testid="sp4-progress">Loading: {progressText}</p>}
      {phase === "running" && (
        <p data-testid="sp4-running">
          Running rep {currentRep + 1} / {NUM_REPS}…
        </p>
      )}
      {phase === "error" && <p data-testid="sp4-error">failed: {error}</p>}

      {reps.length > 0 && (
        <div data-testid="sp4-report">
          <table>
            <thead>
              <tr>
                <th>rep</th>
                <th>warmup?</th>
                <th>visibility-interrupted?</th>
                <th>TTFT (ms)</th>
                <th>decode TPS</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.rep}>
                  <td>{r.rep}</td>
                  <td>{r.isWarmup ? "yes" : ""}</td>
                  <td>{r.visibilityInterrupted ? "yes" : ""}</td>
                  <td>{r.ttftMs.toFixed(1)}</td>
                  <td>{r.decodeTps.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {phase === "done" && (
            <>
              <h3>Summary (decode TPS)</h3>
              <table>
                <thead>
                  <tr>
                    <th>group</th>
                    <th>n</th>
                    <th>mean</th>
                    <th>median</th>
                    <th>min</th>
                    <th>max</th>
                    <th>stdev</th>
                    <th>CV%</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["all reps (incl. warmup + interrupted)", reps],
                      ["with warmup, excl. interrupted", withWarmup],
                      ["excl. warmup + interrupted (clean)", clean],
                      ["visibility-interrupted only", interrupted],
                    ] as const
                  ).map(([label, group]) => {
                    const s = stats(group.map((r) => r.decodeTps));
                    return (
                      <tr key={label}>
                        <td>{label}</td>
                        <td>{s.n}</td>
                        <td>{s.mean.toFixed(2)}</td>
                        <td>{s.median.toFixed(2)}</td>
                        <td>{s.min.toFixed(2)}</td>
                        <td>{s.max.toFixed(2)}</td>
                        <td>{s.stdev.toFixed(2)}</td>
                        <td>{s.cvPct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </section>
  );
}
