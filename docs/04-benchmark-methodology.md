# 04 — Benchmark Methodology (Normative)

**Status:** Approved v1.0 · **This document is law.** Any change to §3–§7 requires an ADR and a suite version bump per §8. If code and this document disagree, the code is wrong.

---

## 1. What we measure, and what we deliberately don't

We measure **performance and compatibility** of in-browser inference: does a given (model, quantization, runtime, backend) cell run on this device, how fast does it start, and how fast does it generate. We do **not** measure model output quality (NG3) and we never mix network-dependent numbers (download) into compute metrics.

## 2. Definitions of record

All metrics use wall-clock brackets from `performance.now()` in the same execution context as the runtime call. The runtime's self-reported statistics are stored alongside as `runtime_reported_*` for cross-validation but are never the metric of record.

| Metric | Definition (normative) | Unit |
|---|---|---|
| `download_mb`, `download_ms` | Total bytes fetched for the cell's weights + wall time, cache-miss case only. If served from cache, record `download: null` and `cache_hit: true`. Reported separately; excluded from all performance aggregates. | MB, ms |
| `init_ms` (cold) | From invoking the adapter's `init()` (weights already local) to the adapter reporting ready. Includes engine setup and shader/JIT compilation. Measured once per cell per session (first init only). | ms |
| `ttft_ms` | From invoking `generate()` with the standard prompt to the first token callback firing. Includes prefill. | ms |
| `decode_tps` | `(N_tokens − 1) / (t_last_token − t_first_token)` for a fixed generation of `N_tokens = 128`, greedy decoding. Excludes TTFT by construction. | tokens/s |
| `embed_sps` | Sentences/second for one batch of the 64 standard sentences (single call where the runtime supports batching; otherwise a tight sequential loop — record `batching: true/false` as a dimension). | sentences/s |
| `asr_rtf` | Real-time factor = audio_seconds / processing_seconds on the standard 30 s clip (higher is better). | × |
| `matmul_f32_gflops`, `matmul_f16_gflops` | Achieved GFLOPS of the reference WGSL tiled-matmul compute shader at M=N=K=1024, average of ≥10 timed dispatches after 3 warmup dispatches, timed via `queue.onSubmittedWorkDone()` brackets (plus `timestamp-query` when available, stored as supplementary). f16 variant only when `shader-f16` is present. | GFLOPS |
| `mem_bw_gbps` | Achieved GB/s of the reference buffer-copy compute kernel over a 256 MB working set (or the largest power-of-two ≤ 25% of `maxBufferSize`, size recorded). | GB/s |
| `wasm_score_single`, `wasm_score_multi` | Throughput of the fixed WASM workload (bundled, versioned binary: int8 dot-product kernel over a fixed buffer) on 1 thread and on `min(hardwareConcurrency, 8)` threads (multi only when cross-origin isolated). | ops/s (arbitrary but fixed unit) |

**Standard inputs (versioned fixtures in `packages/registry/fixtures/`, referenced by SHA-256 in every result):**
- LLM prompt: fixed English instruction+context text tokenizing to ~256 tokens on the reference tokenizer; generation length 128; greedy/temperature 0; seed pinned where the runtime supports it.
- Embedding set: 64 fixed sentences (public-domain sources), mixed lengths 8–64 words.
- ASR clip: 30 s public-domain English speech WAV, 16 kHz mono, bundled with the site.

## 3. The v1 matrix (suite `1.x`)

A **cell** = (model_id @ pinned_revision, quant, runtime @ pinned_version, backend, execution_context). The registry (`packages/registry`) is the single source of truth; this table defines intent:

| Tier | Model (license — verify at impl.) | Quants | Runtimes × backends |
|---|---|---|---|
| Micro | (no model) | — | WebGPU shaders + WASM workload — always run |
| 0 — quick | MiniLM-class sentence embedder (Apache-2.0) | default | Transformers.js × {webgpu, wasm} |
| 0 — quick | SmolLM2-360M-Instruct (Apache-2.0) | q4 | WebLLM × webgpu; wllama × wasm |
| 1 | SmolLM2-1.7B-Instruct **or** Qwen2.5-1.5B-Instruct (Apache-2.0) | **q4f16 and q4f32** | WebLLM × webgpu |
| 1 (S) | Whisper-tiny (MIT) | default | Transformers.js × {webgpu, wasm} |
| 2 (opt-in, C) | one ~3B instruct (Apache-2.0) | q4f16 | WebLLM × webgpu |

Rules: ≤ 8 model configurations total in v1 (NG8). Every cell declares `expected_download_mb`, `timeout_init_ms`, `timeout_run_ms`, `min_requirements` (features/limits) in the registry. The q4f16-vs-q4f32 pair on the same Tier-1 model is mandatory — it is the single most decision-relevant comparison (the `shader-f16` population split).

## 4. Run procedure (normative sequence)

For each selected cell, the runner executes exactly:

