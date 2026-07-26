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
