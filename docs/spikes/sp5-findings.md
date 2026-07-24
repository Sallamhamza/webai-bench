# SP5 — Worker + D1 + Turnstile round trip

**Status:** Passed (live deploy) · **Date:** 2026-07-24

**Question (docs/08-delivery-plan.md §2):** Deployed toy ingest: schema-validated POST → D1 row
→ read back; measured CPU ms; quotas recorded into `docs/quotas.md`.

## Method

Two-stage validation, per the project's usual "prove it locally, then prove it live" pattern:

1. **Local** (`wrangler dev`, Miniflare-simulated D1, Cloudflare's public always-pass Turnstile
   test secret in a gitignored `.dev.vars`): full round trip — schema-valid POST → real network
   call to the actual `siteverify` endpoint → D1 insert → GET read-back — plus rejection paths
   (missing token → 401, invalid schema → 400, unknown id → 404). No dashboard setup needed for
   this stage.
2. **Live**: real D1 database + real Turnstile widget created in the Cloudflare dashboard, a
   second git-connected Workers Builds project (`webai-bench-api`) deployed alongside the existing
   web app, and a throwaway browser page (`apps/web/src/Sp5ToyIngest.tsx`) rendering the actual
   Turnstile widget to get a genuine token and drive the same round trip against the live URL.

## Bugs found and fixed along the way

1. **TS project references broke CI on a fresh checkout (not a Cloudflare issue).**
   `apps/api`, `packages/harness`, and `packages/registry` all declared TS project `references`
   but ran plain `tsc --noEmit` (not `tsc -b`), which requires build-mode to have already produced
   the referenced project's declaration output. Passed locally only because stale `dist/` /
   `.tsbuildinfo` from earlier ad-hoc builds masked it. Fixed by removing the references — not
   needed anyway since `@webai-bench/schema`'s `package.json` points `"types"` straight at
   `./src/index.ts`, so plain workspace linking already resolves types correctly.
2. **Cloudflare's non-production-branch deploy command silently drops custom flags.** Same class
   of issue as SP1: the production branch's deploy command (`npx wrangler deploy -c
   apps/api/wrangler.toml`) is a *separate* dashboard setting from the one used for PR-branch
   preview builds, which defaults back to plain `npx wrangler deploy` and fails immediately
   (`The Cloudflare application detection logic has been run in the root of a workspace...`).
   Attempted to fix the preview setting; a retry still showed the old command (likely because a
   *retry* reuses the queued build's cached config rather than re-reading current settings).
   **Decision: left as-is.** This only affects PR-branch preview deploys, which this project
   doesn't rely on; GitHub Actions `build` is the real gate and was unaffected throughout.
3. **CORS: the web app and API are different origins, and Hono sends no CORS headers by
   default.** The live widget page's POST (JSON body + custom `cf-turnstile-response` header)
   requires a preflight `OPTIONS`, which the Worker wasn't handling — browsers report this as a
   generic `Failed to fetch` with no actionable detail. Fixed with Hono's built-in `cors()`
   middleware, explicitly allowlisting the deployed web origin + `localhost:5173` (not `"*"`,
   since the real E7 ingest API will need the same treatment and credentials may matter later).
   Verified via curl preflight simulation against `wrangler dev` before deploying.
4. **Remote D1 database had no schema.** `wrangler d1 migrations apply ... --local` only creates
   the table in the local Miniflare simulation; the actual cloud D1 database needs the same
   migration applied separately. This wasn't done via `wrangler d1 migrations apply --remote`
   (would need an authenticated wrangler CLI session, not available in this environment) — instead
   applied by hand via the D1 dashboard's Console tab, pasting the `CREATE TABLE` statement from
   `apps/api/migrations/0001_toy_results.sql` directly. **This is a process gap**: the migration
   file and what's actually running in the cloud database are not verifiably in sync — fine for a
   throwaway toy table, but the real E7 ingest API must apply migrations via `wrangler d1
   migrations apply --remote` (or an equivalent CI step) so the migration files in the repo are
   the actual source of truth, not a manually-run copy-paste.

## Result: live round trip + CPU time

Full round trip confirmed working end-to-end against
`https://webai-bench-api.hamzaeng277.workers.dev`: real Turnstile widget token → cross-origin
CORS-cleared POST → `siteverify` → schema validation → D1 insert → GET read-back, rendering the
stored payload back in the browser.

CPU time (from Cloudflare's live invocation logs, Workers → Observability → Logs), recorded in
full in `docs/quotas.md`:

| request | cpuTimeMs | wallTimeMs |
|---|---|---|
| OPTIONS preflight | 3 | 4 |
| POST (Turnstile verify + schema validate + D1 insert) | 8 | 1254 |
| GET (D1 read) | 1 | 16 |

All three comfortably under the free plan's 10ms-per-invocation CPU cap. The POST's wall time
(1254 ms) is dominated by the Turnstile network round-trip — I/O wait doesn't count as CPU time,
so this is a latency characteristic, not a quota concern. This validates the C6 architecture
choice (`03-architecture.md` §3): a Worker doing schema validation + a D1 write is cheap enough
that Turnstile verification latency, not compute cost, will be the dominant per-request cost once
the real ingest API (E7) exists.

## Follow-ups for Phase 2 (E7)

- Fix remote migrations to run via `wrangler d1 migrations apply --remote` in CI/CD
  (`.github/workflows`), not a manual dashboard paste.
- Revisit the Cloudflare non-production-branch deploy command if PR-branch previews ever become
  valuable enough to fix properly (not blocking today).
- Requests/day and D1 storage/rows quotas are still unverified against real numbers — this spike
  only ever had one request in flight. The load test in `08-delivery-plan.md` §6.6 (k6/autocannon,
  50 rps for 5 min) is the right time to actually hit those ceilings.
- The toy `toy_results` table and `/api/v1/results/toy*` routes should be deleted once the real
  `results`/`result_cells` schema (`05-data-model-and-api.md` §3) and ingest routes (E7-S1) land.

## Exit artifact

Live deployment at `https://webai-bench-api.hamzaeng277.workers.dev`, this document, `docs/quotas.md`,
`apps/api/src/index.ts`, `apps/web/src/Sp5ToyIngest.tsx`.
