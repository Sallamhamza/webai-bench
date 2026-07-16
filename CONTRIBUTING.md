# Contributing

WebAI Bench follows the process defined in `docs/08-delivery-plan.md`. Read `docs/00-README.md`
through `docs/04-benchmark-methodology.md` before your first PR.

## Quick start

```sh
pnpm i
pnpm lint
pnpm typecheck
pnpm test
```

Must work on a clean checkout — CI runs a clean-install job to guarantee it.

## Ground rules

- Trunk-based: short-lived branches → PR to `main`. Deploy only from `main`.
- PRs ≤ ~400 changed lines, one logical change, description links story ID + requirement IDs.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Changes to methodology, schemas, registry contents, hosting/backend choices, or security
  controls require an ADR — see `docs/03-architecture.md` §7 and `docs/adr/`.
- Definition of Done for every story: `docs/08-delivery-plan.md` §7.

First issue: look for `good-first-issue` on the tracker.
