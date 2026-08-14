import { computeStatValue } from "../stats";
import type { StatValue } from "../stats";

// wasm_score_single / wasm_score_multi (04-benchmark-methodology.md §2): throughput of the fixed
// WASM workload — the compiled dotproduct.wasm kernel (wasm-src/dotproduct.ts, see that file's
// comment for why --runtime stub + JS-supplied memory). "ops/s" here means int8 multiply-add
// operations per second: BUFFER_BYTES * WASM_ITERATIONS ops per kernel call, timed as one
// wall-clock bracket per call (matching 04 §2's "wall-clock brackets from performance.now()"
// rule — never trust anything self-timed).
//
// Bundler-agnostic by design (like the wllama adapter takes assetsPath from its caller rather
// than importing an asset path itself): this module takes `wasmBytes` as a parameter instead of
// fetching packages/harness/src/microbench/wasm/dotproduct.wasm itself, since how that file
// reaches the caller (Vite ?url import, fetch, etc.) is a bundler concern the harness package
// shouldn't own. Same reasoning is why the multi-thread path only exposes the single-execution
// primitive (`runWasmKernel`) rather than spawning Web Workers itself — Worker bundling is
// app-shell (apps/web) territory; this module just gives it the pure computation to run inside
// each worker and a way to combine the results.

// Fixed, versioned workload — bump alongside a suite MAJOR version if ever changed (04 §8), same
// rule as every other fixed fixture in the project.
export const WASM_BUFFER_BYTES = 65536; // 64 KiB — comfortably inside typical L2 cache
export const WASM_ITERATIONS = 8000;
const WARMUP_REPS = 3; // mirrors the matmul benchmark's "3 warmup dispatches" convention (04 §2)
const MEASURED_REPS = 10; // mirrors matmul's "≥10 timed dispatches" — 04 §2 doesn't pin a rep
// count for wasm_score specifically, so this extends that convention rather than inventing an
// unrelated one.

function fillDeterministicBuffer(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 37 + 11) % 251; // fixed pseudo-pattern, not literally random — a benchmark
    // input should be reproducible, and correctness of the *values* doesn't matter here, only
    // that they're real, non-degenerate bytes the kernel actually has to process.
  }
}

/**
 * Instantiates a fresh module instance and runs the fixed workload once, returning ops/s for
 * that single call. Safe to call from a Worker as well as the main thread — no DOM access, no
 * shared state between calls (each call gets its own WebAssembly.Instance).
 */
export async function runWasmKernel(wasmBytes: BufferSource): Promise<number> {
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const exports = instance.exports as {
    memory: WebAssembly.Memory;
    dotProduct: (offset: number, length: number, iterations: number) => bigint;
  };

  const pagesNeeded = Math.ceil(WASM_BUFFER_BYTES / 65536);
  exports.memory.grow(pagesNeeded);
  fillDeterministicBuffer(new Uint8Array(exports.memory.buffer, 0, WASM_BUFFER_BYTES));

  const t0 = performance.now();
  exports.dotProduct(0, WASM_BUFFER_BYTES, WASM_ITERATIONS);
  const elapsedMs = performance.now() - t0;

  const totalOps = WASM_BUFFER_BYTES * WASM_ITERATIONS;
  return totalOps / (elapsedMs / 1000);
}

/**
 * wasm_score_single: warmup + measured reps of the kernel on the calling thread, reduced to a
 * StatValue the same way every other per-cell metric is (stats.ts's computeStatValue). Never
 * throws — WebAssembly instantiation failing is vanishingly rare on a browser that got this far,
 * but FR1.2's "probe never throws" philosophy applies to every measurement in this project, not
 * just the capability probe.
 */
export async function runWasmSingleThreadScore(wasmBytes: BufferSource): Promise<StatValue | null> {
  try {
    for (let i = 0; i < WARMUP_REPS; i++) {
      await runWasmKernel(wasmBytes);
    }
    const samples: number[] = [];
    for (let i = 0; i < MEASURED_REPS; i++) {
      samples.push(await runWasmKernel(wasmBytes));
    }
    return computeStatValue(samples);
  } catch {
    return null;
  }
}

/**
 * wasm_score_multi: reduces repeated multi-worker rounds to a StatValue. Each element of
 * `rounds` is one round's per-worker ops/s figures (apps/web spawns `multiThreadWorkerCount()`
 * workers, has each run `runWasmKernel` once via this module's exported primitive, and collects
 * their results into one round) — summed *within* a round (the question this metric answers is
 * "how much of this workload can the device get through per second across all its cores at
 * once," not "how fast is one core," which is wasm_score_single), then median/min/max is taken
 * *across* rounds, the same way every other repeated measurement in this project becomes a
 * StatValue (stats.ts's computeStatValue) — not collapsed into a single number pretending to
 * have the shape of one.
 */
export function aggregateMultiThreadRounds(
  rounds: readonly (readonly number[])[],
): StatValue | null {
  const perRoundTotals = rounds.map((round) =>
    round.reduce((sum, opsPerSec) => sum + opsPerSec, 0),
  );
  return computeStatValue(perRoundTotals);
}

/** min(hardwareConcurrency, 8) per 04 §2 — capped so a 64-core workstation doesn't spawn 64
 * workers for a micro-benchmark that's supposed to be quick and unintrusive. */
export function multiThreadWorkerCount(hardwareConcurrency: number | null): number {
  return Math.max(1, Math.min(hardwareConcurrency ?? 1, 8));
}
