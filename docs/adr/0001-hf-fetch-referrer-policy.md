# 0001 — Fetch Hugging Face resources with `referrerPolicy: "no-referrer"`

Status: Accepted

Context: During SP1 (docs/08-delivery-plan.md §2) we deployed a spike page to a Cloudflare
Workers static-assets project (`*.workers.dev` domain — see note below on Pages vs Workers)
and found that fetches to `huggingface.co` (both the `/api/models/...` metadata endpoint and the
`/resolve/main/...` weight-download endpoint) fail with an opaque CloudFront 404 whenever the
request's `Referer` header is on a `*.workers.dev` domain. Confirmed by bisecting headers with
curl: no-referer → 200, `Referer: https://example.com/` → 200, `Referer: https://foo.pages.dev/`
→ 200, `Referer: https://<anything>.workers.dev/` → 404. This is HF's CDN treating `workers.dev`
as untrusted, not a bug in our app, and it would silently break every model download for any
visitor if the production site (or a contributor's preview deploy) ever ends up on a
`workers.dev` host.

Decision: Every fetch the harness (C2/C3) makes against Hugging Face Hub — metadata and weight
downloads alike — must set `referrerPolicy: "no-referrer"`. This is host-independent (works
regardless of which domain the app is deployed to) and is strictly more private than the
default, consistent with the data-minimization stance in `05-data-model-and-api.md` §1.

Consequences: Runtime adapters (`packages/harness/adapters/*`) that construct their own fetch
calls to HF (directly, or via a runtime's internal fetch — verify WebLLM/Transformers.js/wllama
expose a way to override `referrerPolicy` or accept a custom fetch implementation) must apply
this. Add a contract-test assertion once E2-S4 (adapter conformance suite) lands. Separately:
our current deploy landed on `webai-bench.hamzaeng277.workers.dev` because Cloudflare's
dashboard now creates git-connected projects as Workers-with-assets rather than classic Pages;
`*.pages.dev` was not affected by this block in testing. We are not blocked on switching hosting
for SP1 purposes since the referrer-policy fix is host-independent, but this is worth revisiting
before Phase 1 launch — a custom domain sidesteps the question entirely either way.

Alternatives considered:
- Switch hosting to classic Cloudflare Pages (`*.pages.dev`) — works today but doesn't protect
  against the same class of block from a *different* CDN blocking a *different* domain pattern
  later; the referrer-policy fix is the more durable mitigation and costs nothing.
- Proxy HF requests through our own Worker (C6) to control headers server-side — rejected for
  v1: adds a dynamic surface and bandwidth cost to what should be a static-first architecture
  (principle 1 in `03-architecture.md` §1), and HF already serves CORS-enabled responses
  directly to the browser.
