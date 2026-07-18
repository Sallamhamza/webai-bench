# SP1 — Hosting cross-origin isolation spike

**Status:** Passed · **Date:** 2026-07-18

**Question (docs/08-delivery-plan.md §2):** Does our hosting give cross-origin isolation?

## Result

Deployed `apps/web` (Vite hello-page) to Cloudflare via git-connected build, deploy command
`npx wrangler deploy -c apps/web/wrangler.toml` (static assets, see `apps/web/wrangler.toml`).
Live at `https://webai-bench.hamzaeng277.workers.dev`.

- `self.crossOriginIsolated === true` confirmed in-browser — `_headers` (`Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Embedder-Policy: require-corp`) is correctly applied by Cloudflare on every asset,
  including the same-origin JS bundle.
- Hugging Face Hub CDN fetch under COEP: **initially failed** with a bare 404 in-browser despite
  succeeding via curl. Root-caused to HF's CDN blocking any request with a `Referer` on
  `*.workers.dev` (not an extension or COEP issue — confirmed by curl header bisection: see
  `docs/adr/0001-hf-fetch-referrer-policy.md`). Fixed by fetching with
  `referrerPolicy: "no-referrer"`; confirmed working in-browser afterward (`HTTP 200, CORS fetch succeeded`).

## Deviation from the architecture doc

`03-architecture.md` §5.1 specifies "Cloudflare Pages." Cloudflare's current dashboard creates
git-connected projects as **Workers with static assets** by default (Pages and Workers have been
merged in the UI); we deployed on that path instead, landing on a `*.workers.dev` domain rather
than `*.pages.dev`. Functionally equivalent for our needs (headers, static hosting, $0 tier), and
`_headers` support carries over identically. Worth a follow-up ADR before Phase 1 launch to
decide: stay on Workers-assets, move to classic Pages, or go straight to a custom domain — but
not launch-blocking, since the referrer-policy fix (ADR 0001) is host-independent anyway.

## Exit artifact

- Screenshot: user-confirmed in-browser, `crossOriginIsolated: true` and HF fetch `ok`.
- This document + `docs/adr/0001-hf-fetch-referrer-policy.md`.
