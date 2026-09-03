import { useState } from "react";
import { runMicroBenchmarks, type MicroBenchResult, type ProbeResult } from "@webai-bench/harness";
// Same cross-package Vite asset pattern as adapterFactory.ts's wllama wasm import — the harness
// package ships this file, but which bundler actually serves it to the browser is apps/web's
// concern (packages/harness/src/microbench/wasmScore.ts's header comment explains why the
// harness itself stays bundler-agnostic here).
import dotproductWasmUrl from "@webai-bench/harness/src/microbench/wasm/dotproduct.wasm?url";
import { runMultiThreadWasmScore } from "./runMultiThreadWasmScore";

export interface MicroBenchPanelProps {
  probeResult: ProbeResult;
  /** Called once a run finishes, so a caller (App.tsx's BenchmarkSetup) can lift the result up
   * and hand it to RunPanel's export — without this, a model-cell export and a device-benchmark
   * run produce two separate JSON files instead of one combined one. Optional: MicroBenchPanel
   * is fully usable standalone, this is purely for the caller that wants to connect the two. */
  onComplete?: (result: MicroBenchResult) => void;
}

type MicroBenchState =
  { status: "idle" } | { status: "running" } | { status: "done"; result: MicroBenchResult };

function formatStat(stat: { median: number } | null, unit: string, digits = 1): string {
  return stat ? `${stat.median.toFixed(digits)} ${unit}` : "not available on this device";
}

// E1-S7: device-level micro-benchmarks (04 §2's matmul/mem-bandwidth/wasm-score metrics) —
// separate from the model-cell run flow (RunPanel) because these aren't per-cell measurements,
// they're per-device ones (packages/schema's MicroSchema is a top-level sibling of `cells` in
// the submission payload, not part of it).
export function MicroBenchPanel({ probeResult, onComplete }: MicroBenchPanelProps) {
  const [state, setState] = useState<MicroBenchState>({ status: "idle" });

  const handleRun = () => {
    setState({ status: "running" });
    void (async () => {
      const [wasmBytes, wasmScoreMulti] = await Promise.all([
        fetch(dotproductWasmUrl).then((res) => res.arrayBuffer()),
        runMultiThreadWasmScore(
          dotproductWasmUrl,
          probeResult.hardwareConcurrency,
          probeResult.crossOriginIsolated,
        ),
      ]);
      const result = await runMicroBenchmarks(probeResult, wasmBytes, wasmScoreMulti);
      setState({ status: "done", result });
      onComplete?.(result);
    })();
  };

  return (
    <section>
      <h2>Device benchmarks</h2>
      <p>
        Measures raw GPU/CPU throughput on this device — independent of any specific AI model — so
        results are comparable across devices even before a single model cell has run.
      </p>
      <button type="button" onClick={handleRun} disabled={state.status === "running"}>
        {state.status === "running" ? "Measuring…" : "Run device benchmarks"}
      </button>

      {state.status === "done" ? (
        <dl>
          <dt>Matmul (f32)</dt>
          <dd>{formatStat(state.result.matmulF32Gflops, "GFLOPS")}</dd>
          <dt>Matmul (f16)</dt>
          <dd>{formatStat(state.result.matmulF16Gflops, "GFLOPS")}</dd>
          <dt>Memory bandwidth</dt>
          <dd>{formatStat(state.result.memBwGbps, "GB/s")}</dd>
          <dt>WASM score (single-thread)</dt>
          <dd>{formatStat(state.result.wasmScoreSingle, "ops/s", 0)}</dd>
          <dt>WASM score (multi-thread)</dt>
          <dd>{formatStat(state.result.wasmScoreMulti, "ops/s", 0)}</dd>
        </dl>
      ) : null}
    </section>
  );
}
