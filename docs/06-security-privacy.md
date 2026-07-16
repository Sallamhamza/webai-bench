# 06 — Security & Privacy

**Status:** Approved v1.0 · All items marked **M** are launch-blocking (NFR-S1). This document is reviewed as a whole before Phase-2 launch and every 6 months after.

---

## 1. What we protect (assets, in priority order)

1. **Dataset integrity** — the entire product is trust in the numbers.
2. **Visitor privacy** — we run code on strangers' machines and ask for telemetry; the bar is "nothing to leak."
3. **Availability** — within free-tier reality (99% target, graceful degradation).
4. **Supply chain** — we tell thousands of browsers to download and execute model weights and WASM; a compromised dependency is a worst-case event.
5. **Visitors' hardware comfort** — benchmarks heat devices and consume data; we must not harm or surprise.

**Trust boundaries:** (a) visitor browser ⇄ our CDN/API — the browser is *untrusted* as a data source, *trusted-by-necessity* as a measurement instrument (hence gates + robust stats, not naive trust); (b) our origin ⇄ Hugging Face CDN — semi-trusted, pinned by revision + integrity checks; (c) repo ⇄ deployment — protected by CI controls.

## 2. Threat model (summary table)

| ID | Threat (STRIDE) | Vector | Priority | Mitigations (→ §) |
|----|------------------|--------|----------|--------------------|
| T1 | Data poisoning (Tampering) | Scripted fake submissions; replayed/mutated real payloads; one actor flooding a cohort | **M** | §4 (entire section) |
| T2 | Privacy / fingerprinting (Info disclosure) | Our own telemetry becoming a device-fingerprint or identity database | **M** | §3, §5 |
| T3 | XSS / injection (Tampering/Elevation) | Malicious strings in payloads rendered on `/r/{id}` or explorer; SQL injection | **M** | §6.1 |
| T4 | Supply chain (Tampering) | Malicious npm dependency; swapped model weights on the Hub; compromised CI | **M** | §6.2 |
| T5 | DoS / quota-drain (DoS) | Submission floods; API scraping; forcing us over free-tier quotas | **M** | §6.3 |
| T6 | Client harm | Thermal stress, battery drain, surprise 1 GB downloads on metered data | **M** | §6.4 |
| T7 | Legal/licensing | Redistributing non-permissive weights; dataset licensing ambiguity | **M** | §6.5 |
| T8 | Result-URL misuse (Repudiation-ish) | Guessing `/r/{id}`; a result being attributable to a person | S | ids = 21-char nanoid (~121 bits); payloads contain no identity by §3, so a leaked URL exposes nothing personal |

## 3. Privacy by architecture (T2)

The strongest control is what we never collect. **Field whitelist** (see `05` §1–2) — enforced by `.strict()` schemas on client and server:

- Browser **family + major** only (no full UA string, no minor/patch).
- OS **family + coarse version** only.
- GPU **vendor + architecture** from `adapter.info` only — the spec keeps these coarse by design; we additionally **drop `description`** (can contain driver strings with high entropy).
- No: canvas/audio hashes, screen metrics, timezone, locale, fonts, battery, IP-derived geo, cookies, localStorage identifiers across sessions, third-party scripts of any kind (ADR 5.9).
- `hardware_concurrency` clamped to 32; `device_memory_gb` is the browser's own coarse bucket or null.
- **IPs:** used transiently at the edge for rate limiting (Cloudflare-native); never written to D1, R2, logs we retain, or dumps. Worker log retention set to minimum; no request-body logging.
- **k ≥ 5 display threshold** on every public aggregate, so no cohort of one device is inspectable (`04` §6).
- Re-identification review: before Phase-2 launch, run the analysis notebook `analysis/reid_check.ipynb` — verify that the full whitelist tuple does not isolate single devices at expected volumes; if the rarest tuples are unique, coarsen (drop `gpu_architecture` to vendor) until safe. This check re-runs quarterly.

