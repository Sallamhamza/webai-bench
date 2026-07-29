# 0002 — Add "runtime_disagreement" to the flags whitelist

Status: Accepted

Context: `docs/04-benchmark-methodology.md` §5 normatively defines a second derived flag beyond
the one shown in `05-data-model-and-api.md` §2's payload example ("thermal_variance"):
`runtime_disagreement`, set when a runtime's self-reported `runtime_reported_tps` differs from
our own `performance.now()`-bracketed `decode_tps` by more than 15%. §5 describes it as "usually
an adapter bug: investigate" — a data-quality signal, not a poisoning signal. `packages/schema`'s
`FlagSchema` enum only listed `thermal_variance` (deliberately conservative — the schema-building
story explicitly avoided guessing undocumented flag values). E1-S6 (stats/flag computation)
needs to actually compute and emit this flag, so the whitelist must include it.

Decision: Add `"runtime_disagreement"` to `packages/schema/src/submission.ts`'s `FlagSchema`
enum, alongside `"thermal_variance"`. `schema_version` stays `"1.0"` — nothing has been
submitted under this schema yet (pre-launch), so this is filling in a documented-but-missing
enum value, not a breaking change to already-published data.

Consequences: `packages/harness`'s stats module (E1-S6) can emit `runtime_disagreement` for real.
Future flags must still go through this same process (ADR + normative citation) rather than
being guessed at.

Alternatives considered:
- Leave the whitelist at just `thermal_variance` and drop `runtime_disagreement` on the floor
  until some later story needs it — rejected: the flag is already normatively defined, and
  E1-S6's whole point is computing exactly the flags §5 specifies.
