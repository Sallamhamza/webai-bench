# 07 — Scalability & Operations

**Status:** Approved v1.0 · Constraint C1 ($0/month) is hard for v1. Every quota figure below marked *(verify)* must be re-checked against the provider's current published limits during Phase 0 (SP5) and recorded in `docs/quotas.md` — free tiers change, our design margins must be computed against reality, not memory.

---

## 1. Load model (design point)

Assumptions we design against (not predictions):

| Scenario | Visits/day | Run-completion rate | Opt-in rate | Submissions/day | Notes |
|---|---|---|---|---|---|
| Steady state | 500 | 30% | 50% | ~75 | Post-launch baseline |
| Launch/HN spike | 50,000 (2 days) | 20% | 50% | ~5,000/day | The event we must survive without paging anyone |
| Success case (month 6) | 3,000 | 30% | 50% | ~450 | KPI-level traction |

Payload ≤ 32 KB; realistic median ~6 KB → 5,000 subs/day ≈ 30 MB/day ingest, trivial. **The heavy bytes (model weights, 100 MB–1 GB per visitor) never touch our infrastructure — they flow Hugging Face CDN → visitor.** That asymmetry is the whole cost design.

## 2. Free-tier budget & alarms

| Resource | Free quota *(verify)* | Our spike-day usage | Margin | Alarm threshold (monthly review + automated where possible) |
|---|---|---|---|---|
| Cloudflare Pages | Unlimited static requests; 500 builds/mo | ~50k visits static | Huge | builds > 250/mo |
| Worker requests | ~100k/day | subs 5k + result-views + health ≈ ≤ 20k/day (explorer reads bypass Worker via R2/CDN, §3) | ≥ 5× | > 50k/day |
| Worker CPU time | ~10 ms/invocation class *(verify exact current model)* | validation+gates ≈ 1–3 ms | ok | p95 > 60% of limit (measure in SP5) |
| D1 storage | ~5 GB | 5k rows/day × ~8 KB ≈ 40 MB/day spike; steady ~0.6 MB/day | Years | > 2.5 GB total |
| D1 reads/writes per day | generous *(verify)* | writes = subs; reads = cron only | ok | > 50% |
| R2 storage | 10 GB | snapshots KBs + dumps MBs/day | Years | > 5 GB |
| R2 operations/egress | Class A/B quotas; zero egress fees | snapshot fetch per explorer visit (CDN-cached) | ok | > 50% Class B |
| Turnstile | Free | 1/submission | ok | — |
| GitHub Actions | 2,000 min/mo free | CI ~15 min/PR + crons | ok | > 1,200 min/mo |

Rule: any resource crossing 50% of quota in the monthly ops review triggers the mitigation ladder (§5) *before* it becomes urgent.

## 3. Why reads scale to "front page of the internet" at $0

The explorer never queries the database. Cron precomputes aggregate JSON to R2 with **immutable content-hashed filenames**; clients fetch a tiny `latest.json` pointer (short TTL) then the immutable file (`Cache-Control: public, max-age=31536000, immutable`), so the CDN serves virtually all read traffic from cache. 1 visitor or 1 million visitors → same origin load (≈ cron only). This is the load-bearing architectural decision (ADR 5.2 + `05` §5); do not "optimize" it into live queries.

Write path under spike: 5,000 subs/day ≈ 0.06 rps average, tens of rps worst-burst — orders of magnitude inside Worker/D1 comfort. The rate limiter (10/h/IP) caps adversarial bursts independently of organic load.

## 4. Observability (bus-factor-1 grade: automated, low-noise)

**4.1 Uptime & correctness probes.** GitHub Action every 15 min: `GET /api/v1/health` (checks D1 reachable + snapshot age < 3 h) and one synthetic fetch of `latest.json` + its target. Two consecutive failures → auto-open a GitHub issue labeled `incident` + email notification. (No third-party pager; free and sufficient.)

**4.2 Client error telemetry (privacy-safe).** The app beacons **sampled (10%)** structured errors to `POST /api/v1/errors`: `{area, error_code, browser_family, suite_version}` only (`05` §3 `errors` table) — no stack traces (may contain URLs/paths), no env tuple. Retention 90 days. Weekly review in the DQ notebook. This is how we distinguish "device can't run it" (product data) from "our harness broke" (defect) — KPI: harness-caused error rate < 2%.

