# 08 — Delivery Plan, Testing & Ways of Working

**Status:** Approved v1.0 · Capacity assumption: ~15–20 h/week lead + occasional contributors ≈ **2–2.5 ideal-days/week**. Estimates below are in ideal-days (id). If actuals exceed estimate by >50%, stop and re-scope — that's a signal, not a failure.

---

## 1. Phase map

| Phase | Weeks | Outcome | Exit gate |
|---|---|---|---|
| 0 — Spikes | 1–2 | All risky unknowns proven on real code | **G0:** all six spikes pass their exit artifact |
| 1 — Local-only MVP | 3–6 | Public site: probe + quick-preset benchmarks + local results card + methodology page. No backend. | **DR-1 (demand gate):** posted to WebLLM & Transformers.js GitHub Discussions + relevant communities; within 2 weeks: ≥10 external completed runs shared **or** maintainer engagement. **Fail → stop, re-evaluate before any backend work.** |
| 2 — Crowd data | 7–10 | Ingest + consent + gates + cron aggregation + explorer v1 + dumps | **G2:** traceability table 100% for M-items · security pass E11 done · DQ dashboard live · k-threshold verified on real data · restore drill done |
| 3 — Depth | 11–16 | Matrix expansion, regression view, read API/badge, contribution flow | **G3:** KPI review vs. charter §6 |

## 2. Phase 0 — spikes (each = 1 id, throwaway code allowed, findings are the deliverable)

| ID | Question | Exit artifact |
|---|---|---|
| SP1 | Does our hosting give cross-origin isolation? | Deployed hello-app on Cloudflare Pages with `_headers`; screenshot of `crossOriginIsolated === true`; HF fetch works under COEP (CORS verified) |
| SP2 | Can we bracket WebLLM timing reliably? | Script running SmolLM2-360M: TTFT + decode TPS via our brackets vs. runtime-reported, on lead's machine; delta documented |
| SP3 | Transformers.js embedding on webgpu **and** wasm EPs? | Same-model both-backends numbers + fallback behavior notes |
| SP4 | Is N=3 enough? | Variance study on ≥3 lab devices: rep-to-rep spread with/without warmup, with/without visibility loss; recommendation memo (feeds `04` §5) |
| SP5 | Worker+D1+Turnstile round trip? | Deployed toy ingest: schema-validated POST → D1 row → read back; measured CPU ms; quotas recorded into `docs/quotas.md` |
| SP6 | Monorepo skeleton + CI green? | pnpm workspaces per `03` §6, lint/typecheck/unit/contract jobs running, schema package with 1 real schema + golden fixture test |

## 3. Phase 1 — epics & stories

Story format (mandatory): *user-story sentence, acceptance criteria (AC) as testable bullets, estimate, dependencies.* Two stories are written out in full below as the quality bar; remaining stories are titled with estimates and must be expanded to this bar in the tracker before work starts.

**E1 — Harness core (12 id total)**
- E1-S1 Capability probe module (FR1.1–1.3) — 2 id
- E1-S2 Runner state machine: preflight→download→init→warmup→reps→teardown, per `04` §4 exactly — 3 id (dep: SP2/SP3 adapters)
- **E1-S3 Watchdog timeouts (FR2.4) — 1.5 id — WRITTEN OUT AS THE BAR:**
  *As the runner, I abort any stage that exceeds its registry-declared timeout so one hung cell never blocks a run.*
  AC: (1) init exceeding `timeout_init_ms` → cell status `timeout`, adapter `dispose()` called, next cell starts; (2) a measured rep exceeding `timeout_run_ms` → same; (3) watchdogs cancel on success (no stray timers — assert via fake timers); (4) unit-tested with a fake adapter that hangs on command; (5) timeout values come from registry, not constants; (6) a visible UI note names the timed-out cell and reason.
- E1-S4 Crash marker + recovery prompt (FR2.5) — 1 id
- E1-S5 Visibility guard + flags (FR2.6, `04` §5 flags) — 1 id
- E1-S6 Stats module: median/min/max, flag computation, `ResultDraft` assembly against schema — 1.5 id
- E1-S7 Micro-benchmarks: WGSL matmul f32/f16, mem-bw kernel, WASM workload single/multi — 2 id (highest technical risk in E1; pairs with SP4 findings)

**E2 — Adapters (6 id):** E2-S1 WebLLM adapter · E2-S2 Transformers.js adapter (embed; webgpu+wasm) · E2-S3 wllama adapter · E2-S4 adapter conformance test suite (every adapter passes the same contract tests with a tiny test model)

