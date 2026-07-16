# 01 — Project Charter

**Status:** Approved v1.0 · **Owner:** Project Lead · **Review cadence:** end of each phase

---

## 1. Problem statement

Developers shipping local-AI features (chat, embeddings, transcription running in the user's browser) cannot answer the question that determines whether their product works: *"Will this model, at this quantization, on this runtime, run acceptably on my users' actual devices?"*

They cannot answer it because:
1. The browser deliberately hides the inputs an estimate would need — WebGPU exposes no query for available GPU memory (anti-fingerprinting), so even basic "does it fit?" sizing is impossible from spec sheets.
2. Real-world variance is extreme and non-obvious: the same model runs at 40+ tok/s on one laptop and 3 tok/s on another; some devices fail silently (the tab is killed with no error event).
3. The compatibility matrix (model × quant × runtime × backend × browser × OS × GPU) has hundreds of cells; an individual developer can test three of them.
4. Today's state of the art is people hand-pasting tok/s numbers into GitHub discussion threads.

Precedent proves the demand pattern: caniuse.com, gpuinfo.org, and webgpureport.org all exist because "just test it yourself" doesn't scale across a population of devices. No equivalent exists for browser AI inference.

## 2. Vision

Become the **caniuse.com of on-device browser AI**: the neutral, open, community-fed reference that any developer checks before choosing a model and runtime, and that runtime maintainers check to see performance regressions across real hardware.

## 3. Product goals (v1, first 6 months)

- **G1 — Measure:** A visitor can benchmark their device across a curated model/runtime/backend matrix in ≤ 2 minutes of active time (excluding model download), with zero installs and zero sign-up.
- **G2 — Aggregate:** Opt-in results flow into an open database; the site answers population-level questions: "SmolLM2-1.7B q4f16 on WebLLM: runs successfully for X% of visitors; median 14 tok/s; p10 = 3 tok/s; fails on iOS Safari < 17.4."
- **G3 — Decide:** A developer-facing explorer turns the data into decisions: coverage-vs-quality frontiers, support matrices, minimum-viable-model recommendations per audience profile.
- **G4 — Openness:** Methodology, code, and dataset are fully open (code Apache-2.0; dataset CC-BY-4.0), so results are auditable and the project is fork-proof-trustworthy.

## 4. Non-goals (v1 — explicitly out of scope)

Write these on the wall. Scope creep is this project's #1 risk.

- **NG1:** Native/desktop benchmarking (Ollama, llama.cpp CLI). Browser only.
- **NG2:** Server-side or API-model comparisons (OpenAI/Anthropic latency, etc.).
- **NG3:** Model *quality* evaluation (accuracy, MMLU scores). We measure *performance and compatibility only*; we link out to quality leaderboards.
- **NG4:** Training or fine-tuning benchmarks.
- **NG5:** Energy/battery measurement (no reliable browser API; revisit post-v1).
- **NG6:** User accounts, profiles, or per-user leaderboards (also a deliberate anti-poisoning choice — see `06-security-privacy.md` §4.1).
- **NG7:** Mobile native apps. The mobile *web* experience is in scope.
- **NG8:** Supporting every model on Hugging Face. v1 ships a curated registry of ≤ 8 model configurations (see `04-benchmark-methodology.md` §3).

## 5. Users and personas

- **P1 — Product-shipping developer (primary).** Builds a local-AI feature for a real audience. Needs: population distributions, support matrices, "what's the largest model that covers 90% of my users?" Success = they cite our numbers in a design decision.
- **P2 — Curious visitor / enthusiast (data supply).** Wants "how fast is my machine?" and a shareable score card. This persona generates the dataset. Success = they complete a run and opt in to submit.
- **P3 — Runtime & model maintainers (WebLLM, Transformers.js, ONNX Runtime Web teams).** Need cross-device regression signals per release. Success = a maintainer references our data in an issue or release note.
- **P4 — Researchers/students.** Consume the open dataset dumps for papers on heterogeneous edge inference.

## 6. Success metrics (KPIs)

Measured 90 days after public Phase-2 launch:

| KPI | Target | Why this number |
|---|---|---|
| Unique devices with ≥1 completed run | ≥ 1,000 | Minimum for statistically useful cohorts on the top matrix cells |
| Opt-in submission rate among completed runs | ≥ 50% | Validates the consent UX isn't a wall |
| Cohorts meeting k≥5 display threshold | ≥ 40 | Proves the explorer shows real answers, not "insufficient data" |
| Harness-caused error rate (errors NOT attributable to device limits) | < 2% | Credibility of the instrument itself |
| External citations (blog posts, GitHub issues/discussions linking us) | ≥ 3 | Signal that P1/P3 personas actually use it |
| Dataset dump downloads | ≥ 50 | P4 validation |
| Infrastructure cost | $0 | Hard constraint |

Leading indicator during Phase 1 (pre-backend): qualitative — post the local-only MVP in WebLLM/Transformers.js GitHub Discussions; success gate = maintainers or ≥10 community members run it and share results. **If this gate fails, we stop and re-evaluate before building the backend.** (De-risking checkpoint DR-1.)

## 7. Constraints

- **C1:** $0/month infrastructure at v1 traffic (see `07-scalability-operations.md` for the specific free tiers and their verified quotas).
- **C2:** Solo-lead capacity ≈ 15–20 h/week; design must survive a bus factor of 1 (docs, automation, no snowflake servers).
- **C3:** Timeline: Phase 1 public within 6 weeks of start; Phase 2 within 10 weeks. Total v1 horizon ≤ 4 months, stretch scope to 6.
- **C4:** All shipped models must be permissively licensed and legally redistributable via Hugging Face (Apache-2.0/MIT preferred). Verify per model at implementation time.
- **C5:** GDPR-compatible by design: no personal data stored, ever. (See `06-security-privacy.md` §5. Not legal advice; re-review before Phase 2 launch.)

## 8. Top risks (summary — full register in `08-delivery-plan.md` §8)

1. **Credibility risk:** a harness bug publishes wrong numbers → trust is unrecoverable. Mitigation: methodology doc, suite versioning, "beta" labeling until validated on ≥5 known devices, reproducibility instructions.
2. **Data poisoning:** fabricated submissions skew aggregates. Mitigation: no user leaderboards, plausibility gates, robust (median/trimmed) statistics, k-thresholds, quarantine pipeline.
3. **Matrix explosion:** every added model/runtime multiplies maintenance. Mitigation: NG8, capped registry, registry additions require ADR.
4. **CI can't run WebGPU:** GPU paths untestable in headless CI. Mitigation: software-rasterizer CI where possible + documented manual device-lab protocol (see `08-delivery-plan.md` §6.4).
5. **Demand risk:** developers don't actually come. Mitigation: DR-1 gate above before backend investment.

## 9. Stakeholders & decision rights

- **Project Lead:** final call on scope, architecture, registry contents, releases.
- **Contributors:** own stories end-to-end within the approved design; propose changes via ADR PRs.
- **Community (post-launch):** issues/discussions inform the registry and roadmap; no direct commit rights initially.
