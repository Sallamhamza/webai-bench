# SP2 — WebLLM timing bracket spike

**Status:** Passed · **Date:** 2026-07-19

**Question (docs/08-delivery-plan.md §2):** Can we bracket WebLLM timing reliably?

## Method

`apps/web/src/Sp2WebllmSpike.tsx`: loaded `SmolLM2-360M-Instruct-q4f16_1-MLC` via
`CreateMLCEngine`, ran one streaming `chat.completions.create` request
(`stream_options: { include_usage: true }`), and compared:

- **Ours:** `performance.now()` bracketed around the request and the first streamed chunk with
  non-empty `delta.content` (TTFT), and around first-token → stream-end for decode TPS
  (`(completion_tokens - 1) / elapsed_s`, matching the glossary's decode-TPS definition —
  post-first-token steady state).
- **Runtime-reported:** `usage.extra.time_to_first_token_s` and `usage.extra.decode_tokens_per_s`
  from WebLLM's own final usage chunk.

Run on lead's machine (Chrome, WebGPU available).

## Result

| Metric | Ours | Runtime-reported | Delta |
|---|---|---|---|
| init | 86,461 ms | — | — |
| TTFT | 16,480.4 ms | 16,469.9 ms | **0.1%** |
| decode TPS | 5.39 | 5.46 | **-1.4%** |

completion_tokens: 86.

**Conclusion: our `performance.now()` bracketing agrees with WebLLM's self-reported stats to
within ~1.4%, comfortably inside the NFR-P2 target (<2% harness overhead). Cross-checking against
runtime-reported stats going forward (per `03-architecture.md` §5.7) is validated as a sound
approach — we do not need to trust our brackets blindly, and the two sources agree.**

## Side finding (feeds SP4 / methodology)

TTFT on this first-ever call was ~16.5s despite `init` (model download + engine init) already
completing separately at ~86s. This is WebGPU's shader/pipeline compilation happening lazily on
the *first inference*, not during engine init — a real, large, one-time cost. This confirms the
methodology's warmup-before-measuring requirement (FR2.3, `04-benchmark-methodology.md`) is not
optional: without a discarded warmup rep, the first measured TTFT would be dominated by
one-time compile cost rather than steady-state performance. Feed this into SP4's variance study.

## Exit artifact

This document (numbers above) + `apps/web/src/Sp2WebllmSpike.tsx`.