## 4. Dataset integrity: anti-poisoning (T1) — defense in depth

**4.1 Layer 0 — remove the motive (design).** No user accounts, no per-user leaderboards, no "top device" rankings (NG6). Nobody gains status by submitting; the classic incentive that poisons crowdsourced benchmarks doesn't exist here.

**4.2 Layer 1 — raise the cost (edge).** Cloudflare Turnstile verified server-side on every submission (**M**; decision D4 keeps a proof-of-work fallback if Turnstile hurts opt-in). Edge rate limit 10 submissions/hour/IP, burst 3 (**M**). Payload ≤ 32 KB, ≤ 16 cells (**M**). `client_nonce` dedupe kills naive replay (**M**).

**4.3 Layer 2 — plausibility gates (Worker, deterministic, versioned in `packages/schema/gates.ts`).** All are **M** unless noted:
- **PG1 Range:** every metric within absolute physical bounds (e.g., `0 < decode_tps ≤ 2000`, `0 < ttft_ms ≤ 600000`, `0 ≤ matmul_f32_gflops ≤ 100000`); `download.mb` within registry `expected_download_mb ± 10%`; `tokens_generated == 128` for LLM cells.
- **PG2 Internal consistency:** `min ≤ median ≤ max` everywhere; implied decode duration `(127 / decode_tps_median)` consistent with rep structure; `runtime_reported_tps` within ±50% of ours (beyond → quarantine, likely tampered or adapter bug).
- **PG3 Cross-metric envelope:** `decode_tps_median ≤ α(model, quant) × micro-compute-score`, with α calibrated per cell from device-lab data + first-two-weeks organic data at the 97.5th percentile; submissions above the envelope → quarantine. (A cheat must now fake *coherent physics across metrics*, which is drastically harder.) Envelope constants are versioned; recalibration is an ADR. (S at Phase-2 launch, **M** within 4 weeks after.)
- **PG4 Volume:** > 5 submissions/day sharing the identical env tuple + nonce lineage → extras quarantined.
- **PG5 Version validity:** `suite_version` in the accepted set; `runtime_version` known to the registry; `fixture_sha256` matches.

**4.4 Layer 3 — fail-soft handling.** Only schema/size/Turnstile failures return errors. Gate failures **store as `quarantined` and return the same 201** — the attacker gets no oracle for boundary-probing, and unusual-but-real hardware is never rejected outright (avoids biasing the dataset against exotic devices). Weekly review (analysis notebook) promotes false-quarantines and reports gate hit-rates; persistent adversarial patterns → tighten constants via ADR.

**4.5 Layer 4 — robust statistics.** Aggregates are medians/percentiles over per-device values with k ≥ 5 (`04` §6): a minority of poisoned rows that survive Layers 1–3 shifts published medians negligibly. Offline anomaly review (C9) monitors cohort distribution shifts (KS distance week-over-week) and flags cohorts for manual inspection.

**4.6 Honest residual risk.** A capable, motivated attacker with many real devices/IPs submitting physically-plausible fabricated numbers can still bias small cohorts. Accepted for v1 because: motive removed (4.1), impact bounded by medians+k, all data labeled self-reported (FR6.3), and full dumps let anyone audit. Escalation path if it happens anyway: `07` §6.3 runbook.

## 5. Consent & data handling (T2 continued)

**5.1 Principles.** Benchmarking is fully local until the user explicitly opts in (FR3.2). Declining loses nothing (local card + JSON export, FR3.4).

**5.2 Consent screen — required elements (M, copy reviewed by Lead):**
1. Plain-language list of what will be sent, **plus a collapsible live preview of the exact JSON payload** — the strongest honesty signal we can give.
2. Explicit "what we never collect" list (IP retention, identity, precise device info).
3. Dataset license (CC-BY-4.0) and that submission is public and permanent.
4. **Deletion honesty:** because submissions are anonymous, we cannot later find "your" row to delete — stated before consent, not after.
5. Equal-weight Submit / Don't-submit buttons; no dark patterns; no pre-checked boxes.
6. `consent_version` recorded; changing the screen bumps it.

