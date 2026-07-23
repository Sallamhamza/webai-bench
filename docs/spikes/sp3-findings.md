# SP3 — Transformers.js embedding on webgpu and wasm EPs

**Status:** Passed · **Date:** 2026-07-23

**Question (docs/08-delivery-plan.md §2):** Transformers.js embedding on webgpu **and** wasm EPs?
Same-model both-backends numbers + fallback behavior notes.

## Method

`apps/web/src/Sp3TransformersEmbedding.tsx`: loaded `Xenova/all-MiniLM-L6-v2` (MiniLM-class
embedding model, Apache-2.0, the Tier-0 embedding model per `03-architecture.md` §5.5) via
`@huggingface/transformers`, once with `device: "webgpu"` and once with `device: "wasm"` (fresh
pipeline instance each time, disposed after use), embedding one fixed sentence with mean pooling
+ normalization. Run on lead's machine (single device — same multi-device caveat as SP4 applies).

## Result

| device | status | init ms | embed ms | output dims | notes |
|---|---|---|---|---|---|
| webgpu | ok | 33,583 | 1,764.6 | 1×384 | ready, no fallback needed |
| wasm | ok | 9,470 | 183.4 | 1×384 | ready, no fallback needed |

Both execution providers work directly on this device — no fallback path was exercised (neither
EP failed, so we didn't observe what Transformers.js does when one is unsupported; that's a gap,
see Follow-ups).

## Finding: WASM beats WebGPU for this model size, by a lot

WASM was **~3.5× faster to init** and **~9.6× faster to embed** than WebGPU. This is the opposite
of the assumption baked into the glossary ("WebGPU — our fast path" / "WASM — our universal
fallback path", `00-README.md`). The likely cause: MiniLM is tiny (~22M params, batch size 1 in
this test), so WebGPU's fixed overhead — shader/pipeline compilation (consistent with the SP2/SP4
finding that first-WebGPU-inference pays a large one-time compile cost) plus per-call kernel
dispatch and host↔device data transfer — is never amortized. WASM's SIMD path has much lower
fixed cost and wins outright at this scale.

**Implication for the registry and methodology:** "WebGPU is faster" cannot be assumed per model;
it depends on model size/workload. This is exactly the kind of population-level, per-cell finding
the whole project exists to surface (`01-project-charter.md` §1) — good validation that the
compatibility matrix approach (rather than a single "recommended path") is the right shape for
v1. The embedding model's benchmark cells should not be pre-sorted by backend assumption; wasm
must be measured and shown even where webgpu is available, not just as a fallback-when-unsupported
option.

## Follow-ups (not blocking)

- Didn't observe actual fallback behavior (what happens when an EP is genuinely unsupported —
  does Transformers.js throw synchronously, reject the pipeline promise, or silently downgrade?).
  Worth testing deliberately in a browser/environment where WebGPU is unavailable before E2-S2
  (Transformers.js adapter) is built, so the adapter's error handling matches reality.
- Single run per device (no repeated reps) — sufficient for SP3's "does it work, roughly how do
  the two compare" question; real per-cell variance for embedding models is E1/E2 territory,
  covered by the same N=3+median approach validated in SP4.
- Multi-device coverage deferred to the device-lab protocol (`08-delivery-plan.md` §6.4), same
  caveat as SP2/SP4.

## Exit artifact

This document (table above) + `apps/web/src/Sp3TransformersEmbedding.tsx`.
