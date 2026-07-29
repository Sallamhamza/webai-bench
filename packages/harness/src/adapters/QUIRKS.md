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
