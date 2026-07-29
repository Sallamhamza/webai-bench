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