1. **Preflight:** check `min_requirements` against the probe → else status `unsupported(reason)`, skip.
2. **Acquire weights:** download (or cache-hit) with progress UI; verify integrity where hashes are available (FR2.9); failure → `download-error`.
3. **Crash marker:** write `run-started {cell_id, ts}` to localStorage (cleared at step 8).
4. **Cold init:** measure `init_ms` under its watchdog; failure → `init-error(code)`; a `GPUDevice.lost` listener is attached for the cell lifetime.
5. **Warmup:** exactly 1 full generate/embed/transcribe pass with the standard input; results discarded. (Purpose: JIT/shader/pipeline caches populated; separates one-time costs — already captured in `init_ms` — from steady state.)
6. **Measured repetitions:** N=3 passes. Between reps: `await` a 500 ms macrotask yield (cooldown + event-loop drain). Record every raw sample.
7. **Guards during 5–6:** if `document.visibilityState !== 'visible'` at a rep boundary, pause until visible and set flag `visibility-interrupted` (cell excluded from submission metrics, FR2.6). If a watchdog fires → `timeout`, dispose, next cell.
8. **Teardown:** adapter `dispose()`; clear crash marker; persist partial results incrementally so a later crash loses at most one cell.

**Cell ordering:** micro first (they power plausibility gates and give an early result), then ascending model size (maximize completed cells before any OOM). Tier-2 always last and opt-in.

## 5. From samples to reported numbers

Per cell: report the **median** of the 3 measured reps for each metric, and store `min`/`max`. Derived flags:
- `thermal_variance` if `(max − min)/median > 0.25` for decode_tps — the number is kept but flagged; the flag is a filterable dimension.
- `runtime_disagreement` if `runtime_reported_tps` differs from our bracketed `decode_tps` by > 15% — kept, flagged, surfaced in the data-quality dashboard (usually an adapter bug: investigate).

Why N=3 with 1 warmup: Phase-0 spike SP4 measures rep-to-rep spread on the device lab; if spread > 10% median-relative on any lab device, N increases (via ADR) before launch. We choose few-reps-per-visitor + many visitors over many-reps-per-visitor: population percentiles are the product, and visitor patience is the binding constraint.

## 6. Aggregation (population statistics)

- **Cohort key:** (suite_major, model_id, quant, runtime, runtime_version_major, backend, execution_context, browser_family, browser_major, os_family, gpu_vendor, gpu_architecture). Explorer filters may merge cohorts *upward* (e.g., all browser majors) — never split below the key.
- **Published per cohort (only when n ≥ 5):** n, success rate (successes / all terminal statuses), median, p10/p25/p75/p90 per metric, failure-reason breakdown. Percentiles computed exactly over the cohort's per-device medians. A device submitting twice on the same suite version counts its latest only (deduped via client nonce lineage).
- **Uncertainty:** the offline analysis job (C9) computes bootstrap 95% CIs for cohort medians; the explorer shows CI whiskers when n ≥ 20, otherwise a "low-n" badge.
- **Never published:** drill-downs below k=5; means (medians only — robustness against outliers/poisoning); cross-suite-major mixtures.

## 7. Validity — threats and our answers

| Threat | Concretely | Countermeasure |
|---|---|---|
| Construct validity | "tokens/s" without fixed prompt/length/decoding is meaningless | Standard fixtures (§2), greedy decoding, fixed lengths; operational metric definitions |
| Internal validity | JIT/shader warmup, thermal throttling, background tabs pollute numbers | Warmup pass, cooldowns, visibility guard, variance flags, median-of-3, micro-benchmarks as covariates |
| Instrument validity | The harness itself perturbs the measurement | NFR-P2 overhead test (< 2%); timing in the same context as the workload; no analytics scripts (ADR 5.9) |
| External validity | Visitors are enthusiast-skewed — **not** the global device population | The explorer never claims market share; all numbers are conditional on cohort; disclaimer FR6.3; docs state the selection bias plainly |
| Reliability over time | Runtime/browser updates shift results | runtime_version and browser_major in the cohort key; suite versioning §8; regression view (FR4.5) |
| Comparability across runtimes | Runtimes differ in tokenizers/steps | Same fixture text; tokens-generated recorded per runtime tokenizer; cross-runtime views carry an explicit caveat and display tokens-generated |

## 8. Suite versioning (comparability contract)

`suite_version = MAJOR.MINOR.PATCH`, stored on every result.
- **MAJOR:** any change that breaks comparability — procedure, fixtures, timing rules, N/warmup changes, or a model revision/quant change within an existing cell. Aggregates never mix MAJOR versions; the explorer defaults to the latest MAJOR.
- **MINOR:** additive only — new cells, new optional metrics. Existing cohorts unaffected.
- **PATCH:** no measurement-path change (UI, docs, non-measurement fixes). Must be provably measurement-neutral; when in doubt, it's a MAJOR.
Every bump: ADR + changelog entry on `/methodology` (FR6.1). A yanked suite (bad release) is marked invalid in `meta`; its results are excluded from aggregates and flagged in dumps — never deleted.
