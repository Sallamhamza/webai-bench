// GPUBufferUsage/GPUShaderStage etc. are runtime globals a real browser provides — @webgpu/types
// only supplies their TypeScript *types*, not the actual objects, so referencing the bare global
// (e.g. `GPUBufferUsage.STORAGE`) throws ReferenceError anywhere without a real WebGPU
// implementation (found the hard way: jsdom/Node, i.e. every unit test in this project). The
// flag values themselves are fixed by the WebGPU spec (simple bitmasks, not opaque handles), so
// defining them locally is exactly as correct in a real browser and portable everywhere else.
export const GPU_BUFFER_USAGE = {
  STORAGE: 0x0080,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
} as const;
