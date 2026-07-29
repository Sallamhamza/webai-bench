# 0004 — Registry v1 scope: resolve D2 and D3 as deferred

Status: Accepted

Context: `03-architecture.md` §8's decision log left two items open against the v1 matrix
(`04-benchmark-methodology.md` §3): **D2** (include Whisper-tiny ASR in Phase 1 or slip to
Phase 3, deadline "end of Phase 0") and **D3** (include the Tier-2 ~3B opt-in model in v1 or
defer, deadline "end of Phase 1"). Both deadlines have effectively passed with no ADR filed —
E3 (registry v1) is the first story that actually needs an answer, since it has to either build
entries for these tiers or explicitly not.

Decision: **Defer both.** Whisper-tiny is out because no ASR adapter exists (E2 built WebLLM,
Transformers.js, and wllama adapters — all generation/embedding, none ASR) and `asr_rtf` was
deliberately left out of `CellSchema` in ADR 0003 specifically "until an ASR adapter needs it."
Building registry entries for a task type nothing can execute would violate that same discipline.
Tier-2 is out because it adds a fifth model configuration with no corresponding urgency — v1's
adapters and registry validation are better proven against the smaller, already-adapter-backed
set first (NG8 caps at 8 configs regardless; using only 4 leaves headroom).

Registry v1 therefore covers exactly the cells backed by an existing, conformance-suite-tested
adapter (E2): MiniLM-class embedding (Transformers.js × {webgpu, wasm}), SmolLM2-360M-Instruct
q4 (WebLLM × webgpu; wllama × wasm), and SmolLM2-1.7B-Instruct q4f16 **and** q4f32 (WebLLM ×
webgpu) — 4 model configurations, 6 cells total, all Apache-2.0, all with real pinned revisions
verified against the live Hugging Face API (not guessed) as of 2026-07-30.

Consequences: Whisper-tiny and the Tier-2 model are simply absent from the registry, not stubbed
with placeholder entries — a registry entry that can't be executed by any adapter would be a
data lie. Adding either later is exactly the "registry change + ADR" path `03-architecture.md`
§5.4/§7 already mandates for matrix changes, once (respectively) an ASR adapter and a decision to
actually include Tier-2 both exist. This ADR supersedes the "Open" status on D2/D3 in
`03-architecture.md` §8 — that table should be updated to point here the next time it's touched.

Alternatives considered:
- Add placeholder/disabled registry entries for Whisper and Tier-2 now, to "reserve the shape" —
  rejected: nothing distinguishes a deliberately-disabled entry from an accidentally-broken one
  without extra schema machinery (an `enabled` flag, etc.) that has no other use yet; simpler to
  just not have the row until it's real.
