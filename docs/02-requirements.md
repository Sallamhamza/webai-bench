# 02 — Requirements Specification

**Status:** Approved v1.0 · Every requirement has an ID. Reference IDs in commits, PRs, and test names (e.g., `test_FR3_2_rejects_oversized_payload`).
Priority: **M** = must (v1 blocks launch), **S** = should (v1 target), **C** = could (post-v1 backlog).

---

## 1. Functional requirements

### FR1 — Capability probe
- **FR1.1 (M):** On page load (before any download), detect and display: WebGPU availability; `adapter.info` fields (vendor, architecture); relevant `adapter.features` (`shader-f16`, `timestamp-query`) and `adapter.limits` (`maxBufferSize`, `maxStorageBufferBindingSize`); WASM SIMD support; WASM threads support; `crossOriginIsolated` status; logical cores (`navigator.hardwareConcurrency`); coarse device memory hint (`navigator.deviceMemory`, Chromium-only, may be absent); browser family+major version and OS family+version via UA-Client-Hints with UA-string fallback.
- **FR1.2 (M):** The probe must never throw; every field is optional and recorded as `null` when unavailable.
- **FR1.3 (M):** Probe results determine which matrix cells are runnable on this device; unrunnable cells are shown greyed-out with the *reason* (e.g., "requires shader-f16 — not supported by this GPU/driver").

