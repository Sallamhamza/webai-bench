# WebAI Bench

A public website that benchmarks in-browser AI inference (WebGPU/WASM) on any visitor's device,
and aggregates opt-in results into an open, crowdsourced database answering: _"Which model +
quantization + runtime actually works for my users' hardware?"_

Full engineering documentation lives in [`docs/`](docs/) — start with [`docs/00-README.md`](docs/00-README.md).
The methodology (what's measured, how, and its known limitations) is summarized in-app under
"Methodology," and defined normatively in [`docs/04-benchmark-methodology.md`](docs/04-benchmark-methodology.md).

## Status: early prototype, not a finished product

Phase 1 (local-only MVP, no backend yet) is in progress. Concretely, right now:

- Capability probe, registry-driven cell selection, and the full run flow (progress, Stop, size
  warnings, local JSON export) are built and tested.
- All three planned runtimes — **WebLLM**, **Transformers.js**, **wllama** — have adapters that
  pass a shared conformance suite. Of those, only **WebLLM/WebGPU has been exercised end-to-end
  in a real browser** so far, with results cross-checked against the runtime's own self-reported
  stats (agreement within ~1–2%). Transformers.js and wllama are wired up but their first
  real-browser runs will happen organically as people use the site — see
  [`packages/harness/src/adapters/QUIRKS.md`](packages/harness/src/adapters/QUIRKS.md) for the
  specifics of what's proven versus still assumed.
- No backend yet: results stay on your device (local JSON export only) until Phase 2 ships the
  opt-in submission/aggregation pipeline.
- One interesting result already, from the spike phase: for a small (~22M param) embedding
  model, **WASM was ~9.6x faster than WebGPU** on the lead's device — see
  [`docs/spikes/sp3-findings.md`](docs/spikes/sp3-findings.md). Not the assumption you'd expect,
  which is part of why this project measures rather than guesses.

If something looks wrong or the methodology seems off, that's exactly the kind of feedback this
early stage is for — see [`CONTRIBUTING.md`](CONTRIBUTING.md) or open an issue.

## Development

```sh
pnpm i
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @webai-bench/web dev   # local dev server for the site
```

Must work on a clean checkout. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full process.

## License

Code: Apache-2.0 (see [`LICENSE`](LICENSE)). Docs and dataset: CC-BY-4.0.