**E3 — Registry v1 (2 id):** entries per `04` §3 with pinned revisions, licenses verified (C4), fixtures + SHA-256, zod schema, CI validation that every `cell_id` is well-formed and unique.

**E4 — UI shell (6 id):** results card, progress, preset picker, greyed-unsupported-cells with reasons, size warnings + Stop (FR2.7, `06` §6.4), local JSON export (FR3.4), a11y pass on the flow (NFR-A1).

**E5 — Methodology page + README + launch post draft (2 id).** Gate DR-1 owner: Lead.

## 4. Phase 2 — epics & stories

**E7 — Ingest API (7 id)**
- E7-S1 Worker skeleton: Hono routes, D1 migrations from `05` §3, health endpoint — 1.5 id
- **E7-S2 Plausibility gates v1 (`06` §4.3 PG1/2/4/5) — 2 id — WRITTEN OUT AS THE BAR:**
  *As the ingest service, I classify every schema-valid submission as pass or quarantined so aggregates only ever read validated data.*
  AC: (1) gates implemented as pure functions in `packages/schema/gates.ts`, table-driven constants, 100% unit-covered including boundary values; (2) response is `201 {result_id}` for both outcomes — asserted no distinguishing header/body/timing beyond noise (write an explicit test); (3) `gate_outcome`+`gate_reasons` persisted; (4) golden fixtures: ≥10 pass / ≥10 quarantine cases committed; (5) aggregation queries filter `gate_outcome='pass'` (contract test); (6) gate constants documented inline with their `06` §4.3 IDs.
- E7-S3 Turnstile server verification + edge rate limits + payload caps + nonce dedupe — 1.5 id
- E7-S4 `/r/{id}` result page + JSON endpoint (enum-only rendering, `06` §6.1) — 1 id
- E7-S5 Kill switch + structured logging per `07` §4.4 — 1 id

**E8 — Consent & submission client (3 id):** consent screen with live JSON preview and all `06` §5.2 elements · retry queue (FR3.5) · client-side schema validation pre-send.

**E9 — Aggregation & snapshots (4 id):** cron per `04` §6 with k≥5 · immutable snapshot files + `latest.json` pointer (`05` §5) · dedupe-by-nonce-lineage · yanked-suite exclusion.

**E10 — Explorer v1 (5 id):** cell view with percentiles/CI badges, support matrix (FR4.4), filters merging cohorts upward only, "insufficient data" states, disclaimer (FR6.3), snapshot freshness stamp.

**E11 — Security hardening pass (2 id):** execute `06` §7 pre-launch checklist; record results in `docs/security-testing.md`. Launch-blocking.

**E12 — Dumps + dataset docs + restore drill (2 id):** daily dump job (`05` §6), weekly GH-release mirror, `analysis/reid_check` run (`06` §3), first restore drill (`07` §7).

## 5. Phase 3 — epics (expand after G2; estimates then)

E13 matrix expansion (Whisper per D2, Tier-2 per D3, ONNX-webgpu LLM cell) · E14 runtime-version regression view (FR4.5) · E15 aggregates read API + badge (FR5.2/5.3) · E16 community registry-contribution guide + issue templates · E17 DR-1-informed backlog.

## 6. Testing strategy

**6.1 Unit (Vitest).** Everything in `packages/*`: stats math (property-based where cheap: median invariants), runner state machine via fake adapters (hang/throw/slow/OOM-simulating), gates (boundary tables), schema round-trips.

**6.2 Harness-overhead test (NFR-P2).** Fake adapter emitting tokens on a fixed timer; assert measured TPS with full instrumentation is within 2% of the known ground truth. Runs in CI.

**6.3 Contract tests.** Golden payload fixtures validated identically by client bundle and Worker (Miniflare/`wrangler dev` in CI); snapshot-format fixtures validated against explorer parser. A schema change that breaks any fixture fails CI until fixtures + `schema_version` move together.

