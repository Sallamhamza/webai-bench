# WebAI Bench — Engineering Documentation Set

**Project working title:** WebAI Bench (final name TBD — see Decision Log in `03-architecture.md`)
**One-line pitch:** A public website that benchmarks in-browser AI inference (WebGPU/WASM) on any visitor's device in ~90 seconds, and aggregates opt-in results into the first open, crowdsourced database answering: *"Which model + quantization + runtime actually works for my users' hardware?"*

**Document owner:** Project Lead (Hamza Sallam)
**Status:** v1.0 — approved baseline for Phase 0 start
**Audience:** every engineer contributing to this project, including juniors onboarding with zero context.

---

## How to use this documentation

Read in order on your first day. After onboarding, use it as a reference:

| # | Document | Read when you need to know… |
|---|----------|------------------------------|
| 01 | `01-project-charter.md` | Why this exists, who it's for, what success looks like, what we will NOT build |
| 02 | `02-requirements.md` | Exactly what the system must do (numbered, testable requirements) |
| 03 | `03-architecture.md` | How the system is structured, every component, every tech decision and its rationale |
| 04 | `04-benchmark-methodology.md` | How we measure — metric definitions, procedure, statistical validity. **The scientific core. Do not change anything here without an ADR.** |
| 05 | `05-data-model-and-api.md` | Schemas, API contracts, dataset publishing format |
| 06 | `06-security-privacy.md` | Threat model, abuse defenses, privacy guarantees, consent flow |
| 07 | `07-scalability-operations.md` | Free-tier capacity plan, observability, incident response, growth path |
| 08 | `08-delivery-plan.md` | Phases, epics, stories with acceptance criteria, testing strategy, ways of working, Definition of Done |

## Ground rules (apply to every contribution)

1. **The methodology doc is law.** Benchmark numbers people rely on must be reproducible. Any change to timing, warmup, model versions, or aggregation requires a versioned suite bump and an ADR (see `03-architecture.md` §7).
2. **Privacy is a feature, not a compliance chore.** We never store anything that can identify a person or uniquely fingerprint a device. When in doubt, collect less. See `06-security-privacy.md`.
3. **$0 infrastructure is a hard constraint for v1.** Every design choice must run on documented free tiers. If a proposal needs money, it needs a written justification and Lead approval.
4. **All data is suspect until validated.** Every submitted result passes plausibility gates before it can influence public aggregates. See `06-security-privacy.md` §4.
5. **Ship small.** PRs under ~400 changed lines, one logical change each, CI green before review. See `08-delivery-plan.md` §7.

## Glossary (juniors: read this first)

- **TTFT** — Time To First Token: latency from sending a generation request until the first output token callback fires. The "feels responsive" metric.
- **Decode TPS** — tokens per second during steady-state generation, measured after the first token. The "throughput" metric.
- **Prefill** — processing the input prompt before generation starts; dominates TTFT for long prompts.
- **Quantization (q4f16, q4f32, q8…)** — compressing model weights to fewer bits. `q4f16` = 4-bit weights with float16 activations; requires the WebGPU `shader-f16` feature. `q4f32` works without it but uses more memory/bandwidth.
- **WebGPU** — modern browser API exposing GPU compute (successor to WebGL). Our fast path.
- **WASM (WebAssembly)** — portable compiled code running on the CPU in the browser. Our universal fallback path.
- **SIMD / threads (WASM)** — CPU vector instructions and multi-threading for WASM. Threads require *cross-origin isolation*.
- **Cross-origin isolation (COOP/COEP)** — HTTP response headers (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`) that unlock `SharedArrayBuffer` (→ WASM threads) and high-resolution timers. Static hosts that can't set headers can't give us this — see `03-architecture.md` §5.2.
- **Runtime** — the JS library executing the model: WebLLM (MLC), Transformers.js (ONNX Runtime Web under the hood), wllama (llama.cpp compiled to WASM).
- **EP (Execution Provider)** — ONNX Runtime term for a backend (webgpu, wasm).
- **Cohort** — a group of results sharing the same (model, quant, runtime, backend, browser family, OS family, GPU vendor/architecture) key. Public aggregates are computed per cohort.
- **k-anonymity threshold** — we only display a cohort publicly when it contains ≥ k results (k=5), so no single device is identifiable or over-weighted.
- **Suite version** — semantic version of the benchmark definition (models, procedure, timing rules). Results are only comparable within a suite major version.
- **ADR** — Architecture Decision Record: a short markdown file capturing a decision, its context, and alternatives considered.
- **Plausibility gate** — server-side validation rejecting physically impossible or internally inconsistent submissions (e.g., decode TPS wildly exceeding what the device's measured compute could produce).
- **OPFS** — Origin Private File System; browser-local storage we use for caching model weights and crash markers.
