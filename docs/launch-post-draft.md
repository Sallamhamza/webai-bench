# Launch post draft (E5)

**Purpose:** starting material for posting to the WebLLM and Transformers.js GitHub Discussions
(and wherever else people compare in-browser inference numbers by hand). Not meant to be posted
verbatim — adjust tone/length per venue, fill in the `[...]` placeholders, and drop community-
specific framing where it doesn't fit. This is the artifact that starts the DR-1 demand-gate
clock (`docs/08-delivery-plan.md` §1) once posted — see that doc for what a pass/fail on DR-1
means for what happens next.

**Framing note (why this post is shaped the way it is):** this is deliberately *not* "here's a
finished benchmark site, come use it." It's "here's an early prototype and an interesting result
— does this approach seem right to you?" DR-1's real question is whether the people who'd
actually use this kind of data engage with it at all, not whether the finished product delights
them. A maintainer poking holes in the methodology is a **pass** for that purpose, not a failure.

---

## Draft

**Title:** WASM beat WebGPU by ~9.6x on a small embedding model — building an open benchmark to
find out where else that's true

I've been building **WebAI Bench**, an open-source, in-browser benchmark for WebGPU/WASM AI
inference. It runs entirely client-side (nothing leaves your device unless you choose to submit
results), and the goal is a crowdsourced answer to a question I couldn't find good data on
anywhere: *for a given model + quantization + runtime, what actually works on real hardware, not
just the machine the library maintainer tested on?*

The reason I'm posting now rather than waiting for a "finished" product: while spiking this out, I
ran `Xenova/all-MiniLM-L6-v2` (a small, ~22M-parameter embedding model) through
`@huggingface/transformers` on both WebGPU and WASM execution providers, same device, same input.
WASM won by a lot — **~3.5x faster to init, ~9.6x faster to embed**. That's the opposite of the
"WebGPU is the fast path, WASM is the fallback" assumption I'd baked into my own project glossary
before running the numbers. The likely cause: at this model size, WebGPU's fixed per-call
overhead (shader/pipeline compile, kernel dispatch, host↔device transfer) never gets amortized —
WASM's lower fixed cost wins outright. Full writeup: `docs/spikes/sp3-findings.md` in the repo.

That result is exactly why I think this needs to be measured, not assumed, and measured across a
lot of real devices, not just mine.

**What's actually built right now (being precise about this):**
- A capability probe, a versioned model registry (currently 6 cells across WebLLM, Transformers.js,
  and wllama), and a full run flow — progress, a Stop button that actually works, a size warning
  before large downloads, local JSON export.
- All three runtimes have adapters passing a shared conformance test suite. Of those, **only the
  WebLLM/WebGPU path has been run end-to-end in a real browser so far** — TTFT and decode-tps
  brackets agree with WebLLM's own self-reported numbers within ~1-2%. Transformers.js and wllama
  are wired in but haven't had that same real-browser exercise yet.
- No backend yet — this phase is local-only. Opt-in submission/aggregation is next if this phase
  validates.

**What I'd actually value from this community specifically:**
- Does the [methodology](../apps/web) (fixed prompt/N=3 median/warmup-then-discard/etc. — full
  detail in `docs/04-benchmark-methodology.md`) look right to people who actually build these
  runtimes? Anything you'd measure differently?
- Any known runtime-specific gotchas I should know about before more people hit this in the
  wild — I've been logging every one I've found in
  [`packages/harness/src/adapters/QUIRKS.md`](../packages/harness/src/adapters/QUIRKS.md) as I go
  and would rather find out about more of them from people who know the internals than from
  confused bug reports later.
- If you have five minutes and a spare device: [live site link — TODO] and see what it reports.
  Numbers export locally as JSON right now; nothing is collected without explicit opt-in later.

Repo: [TODO — GitHub URL]. Apache-2.0 code, CC-BY-4.0 docs/dataset. Feedback, especially the kind
that pokes holes in the approach, is genuinely what I'm here for at this stage.

---

## Posting checklist

- [ ] Fill in live site URL once deployed
- [ ] Fill in repo URL
- [ ] Post to WebLLM GitHub Discussions
- [ ] Post to Transformers.js GitHub Discussions
- [ ] Post to wherever else tok/s comparisons get hand-pasted (r/LocalLLaMA, relevant Discords —
      pick venues where methodology critique is likely, not just traffic)
- [ ] Start the DR-1 two-week clock from the first post's timestamp
- [ ] Log every response (engagement, critique, or silence) somewhere durable — DR-1's pass/fail
      call needs the actual count, not a vibe
