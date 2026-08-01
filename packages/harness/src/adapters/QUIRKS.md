# Adapter quirks log

Operational surprises discovered while building/running each adapter — not architecture
decisions (those go in `docs/adr/`), just "this library does something unexpected, here's what
and how we handled it." Add an entry whenever something costs you more than a few minutes to
figure out; future-you (and whoever investigates a `runtime_disagreement` flag) will want it.

Format per entry: **Library — what happened — how we handled it — date.**

## WebLLM (`@mlc-ai/web-llm`) — 2026-07-30

- **No separate download step.** `CreateMLCEngine()` fetches weights _and_ sets up the engine as
  one continuous async call — there's no API seam to pause between "downloaded" and
  "initialized." Our adapter has no `download()` method; everything lives in `init()`, and
  `download`/`cache_hit` are unmeasured (`null`/`true`) for WebLLM cells. Considered parsing
  `initProgressCallback`'s free-text progress messages to recover byte counts and a phase
  boundary — rejected as too fragile/version-coupled for what it'd buy.
- **Shader/pipeline compile cost shows up on the first `generate()` call, not during
  `CreateMLCEngine()`.** Confirmed empirically in SP2 (~1.4% bracket agreement) and SP4 (first
  rep's TTFT was ~11× every subsequent rep's). This means `init_ms` for WebLLM cells understates
  the "true" one-time setup cost the normative doc's step 5 parenthetical assumes is "already
  captured in init_ms" — in practice it's captured in the (discarded) warmup rep instead. The
  _outcome_ is still methodologically sound (warmup absorbs it either way), just worth knowing
  if init_ms ever looks suspiciously fast next to a slow warmup.
- **Abort-on-dispose relies on `interruptGenerate()`, not `unload()` alone** — `unload()` is
  undocumented on whether it cancels an in-flight `chat.completions.create()` stream, so
  `dispose()` calls `interruptGenerate()` first. **Unverified against the real library/GPU in
  this session** (no browser/WebGPU available here) — only checked against a mocked engine that
  we scripted to behave correctly. Needs confirmation via the device-lab/Playwright test
  boundary (`adapters/README.md`) before relying on it for the real Stop button
  (`06-security-privacy.md` §6.4).

## Transformers.js (`@huggingface/transformers`) — 2026-07-30

- **WASM beats WebGPU for small models — expect this, don't "fix" it.** SP3 measured WASM
  ~9.6× faster than WebGPU for a MiniLM-class embedding model on the lead's device (33.6s vs.
  9.5s init; 1.76s vs. 183ms embed). WebGPU's fixed per-call overhead (shader compile, kernel
  dispatch, host↔device transfer) doesn't get amortized at this model size. The adapter treats
  `device` as plain config with no special-casing either backend as "the fast one" — that
  population-level question (which backend actually wins per device/model) is what the whole
  project exists to answer, so don't bake an assumption into the adapter that the benchmark is
  supposed to be testing.
- **No abort for an in-flight call — this is a real gap, not yet solved.** Unlike WebLLM's
  `interruptGenerate()`, Transformers.js exposes no way to cancel a `extractor()` call already
  running a synchronous WASM/WebGPU compute. `dispose()` only frees the underlying ONNX Runtime
  session; it does not reject whatever call is currently in flight. Confirmed by a test that
  _expects_ `checkMidRunDisposeAborts` (E2-S4) to fail for this adapter, rather than papering
  over it — `adapters/transformersjs.test.ts`, "mid-run dispose: a REAL, documented limitation."
  **Consequence: the Stop button (06-security-privacy.md §6.4) will not promptly interrupt a
  Transformers.js embedding cell today.** Candidate fix for later: run the pipeline inside a Web
  Worker and `terminate()` it on dispose (a worker termination _is_ abortable from outside,
  unlike an in-flight WASM call on the main thread) — but that's real scope, not something to
  bolt on quietly here.

