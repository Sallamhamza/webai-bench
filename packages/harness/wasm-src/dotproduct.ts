// AssemblyScript source for the wasm_score_single/wasm_score_multi micro-benchmark
// (04-benchmark-methodology.md §2: "bundled, versioned binary: int8 dot-product kernel over a
// fixed buffer"). Compiled via `pnpm --filter @webai-bench/harness build:wasm` into
// src/microbench/wasm/dotproduct.wasm, which is committed — visitors never compile this
// themselves, they load the pinned binary, matching every other "fixed fixture" in the project
// (registry fixtures are versioned+hashed for the same reason: everyone measures the same thing).
//
// --runtime stub (see package.json's build:wasm script): no GC, no AS heap allocator. The module
// owns nothing dynamic — JS writes the input buffer directly into this module's exported linear
// memory (via --exportMemory) at a fixed offset, then calls dotProduct(). Keeps the kernel itself
// trivial to reason about and avoids any AS-runtime overhead polluting the timing.

// Sum of squares over `length` int8 bytes starting at `offset`, repeated `iterations` times.
// Each byte contributes one multiply-add ("op" for wasm_score's ops/s unit — 04 §2 notes this
// unit is "arbitrary but fixed," which this satisfies: same kernel, same op definition, every run).
// The XOR-accumulation across iterations (rather than just overwriting `sum`) is deliberate: it
// forces every iteration's result to actually feed the next one, so an optimizing compiler can't
// prove later iterations are dead code and fold the whole loop away.
export function dotProduct(offset: i32, length: i32, iterations: i32): i64 {
  let acc: i64 = 0;
  for (let iter: i32 = 0; iter < iterations; iter++) {
    let sum: i64 = 0;
    for (let i: i32 = 0; i < length; i++) {
      const v = load<i8>(offset + i);
      sum += i64(v) * i64(v);
    }
    acc ^= sum;
  }
  return acc;
}
