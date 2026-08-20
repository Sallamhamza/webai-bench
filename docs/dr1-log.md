# DR-1 tracking log

**Purpose:** raw log for the DR-1 demand-gate (`docs/08-delivery-plan.md` §1) — posted to start
this off, per `docs/launch-post-draft.md`. Pass criteria: within 2 weeks of the first post, either
**≥10 external completed runs shared** or **maintainer engagement**. The decision at the end
needs this actual log, not a recollection of "it felt like people were interested."

## Clock

- **First post (starts the clock):** WebLLM (mlc-ai/web-llm), 2026-08-16
- **DR-1 decision due:** 2026-08-30

## Posts made

| Date | Venue | Link | Notes |
|---|---|---|---|
| 2026-08-16 | WebLLM (mlc-ai/web-llm) | [fill in link] | First post — starts the clock |
| on/before 2026-08-20 | Transformers.js (huggingface/transformers.js) | [fill in link] | Exact date TBD — got a reply by 2026-08-20 (see below), so posted on or before then |

## Responses log

Add one row per response as it comes in — a comment, a reaction, a shared run, a maintainer
question, anything. Don't filter for "does this count" while logging; filter at decision time.

| Date | Venue | Who | Type (comment / reaction / run shared / maintainer reply / other) | Summary | Counts toward "10 runs shared"? |
|---|---|---|---|---|---|
| 2026-08-20 | Transformers.js | "DeepSeek-V3.2, AI Village project" | comment (methodology discussion) | Raised warm-up standardization, memory-access-pattern profiling, and browser-specific-optimization points; asked about tensor sizes, latency/throughput/memory focus, and where the WASM/WebGPU gap is widest. Replied with grounded answers from 04-benchmark-methodology.md + registry.json, and declined the collaborative multi-browser-agent proposal as premature (no backend/crowd-data pipeline yet). | No — **not a maintainer** (a third-party AI-agent commenter, by its own description, not affiliated with the WebLLM/Transformers.js projects) and no run was shared, just methodology discussion. Doesn't satisfy either DR-1 pass branch on its own, but is a genuine engagement/interest signal worth having on record |

## Decision (fill in at the 2-week mark)

- Total external completed runs shared: **[count]**
- Maintainer engagement (WebLLM): **[yes/no — link if yes]**
- Maintainer engagement (Transformers.js): **[yes/no — link if yes]**
- **Result: PASS / FAIL**
- What this means for what happens next: see `docs/08-delivery-plan.md` §1 ("Fail → stop,
  re-evaluate before any backend work.")
