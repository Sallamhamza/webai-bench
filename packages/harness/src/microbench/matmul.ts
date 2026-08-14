import { computeStatValue } from "../stats";
import type { StatValue } from "../stats";
import { GPU_BUFFER_USAGE } from "./gpuConstants";

// matmul_f32_gflops / matmul_f16_gflops (04-benchmark-methodology.md §2): "Achieved GFLOPS of
// the reference WGSL tiled-matmul compute shader at M=N=K=1024, average of ≥10 timed dispatches
// after 3 warmup dispatches ... f16 variant only when shader-f16 is present." Timed via
// queue.onSubmittedWorkDone() wall-clock brackets — 04 §2's rule (never trust a self-reported
// GPU timing as the metric of record) applies here exactly as it does to every model cell's
// TTFT/decode_tps.

const DIM = 1024; // M = N = K
const TILE = 16;
const WARMUP_DISPATCHES = 3;
const MEASURED_DISPATCHES = 10; // "≥10" per 04 §2 — 10 is the floor, not rounded up further

// timestamp-query supplementary capture (04 §2's parenthetical) is deliberately not implemented
// here — queue.onSubmittedWorkDone() brackets are the metric of record either way, so the
// supplementary GPU-side timing is a nice-to-have this pass doesn't block on, not a silent gap.

function matmulShader(scalarType: "f32" | "f16"): string {
  const enableDirective = scalarType === "f16" ? "enable f16;\n" : "";
  return `${enableDirective}
struct Dims { M: u32, N: u32, K: u32 }

@group(0) @binding(0) var<storage, read> A: array<${scalarType}>;
@group(0) @binding(1) var<storage, read> B: array<${scalarType}>;
@group(0) @binding(2) var<storage, read_write> C: array<${scalarType}>;
@group(0) @binding(3) var<uniform> dims: Dims;

var<workgroup> tileA: array<array<${scalarType}, ${TILE}>, ${TILE}>;
var<workgroup> tileB: array<array<${scalarType}, ${TILE}>, ${TILE}>;

@compute @workgroup_size(${TILE}, ${TILE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let row = gid.y;
  let col = gid.x;
  var acc: ${scalarType} = ${scalarType === "f16" ? "f16(0)" : "0.0"};
  let numTiles = (dims.K + ${TILE}u - 1u) / ${TILE}u;

  for (var t: u32 = 0u; t < numTiles; t = t + 1u) {
    let aCol = t * ${TILE}u + lid.x;
    let bRow = t * ${TILE}u + lid.y;
    tileA[lid.y][lid.x] = A[row * dims.K + aCol];
    tileB[lid.y][lid.x] = B[bRow * dims.N + col];
    workgroupBarrier();
    for (var k: u32 = 0u; k < ${TILE}u; k = k + 1u) {
      acc = acc + tileA[lid.y][k] * tileB[k][lid.x];
    }
    workgroupBarrier();
  }

  C[row * dims.N + col] = acc;
}
`;
}

function deterministicFill(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ((i % 13) - 6) * 0.1; // small nonzero values, no denormals
  return out;
}

async function dispatchOnce(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
): Promise<number> {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  const workgroups = Math.ceil(DIM / TILE);
  pass.dispatchWorkgroups(workgroups, workgroups);
  pass.end();

  const t0 = performance.now();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return performance.now() - t0;
}

async function runVariant(device: GPUDevice, scalarType: "f32" | "f16"): Promise<StatValue | null> {
  try {
    const bytesPerElement = scalarType === "f32" ? 4 : 2;
    const bufSize = DIM * DIM * bytesPerElement;

    const makeBuffer = (usage: GPUBufferUsageFlags, data?: Float32Array) => {
      const buf = device.createBuffer({
        size: bufSize,
        usage,
        mappedAtCreation: data !== undefined,
      });
      if (data) {
        // f32 path writes the Float32Array directly; f16 packing from JS would need a
        // manual half-float encode this benchmark doesn't need — the shader's own zero-init
        // (mappedAtCreation without data) is sufficient since GFLOPS depends on dispatch
        // count/ALU throughput, not on the specific values multiplied.
        new Float32Array(buf.getMappedRange()).set(data);
        buf.unmap();
      }
      return buf;
    };

    const aData = scalarType === "f32" ? deterministicFill(DIM * DIM) : undefined;
    const bData = scalarType === "f32" ? deterministicFill(DIM * DIM) : undefined;
    const bufferA = makeBuffer(GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST, aData);
    const bufferB = makeBuffer(GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST, bData);
    const bufferC = device.createBuffer({ size: bufSize, usage: GPU_BUFFER_USAGE.STORAGE });
    const dimsBuffer = device.createBuffer({
      size: 16,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(dimsBuffer.getMappedRange()).set([DIM, DIM, DIM, 0]);
    dimsBuffer.unmap();

    const module = device.createShaderModule({ code: matmulShader(scalarType) });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufferA } },
        { binding: 1, resource: { buffer: bufferB } },
        { binding: 2, resource: { buffer: bufferC } },
        { binding: 3, resource: { buffer: dimsBuffer } },
      ],
    });

    for (let i = 0; i < WARMUP_DISPATCHES; i++) {
      await dispatchOnce(device, pipeline, bindGroup);
    }

    const totalFlops = 2 * DIM * DIM * DIM; // multiply + add per inner-product term
    const gflopsSamples: number[] = [];
    for (let i = 0; i < MEASURED_DISPATCHES; i++) {
      const elapsedMs = await dispatchOnce(device, pipeline, bindGroup);
      gflopsSamples.push(totalFlops / (elapsedMs / 1000) / 1e9);
    }

    return computeStatValue(gflopsSamples);
  } catch {
    return null;
  }
}

export interface MatmulResult {
  f32Gflops: StatValue | null;
  f16Gflops: StatValue | null;
}

/**
 * Runs the f32 matmul benchmark always (when a GPUDevice is available), and the f16 variant only
 * when the device was created with the shader-f16 feature (04 §2: "f16 variant only when
 * shader-f16 is present"). Never throws — any GPU-side failure (device lost, OOM on a large
 * buffer, unsupported shader) collapses to `null` for that variant, matching every other
 * measurement's never-throws contract in this project.
 */
export async function runMatmulBenchmark(
  device: GPUDevice,
  hasShaderF16: boolean,
): Promise<MatmulResult> {
  const f32Gflops = await runVariant(device, "f32");
  const f16Gflops = hasShaderF16 ? await runVariant(device, "f16") : null;
  return { f32Gflops, f16Gflops };
}