**4.3 Data-quality dashboard (C9 notebook, weekly, Phase-2 exit requirement).** Panels: submissions/day; quarantine rate + per-gate hit breakdown (PG1–PG5); cohort coverage vs. k-threshold; `runtime_disagreement` and `thermal_variance` rates; week-over-week cohort KS-distance anomalies (poisoning smoke detector, `06` §4.5); snapshot build duration.

**4.4 Structured logging.** Worker logs: request id, route, outcome code, gate reasons, duration — **never** payload bodies or IPs. Console retention default/minimal.

## 5. Growth path (pre-agreed ladder — execute in order, each step is an ADR)

1. **L1 — Shard snapshots** by view/model family if any file nears 500 KB (NFR-P3) or cron nears CPU limits.
2. **L2 — Move aggregation off-Worker:** nightly GitHub-Actions Python job (DuckDB over the daily dump) writes the same snapshot schema to R2; cron Worker shrinks to pointer-flipping. Removes Worker CPU ceilings entirely at $0.
3. **L3 — Read API growth:** if `GET /api/v1/aggregates` traffic grows, serve it as pure R2+CDN artifacts (per-cell JSON files) — same trick as the explorer.
4. **L4 — Database migration:** if D1 limits genuinely bind (storage or write quotas at ~100× current design point): stand up Postgres (Supabase free, or the Oracle always-free ARM VM as self-hosted fallback), replay from the append-only Parquet dumps (**the dumps are the canonical recovery source — this is deliberate**), dual-write for one week, flip reads, retire D1. Runbook stub: `docs/runbooks/db-migration.md` (write during L4 planning, not before).
5. **L5 — Money.** Only after L1–L4: Workers Paid ($5/mo) buys 10× headroom on everything. Requires Lead sign-off against C1.

## 6. Runbooks (the three incidents we expect)

**6.1 Ingest outage (probe failing).** Site keeps working (NFR-R1: local results + client-side retry queue). Steps: check Cloudflare status page → check last deploy (`wrangler deployments`) → rollback (`wrangler rollback` / redeploy previous tag) → if D1 is the fault, flip `DISABLE_INGEST=true` (clients queue, honest banner shows) → verify probe green → post-mortem issue within 48 h (blameless, template in repo).

**6.2 Kill switch.** `DISABLE_INGEST=true` env on the Worker → all submissions get `503 ingest_disabled`; clients queue locally and the UI states it plainly. Use for: poisoning waves, quota emergencies, bad deploys.

**6.3 Poisoning wave detected (via 4.3 anomalies or community report).** (1) Kill switch if active flood. (2) Snapshot the evidence: export affected window to R2 `forensics/`. (3) Quarantine retroactively: mark affected rows `gate_outcome='quarantined'`, `gate_reasons+=['retro-YYYYMMDD-<issue#>']` via a reviewed SQL migration — **never DELETE** (dumps are append-only history; corrected dumps ship a README note per `05` §6). (4) Rebuild snapshots from validated set. (5) Tighten the relevant gate constants via ADR. (6) Public postmortem note on the methodology changelog — transparency is the product.

**6.4 Bad suite release (wrong numbers shipped).** Mark suite version yanked in `meta` (`04` §8) → aggregates exclude it on next cron → banner on explorer → changelog entry. Results are retained and flagged, never deleted.

## 7. Backups & disaster recovery

- **Nightly:** D1 export (`wrangler d1 export`) via scheduled Action → R2 `backups/` (30-day retention). **Weekly:** the Parquet dump doubles as the canonical logical backup, mirrored to GitHub release assets — two providers, zero cost.
- **Restore drill (do once in Phase 2, then quarterly, 30 min):** create scratch D1 → import latest export → run `analysis/row_count_check` against production counts → document timing in the runbook. **RPO ≤ 24 h, RTO ≤ 4 h (manual).**
- Config/infra is all in-repo (wrangler.toml, `_headers`, migrations, Actions) — a total platform loss is recoverable by `git clone` + secrets re-entry + restore. Secrets inventory (names only, values in CF/GH secret stores): `CF_API_TOKEN`, `TURNSTILE_SECRET`.

## 8. Ops cadence

Monthly 30-minute ops review (calendar reminder, checklist in `docs/runbooks/monthly-review.md`): quota table vs. alarms (§2) · probe incident count · DQ dashboard skim · Renovate PR merge · backup existence spot-check · restore-drill quarterly tick. Output: one short journal entry in `docs/ops-log.md` — this log is also the evidence trail that makes the project credible to future contributors and employers.
