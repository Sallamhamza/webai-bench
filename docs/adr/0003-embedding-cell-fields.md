# 0003 — Add "embed_sps" and "batching" to CellSchema

Status: Accepted

Context: `CellSchema` (`packages/schema/src/submission.ts`) and the runner's `CellSample`
(`packages/harness/src/runner.ts`) were both built against E1-S2's only worked example — an LLM
generation cell (`ttft_ms`, `decode_tps`, `tokens_generated`, `runtime_reported_tps`). E2-S2
(Transformers.js adapter) is the first embedding-task adapter, and `04-benchmark-methodology.md`
§2 normatively defines a different metric for it: `embed_sps` ("Sentences/second for one batch
of the 64 standard sentences... record `batching: true/false` as a dimension"). `05
-data-model-and-api.md` §2's payload example only ever shows an LLM cell, so this gap was latent
until an embedding adapter actually needed somewhere to put its output — not a new requirement,
just the first story to actually hit it.

Decision: Add two fields to `CellSchema`: `embed_sps` (nullable `StatValue`, same shape as
`ttft_ms`/`decode_tps` — null for non-embedding cells) and `batching` (nullable boolean — null
for cells where the concept doesn't apply, `true`/`false` for embedding cells depending on
whether the runtime's batch call was used for all 64 sentences or a sequential loop was needed).
Mirrored in `CellSample`/`CellDraft` on the harness side. `asr_rtf` (04 §2's third task-specific
metric, for Whisper/ASR cells) is deliberately **not** added yet — no ASR adapter exists or is
scheduled before E2-S2, and adding a field with nothing to populate it risks the same "guessed at
an undocumented shape" mistake the flags whitelist was built to avoid. Add it when an ASR adapter
actually needs it (Whisper-tiny is D2, still open per `03-architecture.md` §8).

Consequences: `CellSchema` now carries fields relevant to only a subset of cells at a time
(`ttft_ms`/`decode_tps` for generation cells; `embed_sps`/`batching` for embedding cells; both
pairs null for micro-benchmark-only rows) rather than a per-task-type discriminated union. This
keeps the schema flat and every adapter's assembly code uniform (`assembleCellResult` just
leaves the irrelevant pair null), at the cost of a wire format that doesn't self-document which
fields apply to a given `cell_id` — a reader has to know the task type. Acceptable for now;
revisit with a discriminated union if a third task shape (ASR) makes the flat approach genuinely
confusing rather than just slightly redundant.

Alternatives considered:
- A discriminated union on cell "kind" (generation | embedding | asr) with only the relevant
  fields per variant — more correct long-term, but a much larger schema/assembly rewrite than
  this one adapter story warrants; revisit if/when ASR lands and three shapes makes the flat
  approach's cost outweigh its simplicity.
- Cramming embed_sps into decode_tps (reusing the field, since both are "throughput") — rejected:
  actively misleading (decode_tps has a specific normative definition tied to token generation;
  reusing it for sentences/second would make cross-cell aggregation silently wrong).