**6.4 E2E & the WebGPU-in-CI problem (honest plan).** Playwright: (a) all-browser smoke of UI flows + **WASM-path benchmark with a tiny test model** (a real end-to-end measurement, CPU-only, asserting completion + sane ranges); (b) Chromium+SwiftShader WebGPU job for *correctness* of the GPU code path (probe fields, shaders compile, cells complete) — **never for performance numbers**; perf assertions are excluded in CI by design. (c) What CI can't cover → **device-lab protocol:** a release checklist run manually on the lead's real matrix (target: Win/NVIDIA, macOS/Apple-Silicon, Android/Chrome, iOS/Safari) recording golden plausibility ranges per device into `docs/device-lab.md`; required before any suite MAJOR/MINOR release.
**6.5 Traceability table.** `docs/traceability.md`: every FR/NFR "M" → test id(s) or device-lab step. CI job fails if an M-requirement row is empty. G2 gate requires 100%.
**6.6 Load test.** k6 (or autocannon) against a staging Worker: 50 rps mixed valid/invalid for 5 min; assert p99 < 200 ms, zero 5xx, rate-limiter engages correctly.
**6.7 A11y.** axe-core automated checks on landing, run flow, results, consent (NFR-A1).

## 7. Ways of working

- **Branching:** trunk-based; short-lived branches → PR to `main`; deploy only from `main` (auto, post-CI).
- **PRs:** ≤ ~400 changed lines, one logical change, description links story ID + requirement IDs; template includes the `06` §7 security checklist. Review SLA 48 h (self-merge allowed for solo periods **only** with green CI + next-day self-review note — bus-factor honesty).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`); enables changelog automation.
- **Definition of Done (every story):** code + tests per §6 · docs updated (including this set if behavior changed) · traceability row updated · no console errors/warnings in smoke · a11y for UI stories · registry/ADR updated when applicable · deployed to staging and self-verified.
- **Tracker:** GitHub Projects board (Backlog → Ready → In-progress ≤ 2 items → Review → Done); issues use story format §3; weekly 30-min triage.
- **ADR discipline:** per `03` §7 — architecture/methodology/schema/security changes without an ADR are reverted on sight.
- **Onboarding a new contributor (target < 1 day):** read docs 00–04 → run `pnpm i && pnpm dev` (must work on a clean machine — CI has a clean-install job to guarantee it) → first issue labeled `good-first-issue` with a written test expectation.

## 8. Risk register (reviewed at every phase gate)

| # | Risk | L | I | Mitigation | Trigger / early signal | Owner |
|---|------|---|---|------------|------------------------|-------|
| R1 | Credibility: harness bug ships wrong public numbers | M | **H** | Methodology-as-law, overhead test, device-lab goldens, "beta" label until DR-1 + 5-device validation, suite yank runbook `07` §6.4 | `runtime_disagreement` rate > 5%; community reproduction mismatch | Lead |
| R2 | Data poisoning skews cohorts | M | H | `06` §4 layers; anomaly monitoring | Quarantine rate spike; KS-distance alerts | Lead |
| R3 | Demand doesn't materialize | M | H | DR-1 gate **before** backend spend; launch where the hand-pasted-numbers threads already are | DR-1 fails | Lead |
| R4 | Matrix/scope explosion | **H** | M | NG8 cap, registry-change-requires-ADR, phase gates | Backlog of "add model X" issues > 5 | Lead |
| R5 | WebGPU-in-CI gap lets GPU regressions ship | M | M | §6.4 split: SwiftShader correctness + mandatory device-lab per release | Device-lab finds what CI missed twice in a row → invest in better CI | Lead |
| R6 | Browser/runtime churn breaks cells | H | M | Pinned adapter versions; upgrade = ADR + suite bump; probe-driven greying means breakage degrades, not crashes | Probe failure rates jump after a browser release | Lead |
| R7 | Free-tier quota changes | L | M | `07` §2 alarms + §5 ladder; quotas re-verified quarterly | Provider announcement; 50% alarm | Lead |
| R8 | Bus factor = 1 | H | M | Everything-in-repo, runbooks, ops log, this doc set; CONTRIBUTING + good-first-issues to grow contributors | 4 weeks without commits | Lead |
| R9 | Solo estimates slip (life happens) | H | L→M | Ideal-day budgeting at 2/wk; stretch scope pre-cut (D2/D3 defaults to "defer") | Any story > 150% estimate | Lead |
| R10 | Legal surprise (model license, GDPR reading) | L | M | C4 registry license fields, permissive-only rule; `06` §5.3 external review before Phase-2 | License field can't be verified for a wanted model → don't ship it | Lead |

## 9. RACI-lite

Lead: **R/A** for gates, ADRs, releases, security, registry. Contributors: **R** for owned stories within approved design, **C** on ADRs touching their area. Community: **I** via changelog/discussions; **C** via issues on registry and roadmap.