**5.3 GDPR posture (not legal advice — external review before Phase-2 launch, tracked in the plan):** the stored dataset is designed to contain no personal data; transient edge IP processing for abuse prevention relies on legitimate interest; a short public privacy page states controller contact, the above, and the retention rules (results indefinite by design; error beacons 90 days; D1 backups 30 days).

## 6. Platform hardening

**6.1 Injection & content security (T3, all M).**
- CSP (set in `_headers`): `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://huggingface.co https://*.hf.co <api-origin>; img-src 'self' data:; style-src 'self' 'unsafe-inline'(only if the chosen styling requires it — prefer none); frame-ancestors 'none'; base-uri 'none'` + Turnstile's documented origins. Any new origin = ADR.
- No `dangerouslySetInnerHTML`; every payload-derived string rendered on `/r/{id}` comes from **whitelisted enums** (error codes, families) — free-text fields don't exist in the schema by design (`05` §2 `error_code` enum rule).
- D1 access only via parameterized bindings; zod validation before any DB touch; API responses `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`.
- Additional headers: `Referrer-Policy: no-referrer`, `Permissions-Policy` denying sensors/camera/mic/geolocation.

**6.2 Supply chain (T4, all M).**
- pnpm lockfile committed; `pnpm install --frozen-lockfile` in CI; Renovate weekly with grouped PRs; `pnpm audit` gate (high+ fails CI).
- **Zero runtime third-party `<script src>`** — every dependency is bundled and lockfile-pinned; Turnstile's widget is the single documented exception, loaded only on the consent screen, SRI/origin-pinned per vendor docs.
- Model weights pinned by **HF revision commit hash** in the registry; downloads verified against expected hashes/sizes where exposed (FR2.9); a registry revision change is an ADR + suite MAJOR (`04` §8).
- GitHub: branch protection on `main` (PR + green CI required), Actions `permissions: read-all` default, deploy via Cloudflare API token scoped to the two projects, stored as encrypted secret; no long-lived tokens in code; signed releases for dataset dumps.

**6.3 Availability & quota abuse (T5, M).** Static reads are absorbed by the CDN; the Worker surface is tiny and rate-limited (`05` §4); `DISABLE_INGEST` env kill-switch returns `503 ingest_disabled` while the site keeps working locally (NFR-R1); R2 dumps served through CDN cache. Quota alarms and the mitigation ladder live in `07` §2/§6.

**6.4 Visitor hardware & data respect (T6, M).** Explicit size disclosure before any download, extra confirmation ≥ 300 MB (FR2.7) and a metered-connection warning when the Network Information API exposes it; total measured compute per preset capped (~5 min); a Stop button that actually aborts (adapters must implement `dispose()` mid-run); no auto-rerun loops; Tier-2 never auto-selected.

**6.5 Licensing (T7, M).** Registry entries require `license` + `license_url`; only permissive, redistribution-safe models ship (C4); the UI shows model licenses; code Apache-2.0, dataset CC-BY-4.0, docs CC-BY-4.0 (NFR-M4).

## 7. Process controls

- **PR security checklist** (in the PR template, enforced socially + by review): no new origins/headers changes without ADR · no new payload fields without ADR + §3 review · no free-text rendering of client data · deps added are justified · secrets untouched.
- **`SECURITY.md`:** private disclosure email, 90-day coordinated disclosure, acknowledgments section, no bounty (stated honestly).
- **Pre-launch security pass (Phase-2 exit gate, E11):** run through OWASP ASVS-L1 relevant items; verify CSP with an automated scanner; attempt the top-5 abuse cases ourselves (replay, oversized, schema fuzz via `zod`-aware fuzzer, rate-limit bypass via header spoofing, XSS via error_code tampering) and record results in `docs/security-testing.md`.
