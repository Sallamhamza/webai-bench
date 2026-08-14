import type { ProbeResult } from "../probe";
import type { StatValue } from "../stats";
import { runMatmulBenchmark } from "./matmul";
import { runMemBandwidthBenchmark } from "./memBandwidth";
import { runWasmSingleThreadScore } from "./wasmScore";

export { runMatmulBenchmark, type MatmulResult } from "./matmul";
export { runMemBandwidthBenchmark, computeWorkingSetBytes } from "./memBandwidth";
export {
  runWasmKernel,
  runWasmSingleThreadScore,
  aggregateMultiThreadRounds,
  multiThreadWorkerCount,
  WASM_BUFFER_BYTES,
  WASM_ITERATIONS,
} from "./wasmScore";

export interface MicroBenchResult {
  matmulF32Gflops: StatValue | null;
  matmulF16Gflops: StatValue | null;
  memBwGbps: StatValue | null;
  wasmScoreSingle: StatValue | null;
  /** Multi-thread scoring needs a Worker pool, which is app-shell (bundler) territory — see
   * wasmScore.ts's header comment. Passed in already-computed by the caller (or `null` if the
   * device isn't cross-origin isolated, per 04 §2's gate) rather than this function trying to
   * spawn workers itself. */
  wasmScoreMulti: StatValue | null;
}

/**
 * Runs every micro-benchmark this device/browser combination supports (04 §3: "Micro — (no
 * model) — WebGPU shaders + WASM workload — always run"). Unlike a model cell, there's no
 * per-cell preflight/status here — each of the five metrics independently degrades to `null`
 * when its prerequisite isn't met (no WebGPU → both GFLOPS figures and mem_bw_gbps are null; no
 * shader-f16 → only matmulF16Gflops is null), matching MicroSchema's shape exactly
 * (packages/schema/src/submission.ts) rather than failing the whole micro-benchmark set because
 * one piece of hardware is missing.
 */
export async function runMicroBenchmarks(
  probeResult: ProbeResult,
  wasmBytes: BufferSource,
  wasmScoreMulti: StatValue | null = null,
): Promise<MicroBenchResult> {
  const wasmScoreSingle = await runWasmSingleThreadScore(wasmBytes);

  if (!probeResult.webgpu.available) {
    return {
      matmulF32Gflops: null,
      matmulF16Gflops: null,
      memBwGbps: null,
      wasmScoreSingle,
      wasmScoreMulti,
    };
  }

  const hasShaderF16 = probeResult.webgpu.features.includes("shader-f16");
  const device = await acquireDevice(hasShaderF16);
  if (!device) {
    return {
      matmulF32Gflops: null,
      matmulF16Gflops: null,
      memBwGbps: null,
      wasmScoreSingle,
      wasmScoreMulti,
    };
  }

  const [matmul, memBwGbps] = await Promise.all([
    runMatmulBenchmark(device, hasShaderF16),
    runMemBandwidthBenchmark(device, probeResult.webgpu.limits.maxBufferSize ?? 0),
  ]);

  return {
    matmulF32Gflops: matmul.f32Gflops,
    matmulF16Gflops: matmul.f16Gflops,
    memBwGbps,
    wasmScoreSingle,
    wasmScoreMulti,
  };
}

async function acquireDevice(requestShaderF16: boolean): Promise<GPUDevice | null> {
  try {
    const gpu = navigator.gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const requiredFeatures: GPUFeatureName[] =
      requestShaderF16 && adapter.features.has("shader-f16") ? ["shader-f16"] : [];
    return await adapter.requestDevice({ requiredFeatures });
  } catch {
    return null;
  }
}
