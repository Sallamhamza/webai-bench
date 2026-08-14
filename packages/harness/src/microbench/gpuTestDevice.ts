import { vi } from "vitest";

// Shared fake GPUDevice for matmul.test.ts and memBandwidth.test.ts — mocks the platform
// boundary (real WebGPU only exists in a browser, adapters/README.md's test boundary), not our
// own logic. Not exported from the package (no .ts extension trimmed from imports elsewhere) —
// this file only exists to be imported by sibling *.test.ts files in this directory.
export function fakeGpuDevice() {
  const dispatchCalls: string[] = [];

  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(() => dispatchCalls.push("dispatch")),
    end: vi.fn(),
  };

  const encoder = {
    beginComputePass: vi.fn(() => pass),
    finish: vi.fn(() => ({})),
  };

  const device = {
    createBuffer: vi.fn((desc: { size: number; mappedAtCreation?: boolean }) => ({
      getMappedRange: vi.fn(() => new ArrayBuffer(desc.size)),
      unmap: vi.fn(),
    })),
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({
      getBindGroupLayout: vi.fn(() => ({})),
    })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => encoder),
    queue: {
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
    },
  };

  return { device: device as unknown as GPUDevice, dispatchCalls, pass, encoder };
}