## E4 vertical-slice gate — real browser, real WebLLM — 2026-08-01

First real-browser run of any adapter in this project (everything above was validated against
mocked SDKs only — see `adapters/README.md`'s test boundary). Ran `smollm2-360m` then
`smollm2-1.7b` (both WebLLM/WebGPU) back-to-back via `runSuite()`, N=1, from a throwaway page
(`apps/web/src/VerticalSlice.tsx`, deleted once E4-S3 lands) — purpose was specifically to catch
what mocks structurally can't: real dispose/memory behavior, real error shapes, real TTFT timing.

- **Found and fixed a real `suiteRunner.ts` bug: per-cell registry timeouts weren't threaded
  through.** `SuiteCellSpec` only carried `minRequirements`, so `runSuite()` applied one
  suite-wide `timeoutInitMs`/`timeoutRunMs` (or `runCell`'s 120s/90s defaults) to _every_ cell,
  ignoring the registry's own per-cell `timeout_init_ms`/`timeout_run_ms` (FR2.4: "configurable
  per registry entry"). Concretely: the 1.7B cell's real ~1GB download was cut off at 120s even
  though the registry declares 180s for that cell — surfaced as `status: "timeout"` in the slice
  output. **Fixed:** `SuiteCellSpec` now accepts optional `timeoutInitMs`/`timeoutRunMs`
  overrides that `runSuite()` merges per-cell before calling `runCell()`, falling back to the
  suite-wide options (test: `suiteRunner.test.ts`, "uses a cell's own timeoutInitMs..."). This is
  exactly the class of bug the vertical-slice gate exists to catch before E4 builds a full run
  flow on top of it — a mock-only conformance suite has no way to notice a _suite-level_
  wiring gap like this, since it only ever exercises one cell's options object directly.
- **First real TTFT/decode numbers, one data point:** `smollm2-360m` on the test device measured
  `ttftMs: 4222.5`, `decodeTps: ~11.06` (device's own reported TPS agreed: `~11.19`, ~0.9%
  agreement — consistent with SP2's ~1.4% finding, now confirmed against this adapter itself, not
  just the spike). TTFT looks high for a "time to first token" in isolation, but the prompt is a
  multi-hundred-token passage (04 §2's fixture) and prefill time scales with prompt length, so
  this is plausibly just prefill-bound on this device rather than a bracket-placement bug —
  flagged here as a data point, not (yet) a confirmed problem.
- **FR2.6 (visibility guard) confirmed working against a real browser tab-switch, unplanned.**
  The first cell came back `status: "visibility-interrupted"` with its sample data still
  populated (the tab lost focus mid-run, almost certainly from switching to devtools/the
  console) — exactly the documented contract ("still runs to completion... reported as
  visibility-interrupted instead of success", `runner.ts` step 7). Nice confirmation this holds
  up outside the mocked `visibilityGuard.test.ts` world, not something that needed fixing.
- **Re-run after the timeout fix: `dispose()` releasing GPU memory across sequential cells is now
  evidenced, not just assumed.** With the fix in place, `smollm2-1.7b` initialized in ~28.9s
  (well inside its 180s budget — confirms the fix, and shows the old 120s ceiling was never close
  to enough) and **ran to `status: "success"` immediately after `smollm2-360m`'s `dispose()`**, no
  crash, no OOM. This was the single highest-risk item on the list (a silent leak would present
  as "this model doesn't run here" in published data, indistinguishable from a real device
  limitation) — one clean sequential run doesn't prove _zero_ leak over arbitrarily many cells,
  but it rules out the catastrophic case and is enough evidence to stop treating this as a
  blocker before E4. TTFT/decode agreement held at the larger size too: `ttftMs: 10840.6`,
  `decodeTps: ~2.97` vs. runtime-reported `~3.00` (~1% agreement, consistent with the 360M cell's
  ~0.9-1.8% across both runs) — the timing bracket generalizes across model sizes, not just the
  one SP2 originally validated against.
- **Still genuinely open** (neither slice run exercised these — no real error was thrown, and
  Stop was never clicked mid-generation): real thrown-error → `CellRunResult.status`/`reason`
  mapping, and whether `interruptGenerate()` promptly aborts a real in-flight generation (Stop
  button, `06-security-privacy.md` §6.4). Lower severity than the memory question per the
  original risk ranking, and naturally exercised once E4-S3 wires a real Stop button and users
  start hitting real download/init failures — no need for a third throwaway-slice iteration
  just for these two.

## wllama (`@wllama/wllama`) — 2026-07-30

- **`package.json` has no `types`/`exports` field and ships a raw, unbuilt `index.ts` at the
  package root** (`export * from './src'`, no compiled sibling). Under `moduleResolution:
"Bundler"`, importing the bare `"@wllama/wllama"` specifier resolves straight to that raw
  source and pulls their entire `src/` into our own typecheck under our strict settings (which
  their source doesn't cleanly satisfy — a dozen-plus errors, none of them ours).
  `skipLibCheck: true` doesn't help since these are `.ts` source files, not `.d.ts` declarations.
  **Fix:** import the deep path `@wllama/wllama/esm/index.js` instead, which resolves to their
  actual built output with a proper adjacent `index.d.ts`. **Anyone else importing this library
  in this repo (the real app bundle, E4) needs the same deep-import workaround** — this isn't
  specific to the adapter file, it's specific to the package.
- **Pleasant contrast with WebLLM: real download/init separation.** `wllama.cacheManager.open()`
  can check for a cache hit before committing to a download, and `.download()` reports
  structured `{ loaded, total }` byte progress (not free text) — so unlike WebLLM, this adapter
  _does_ implement a proper `download()` step with real `mb`/`ms` figures, not folded into
  `init_ms`.
- **Real abort mechanism: standard `AbortSignal`, not an SDK-specific method.** Completion params
  take `abortSignal?: AbortSignal`, so `dispose()` can cancel an in-flight `runOnce()` through a
  real Web API rather than WebLLM's undocumented-behavior `interruptGenerate()` or Transformers.js's
  total absence of one. Still **unverified against the real library in this session** (no browser
  available here — see `adapters/README.md`'s test boundary) — the mocked conformance test proves
  our own wiring passes the signal through correctly, not that llama.cpp's WASM build actually
  honors it promptly mid-generation.
- **`esm/wasm-from-cdn.js` doesn't exist in the published 3.5.1 package — only its
  `wasm-from-cdn.d.ts`.** Found in E4-S3 while wiring the real app bundle: `import WasmFromCDN
from "@wllama/wllama/esm/wasm-from-cdn.js"` fails at bundle time (Vite: "Does the file exist?")
  despite typechecking fine — `tsc` only needs the `.d.ts`, not the runtime file, so this is
  invisible to typecheck and only surfaces when something actually tries to load the module.
  Checked the compiled `esm/index.js`: `WasmFromCDN` isn't re-exported from there either (only an
  unused, unexported `WasmCompatFromCDN` — a _different_, single-thread "compat" build hosted
  under the separate `@wllama/wllama-compat` package — survives tree-shaking). **Fix:** the
  package _does_ ship its own default wasm binary locally at `esm/wasm/wllama.wasm`, so
  `apps/web/src/adapterFactory.ts` imports that directly as a Vite asset URL (`?url`) and builds
  `AssetsPathConfig` by hand (`{ default: wllamaWasmUrl }`) instead of depending on the missing
  CDN-URL-constants module. Bonus: this also means wllama's wasm loads from our own bundle rather
  than reaching out to jsDelivr at runtime — one fewer third-party runtime dependency, not just a
  workaround. Needed a `vite-env.d.ts` triple-slash reference to `vite/client` in apps/web (wasn't
  present before) so `?url` imports typecheck.