### FR2 — Benchmark execution
- **FR2.1 (M):** The suite runner executes a user-selected subset of the v1 matrix (see `04` §3): micro-benchmarks (GPU matmul GFLOPS, GPU memory-bandwidth proxy, WASM CPU throughput) and model benchmarks (embedding, small-LLM tiers, ASR — per registry).
- **FR2.2 (M):** For each model benchmark, measure and record separately: model download size (MB) and wall time; cold initialization time (engine + shader/JIT compile); TTFT; decode TPS; per-run raw samples. Exact procedure and definitions: `04-benchmark-methodology.md` §4–5. Methodology doc is normative; this doc only requires that it is implemented exactly.
- **FR2.3 (M):** Runs execute with warmup and N=3 measured repetitions; the UI shows live progress per step.
- **FR2.4 (M):** Every step has a watchdog timeout (default 120 s model init, 90 s per measured run; configurable per registry entry). On timeout, record status `timeout` and continue to the next cell.
- **FR2.5 (M):** Crash detection: before model load, persist a `run-started` marker (localStorage) containing the cell id; clear it on completion. On next page load, if a stale marker exists, prompt the user to confirm and record a `crash-suspected` result for that cell.
- **FR2.6 (M):** If the tab loses visibility mid-run, pause between repetitions, flag the run `visibility-interrupted`, and exclude it from submission-eligible metrics (still shown locally with the flag).
- **FR2.7 (M):** Downloaded model weights are cached (Cache API/OPFS via the runtime's own caching); a "clear cached models" control exists; total cache size is displayed before download with an explicit size warning ≥ 300 MB.
- **FR2.8 (S):** A "quick run" preset (probe + micro + embedding + smallest LLM tier; ≤ ~150 MB download) and a "full run" preset.
- **FR2.9 (M):** Model weight integrity: after download, verify content against the pinned revision's expected hashes where the runtime exposes them; record `integrity_verified: true/false/unknown`.

### FR3 — Results, sharing, submission
- **FR3.1 (M):** After a run, show a local results card: per-cell metrics, device summary, suite version. Fully functional offline/without backend.
- **FR3.2 (M):** Opt-in submission: an explicit consent screen (see `06` §5.2) precedes any network transmission of results. Payload conforms to the versioned JSON schema (`05` §2); server rejects non-conforming or oversized (> 32 KB) payloads.
- **FR3.3 (M):** On accepted submission, return a `result_id`; the shareable URL `/r/{result_id}` renders that single result. No other identifier appears in URLs.
- **FR3.4 (M):** Users who decline submission can still export their results locally as JSON.
- **FR3.5 (S):** Submission is retried with backoff on network failure; results are queued locally until sent or discarded by the user.

### FR4 — Explorer (aggregate views)
- **FR4.1 (M):** Explorer answers, with filters for model/quant/runtime/backend/browser/OS/GPU-vendor: success rate, median and p10/p25/p75/p90 for decode TPS and TTFT, cohort n, failure-reason breakdown.
- **FR4.2 (M):** Cohorts with n < 5 display as "insufficient data (n<5)" — never partial numbers.
- **FR4.3 (M):** Explorer reads only precomputed static snapshot JSON from the CDN (never queries the database per visitor). Snapshot freshness timestamp is displayed.
- **FR4.4 (S):** A "support matrix" view: models × device-classes grid of works/degraded/fails coloring.
- **FR4.5 (C):** Runtime-version regression view (metric trend lines per runtime release).

### FR5 — Open data & API
- **FR5.1 (M):** Daily public dataset dump (validated results only, plus a separately flagged quarantine file) in Parquet + CSV, with schema docs and CC-BY-4.0 license file.
- **FR5.2 (S):** Read-only aggregate API: `GET /api/v1/aggregates?model=…&runtime=…` returning the same numbers as the explorer, cacheable, rate-limited.
- **FR5.3 (C):** Embeddable badge/widget: "X% of tested devices run this model."

### FR6 — Content & trust
- **FR6.1 (M):** A public `/methodology` page rendering `04-benchmark-methodology.md`, versioned, with changelog.
- **FR6.2 (M):** Every displayed aggregate links to its cohort definition and n.
- **FR6.3 (M):** Clear "self-reported, crowdsourced data" disclaimer on all aggregate views.

## 2. Non-functional requirements

### NFR-P — Performance
- **NFR-P1 (M):** Static site TTI < 3 s on a mid-range laptop over 4G (Lighthouse perf ≥ 90); the app shell must not download any model bytes until the user starts a run.
- **NFR-P2 (M):** Harness overhead (instrumentation cost) < 2% of measured durations — validated by A/B harness-on/off test in `08` §6.2.
- **NFR-P3 (M):** Snapshot JSON per explorer view ≤ 500 KB compressed.

### NFR-R — Reliability
- **NFR-R1 (M):** A failed backend never blocks local benchmarking (graceful degradation, FR3.1/FR3.5).
- **NFR-R2 (M):** Ingest availability target 99% monthly (free-tier realistic); missed submissions are recoverable client-side.
- **NFR-R3 (M):** All timestamps UTC ISO-8601; server clock is authoritative for `created_at`.

### NFR-S — Security & privacy
- **NFR-S1 (M):** Implement all "M" mitigations in `06-security-privacy.md` (CSP, input validation, rate limiting, Turnstile on submit, plausibility gates, no-PII schema, no third-party scripts/analytics).
- **NFR-S2 (M):** No cookies; no persistent client identifiers; IP addresses used transiently at the edge for rate limiting only and never written to storage.

### NFR-C — Compatibility
- **NFR-C1 (M):** Full function on latest stable Chrome/Edge (Win/macOS) and Chrome Android (WebGPU-capable devices).
- **NFR-C2 (M):** Safari (macOS 26+/iOS 26+) and Firefox 141+ (Windows): WebGPU path supported; where a runtime/browser combo is unsupported, the cell is greyed with reason (FR1.3) — never a blank failure.
- **NFR-C3 (M):** WASM fallback path functional on all evergreen browsers, including non-cross-origin-isolated contexts (single-threaded WASM).
- **NFR-C4 (M):** Feature-detect everything; zero UA-sniffing for behavior decisions (UA data is recorded, not branched on).

### NFR-M — Maintainability & openness
- **NFR-M1 (M):** Monorepo, TypeScript strict mode, shared schema package is the single source of truth for validation on both client and server (`05` §2).
- **NFR-M2 (M):** Adding a model = one registry JSON entry + ADR; no code changes for standard cases.
- **NFR-M3 (M):** CI: lint, typecheck, unit, schema-contract, and Playwright smoke on every PR; deploy from `main` only.
- **NFR-M4 (M):** Code Apache-2.0; docs CC-BY-4.0; dataset CC-BY-4.0. LICENSE files present at repo root and in dumps.

### NFR-A — Accessibility & i18n
- **NFR-A1 (S):** WCAG 2.1 AA on core flows (keyboard navigable, visible progress announced via `aria-live`).
- **NFR-A2 (C):** Copy centralized for future i18n; English-only v1.

## 3. Acceptance traceability

Every FR/NFR "M" item must map to at least one automated test or a documented manual test in the device-lab protocol before Phase-2 launch. The traceability table lives at `08-delivery-plan.md` §6.5 and is a release gate.
