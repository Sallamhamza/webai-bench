# Traceability table

Every FR/NFR "M" requirement (`02-requirements.md`) maps to at least one automated test id or a
device-lab step, per `08-delivery-plan.md` §6.5. This table is populated incrementally as stories
land — full 100% coverage of "M" rows is the G2 gate, not a day-one requirement. A row with no
test yet means the requirement isn't implemented yet, not that it's been skipped.

| Requirement | Description | Test(s) | Status |
|---|---|---|---|
| FR1.1 | Capability probe detects WebGPU/adapter info/features/limits, WASM SIMD/threads, crossOriginIsolated, hardwareConcurrency, deviceMemory, browser+OS via UA-Client-Hints w/ UA-string fallback | `packages/harness/src/probe.test.ts` | Done (E1-S1) |
| FR1.2 | Probe never throws; every field optional/null when unavailable | `packages/harness/src/probe.test.ts` ("never throws" describe block) | Done (E1-S1) |
| FR1.3 | Probe results grey out unrunnable matrix cells with reason | — | Not yet (E4, UI shell) |
| FR2.2 | Runner measures/records download, init, TTFT, decode TPS, raw samples per the normative sequence (04 §4) | `packages/harness/src/runner.test.ts` | Partial (E1-S2): sequencing + raw sample collection done; median/min/max + ResultDraft assembly is E1-S6 |
| FR2.3 | Warmup pass + N=3 measured repetitions with live UI progress | `packages/harness/src/runner.test.ts` ("warmup + measured reps" describe block) | Partial (E1-S2): warmup/N=3/cooldown logic done; live UI progress is E4 |
| FR2.4 | Every step has a watchdog timeout (default 120s init / 90s per measured run, configurable per registry entry); timeout → status `timeout`, `dispose()` called, run continues | `packages/harness/src/runner.test.ts` ("watchdog timeouts (FR2.4)" describe block) | Done (E1-S3): init + warmup + each measured rep individually watchdog-wrapped, registry-supplied values (not hardcoded), no stray timers left on success, dispose() still called on timeout |
