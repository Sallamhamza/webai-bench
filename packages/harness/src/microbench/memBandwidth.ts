import { computeStatValue } from "../stats";
import type { StatValue } from "../stats";
import { GPU_BUFFER_USAGE } from "./gpuConstants";

// mem_bw_gbps (04-benchmark-methodology.md §2): "Achieved GB/s of the reference buffer-copy
// compute kernel over a 256 MB working set (or the largest power-of-two ≤ 25% of maxBufferSize,
// size recorded)." Same warmup/measured-dispatch convention as matmul.ts (04 §2 only pins rep
// counts for matmul explicitly; this extends that convention rather than inventing an unrelated
// one — see matmul.ts's WARMUP_DISPATCHES/MEASURED_DISPATCHES comment for the same reasoning).

const WARMUP_DISPATCHES = 3;
const MEASURED_DISPATCHES = 10;
const WORKGROUP_SIZE = 256;
const MAX_WORKING_SET_BYTES = 256 * 1024 * 1024;

const COPY_SHADER = `
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  dst[gid.x] = src[gid.x];
}
`;

/** Largest power-of-two number of bytes that is <= both 256 MB and 25% of the device's
 * maxBufferSize — the smaller cap matters on devices with modest GPU memory limits, so the
 * benchmark never tries to allocate a working set the device can't actually satisfy. */
export function computeWorkingSetBytes(maxBufferSize: number): number {
  const cap = Math.min(MAX_WORKING_SET_BYTES, maxBufferSize * 0.25);
  if (cap < 4) return 4; // degenerate device — smallest possible (one u32 element)
  return 2 ** Math.floor(Math.log2(cap));
}

/**
 * Runs the buffer-copy bandwidth benchmark. Never throws — GPU allocation failure or a lost
 * device collapses to `null`, same contract as every other measurement here.
 */
export async function runMemBandwidthBenchmark(
  device: GPUDevice,
  maxBufferSize: number,
): Promise<StatValue | null> {
  try {
    const workingSetBytes = computeWorkingSetBytes(maxBufferSize);
    const elementCount = workingSetBytes / 4; // u32 elements

    const src = device.createBuffer({
      size: workingSetBytes,
      usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
      mappedAtCreation: true,
    });
    const srcData = new Uint32Array(src.getMappedRange());
    for (let i = 0; i < srcData.length; i++) srcData[i] = i; // deterministic, non-degenerate
    src.unmap();

    const dst = device.createBuffer({
      size: workingSetBytes,
      usage: GPU_BUFFER_USAGE.STORAGE,
    });

    const module = device.createShaderModule({ code: COPY_SHADER });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src } },
        { binding: 1, resource: { buffer: dst } },
      ],
    });

    const workgroups = Math.ceil(elementCount / WORKGROUP_SIZE);

    const dispatchOnce = async (): Promise<number> => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      const t0 = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      return performance.now() - t0;
    };

    for (let i = 0; i < WARMUP_DISPATCHES; i++) {
      await dispatchOnce();
    }

    // Counts both the read and the write side of the copy — a copy kernel moves bytes in both
    // directions, and a bandwidth figure that only counted one side would understate what the
    // memory subsystem actually did.
    const bytesMoved = workingSetBytes * 2;
    const gbpsSamples: number[] = [];
    for (let i = 0; i < MEASURED_DISPATCHES; i++) {
      const elapsedMs = await dispatchOnce();
      gbpsSamples.push(bytesMoved / (elapsedMs / 1000) / 1e9);
    }

    return computeStatValue(gbpsSamples);
  } catch {
    return null;
  }
}
