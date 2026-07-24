# Cloudflare free-tier quotas — verified figures

Populated as each spike/story actually measures something, per `08-delivery-plan.md` SP5 ("quotas
recorded into docs/quotas.md"). Only entries with a real measurement behind them belong here —
don't pre-fill from marketing pages; verify at the point something actually depends on the number.

## Workers (SP5, 2026-07-24)

Measured via live invocation logs (`webai-bench-api`, Logs → Observability), toy ingest endpoint
under `apps/api` (docs/spikes/sp5-findings.md):

| request | cpuTimeMs | wallTimeMs |
|---|---|---|
| OPTIONS preflight | 3 | 4 |
| POST `/api/v1/results/toy` (Turnstile verify + schema validate + D1 insert) | 8 | 1254 |
| GET `/api/v1/results/toy/:id` (D1 read) | 1 | 16 |

**Free plan CPU-time cap is 10ms per invocation.** Every request type above is comfortably under
it (worst case 8ms on the POST). Wall time on the POST is dominated by the Turnstile `siteverify`
network round-trip (I/O wait, not billed as CPU) — this is the mechanism, not a concern: Workers
bill CPU time, not wall time, so a slow subrequest doesn't cost quota, only latency.

**Not yet measured, revisit before Phase 2 (E7) real launch:**
- Requests/day free-tier ceiling (currently published as 100,000/day — unverified here, single
  manual test only, not a load test; see `08-delivery-plan.md` §6.6 for the real load test plan)
- D1 free-tier storage/rows-read/rows-written ceilings — same, unverified here
- Behavior once concurrent request volume is nonzero (this spike only ever had 1 in flight)

## Turnstile

Not measured for quota (Turnstile's free tier is effectively unlimited for this project's
traffic scale) — noted here only as a placeholder in case that changes.
