# Runtime adapters (E2)

Real per-runtime adapters live here: `webllm.ts` (E2-S1), `transformersjs.ts` (E2-S2), `wllama.ts`
(E2-S3). Each implements `CellAdapter` (`../runner.ts`) and is checked against the conformance
suite (`../adapterConformance.ts`, E2-S4) before being wired into anything else.

## Test boundary (decided before S1/S2/S3, not per-adapter ad hoc)

This is the E2-scoped instance of the general WebGPU-in-CI problem `08-delivery-plan.md` §6.4
already describes for the suite as a whole:

- **Contract tests (Node/vitest, run in CI, every PR):** the conformance suite itself, run
  against fakes — already built (E2-S4). Fast, deterministic, no browser needed.
- **WASM-path smoke (Playwright + a tiny real test model, run in CI):** each adapter that has a
  WASM execution path (wllama always; Transformers.js's wasm EP) gets one real end-to-end
  Playwright test asserting completion + sane output ranges — this is `08` §6.4(a)'s "WASM-path
  benchmark with a tiny test model," scoped per-adapter.
- **WebGPU-path correctness only (Playwright + Chromium/SwiftShader, run in CI):** for WebLLM and
  Transformers.js's webgpu EP, CI can only validate that the path _runs_ (adapter conformance
  checks pass, shaders compile, a cell completes) — never performance numbers, per `08` §6.4(b).
  SwiftShader is a software rasterizer; timings from it are meaningless.
- **Real performance numbers:** the device-lab protocol (`08` §6.4(c),
  `docs/device-lab.md` once it exists), same as every other performance claim this project makes.
  Not CI's job, ever.

Deciding this now (rather than during each adapter's own story) is the point: it stops "can we
test this in CI" from being renegotiated three times against whatever each SDK happens to make
easy.

## Version pinning (ADR 5.4)

`03-architecture.md` ADR 5.4: adapter versions are pinned exactly; a runtime upgrade is a
registry change + ADR + suite minor bump. Practical consequence for S1/S2/S3: when each adapter
lands, `packages/harness/package.json` should pin the underlying library with an **exact**
version (no `^` range) — not the loose `^0.2.84` / `^4.2.0` ranges currently used by the
throwaway SP2/SP3 spike pages in `apps/web`, which were never meant to be the pin of record.
Bumping later is an ADR-worthy event, not a routine `pnpm update`.

## QUIRKS.md

`QUIRKS.md` in this directory tracks each library's operational surprises (callback timing
oddities, disposal gotchas, token-count discrepancies vs. our own bracketing) as they're found —
cheap to write in the moment, and it's both the future debugging map and raw material for the
`runtime_disagreement` investigations `04-benchmark-methodology.md` §5 asks for.
