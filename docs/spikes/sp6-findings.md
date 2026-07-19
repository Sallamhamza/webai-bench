# SP6 — Monorepo skeleton + CI green

**Status:** Passed · **Date:** 2026-07-19

**Question (docs/08-delivery-plan.md §2):** Monorepo skeleton + CI green?

## Result

- pnpm workspaces per `03-architecture.md` §6: `apps/{web,api}`, `packages/{harness,registry,schema,analysis}`,
  correct dependency direction enforced by hand (lint rule for this is still a TODO — see Follow-ups).
- `packages/schema` has one real schema (`SubmissionPayloadSchema`, docs/05 §2) plus a golden
  fixture test (the documented example payload) and 7 boundary/rejection tests (unknown fields,
  cell-count limit at `MAX_CELLS`, enum whitelist, consent literal, payload size at
  `MAX_PAYLOAD_BYTES`, wrong-typed field) — 9 tests total, via vitest.
- CI (`.github/workflows/ci.yml`, job `build`): install (frozen lockfile) → lint → typecheck →
  test, triggered on `pull_request`. Confirmed **green on GitHub Actions** for PR #1
  (`sp6/schema-and-ci` → `main`), not just passing locally.

## Process finding: branch + PR workflow adopted mid-Phase-0

Commits up through SP2 were pushed directly to `main`, deviating from `08-delivery-plan.md` §7
("trunk-based; short-lived branches → PR to main"). Fixed starting with SP6: short-lived branch →
PR → GitHub Actions runs on the PR → self-merge once green. Not retroactively rewriting the
earlier direct-push history (low-value churn on throwaway spike commits); applies going forward,
especially once Phase 1 real stories (E1 etc.) start and the Definition of Done in `08` §7 matters.

## Non-blocking finding: Cloudflare preview-branch deploys need separate config

Opening PR #1 also triggered a Cloudflare Workers Builds check for the branch, which failed:
`The Cloudflare application detection logic has been run in the root of a workspace instead of
targeting a specific project.` Root cause: the deploy command we set for the **production**
branch (`npx wrangler deploy -c apps/web/wrangler.toml`, from SP1) is a separate setting from the
deploy command used for **non-production branches**, which still defaults to plain
`npx wrangler deploy` with no `-c` flag — it can't resolve which app to deploy from the monorepo
root. Not fixed (not required for SP6's exit gate; GitHub Actions is the CI that matters here).
Fix when PR preview deploys are wanted: Cloudflare dashboard → webai-bench → Settings → Build →
non-production branch deploy command → `npx wrangler versions upload -c apps/web/wrangler.toml`.

## Follow-ups (not blocking, tracked for later)

- `03-architecture.md` §6's dependency-direction rule ("apps/\* may import packages/\*;
  packages/harness may import only registry and schema...") is not yet lint-enforced. Fine at
  today's size (4 packages, no violations); add an eslint import-boundary rule once
  `packages/harness` actually starts importing from `registry`/`schema` in Phase 1 (E1).
- `packages/registry` and `packages/harness` still have no real tests (`echo "no tests yet"`) —
  expected; they have no logic yet. Will get real tests alongside E1/E3 stories.
- `error_code` in the cell schema is `z.string().nullable()` rather than a fixed enum; `05 §2`
  says it should come from `packages/schema/errors.ts` ("NEVER free text"), which doesn't exist
  yet. Tracked, not guessed at in SP6 to avoid inventing an error-code list not yet decided.

## Exit artifact

PR #1 (merged), `packages/schema/src/submission.ts` + `submission.test.ts` +
`fixtures/valid-payload.json`, green GitHub Actions run on the PR.
