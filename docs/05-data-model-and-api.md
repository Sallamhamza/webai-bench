# 05 — Data Model & API Contract

**Status:** Approved v1.0 · The zod schemas in `packages/schema` are the machine-readable source of truth; this document explains them. Schema changes require an ADR and a `schema_version` bump.

---

## 1. Data-minimization rule (read before adding any field)

A field may exist in the submission payload only if it is (a) required for a published aggregate dimension, (b) required for a plausibility gate, or (c) required for reproducibility (versions/hashes). Anything else is rejected in review. High-entropy values (full UA string, GPU `description`, exact device memory, screen size, timezone, locale) are **forbidden** — see `06` §3.

## 2. Submission payload (`POST /api/v1/results`), `schema_version: "1.0"`

```jsonc
{
  "schema_version": "1.0",
  "suite_version": "1.0.0",
  "client_nonce": "uuid-v4",            // idempotency key; server dedupes retries
  "consent": { "submit": true, "consent_version": "c1" },

  "env": {
    "browser": { "family": "chrome|edge|firefox|safari|other", "major": 138 },
    "os":      { "family": "windows|macos|linux|android|ios|other", "version_coarse": "11|15|…|null" },
    "gpu":     { "vendor": "nvidia|amd|intel|apple|arm|qualcomm|other|null",
                 "architecture": "string-from-adapter.info|null" },
    "webgpu":  { "available": true,
                 "features": ["shader-f16", "timestamp-query"],      // whitelist-filtered
                 "limits": { "maxBufferSize": 2147483648,
                             "maxStorageBufferBindingSize": 1073741824 } },
    "wasm":    { "simd": true, "threads": true },
    "cross_origin_isolated": true,
    "hardware_concurrency": 8,           // clamped to [1..32] client-side
    "device_memory_gb": 8,               // Chromium hint; null elsewhere
    "execution_context": "worker"        // "main" | "worker"
  },

  "micro": {                             // each: { "median": n, "min": n, "max": n } | null
    "matmul_f32_gflops": { "median": 412.5, "min": 401.0, "max": 420.1 },
    "matmul_f16_gflops": null,
    "mem_bw_gbps":       { "median": 88.2, "min": 85.0, "max": 91.3 },
    "wasm_score_single": { "median": 1520, "min": 1490, "max": 1544 },
    "wasm_score_multi":  { "median": 9800, "min": 9500, "max": 10100 }
  },

  "cells": [
    {
      "cell_id": "smollm2-1.7b__q4f16__webllm__webgpu",   // must exist in registry for suite_version
      "model_id": "HuggingFaceTB/SmolLM2-1.7B-Instruct",
      "revision": "abc123…",                              // pinned commit hash from registry
      "quant": "q4f16",
      "runtime": "webllm", "runtime_version": "0.2.79",
      "backend": "webgpu",
      "status": "success",   // success | unsupported | download-error | init-error |
                             // oom | timeout | crash-suspected | visibility-interrupted | error
      "error_code": null,    // enum from packages/schema/errors.ts; NEVER free text
      "download": { "mb": 1042.7, "ms": 183200 },         // null if cache_hit
      "cache_hit": false,
      "integrity_verified": true,                          // true | false | "unknown"
      "init_ms": 8450,
      "ttft_ms":    { "median": 910,  "min": 870,  "max": 1310 },
      "decode_tps": { "median": 14.2, "min": 13.8, "max": 14.6 },
      "tokens_generated": 128,
      "runtime_reported_tps": 14.5,
      "fixture_sha256": "…" 
    }
  ],
  "flags": ["thermal_variance"]          // whitelist enum
}
```

Hard limits enforced server-side: payload ≤ 32 KB; ≤ 16 cells; all enums whitelist-validated; numbers within schema ranges (see `06` §4.3 PG1). Unknown fields → reject (zod `.strict()`).

**Server-added fields (never client-supplied):** `result_id` (nanoid, 21 chars), `created_at` (server UTC), `gate_outcome` (pass | quarantined), `gate_reasons[]`.

## 3. Database (Cloudflare D1 / SQLite)

```sql
-- results: one row per accepted submission (envelope)
CREATE TABLE results (
  id            TEXT PRIMARY KEY,          -- nanoid
  created_at    TEXT NOT NULL,             -- ISO-8601 UTC
  schema_version TEXT NOT NULL,
  suite_version  TEXT NOT NULL,
  client_nonce   TEXT NOT NULL UNIQUE,     -- idempotency / dedupe
  env_json       TEXT NOT NULL,            -- validated JSON as received
  micro_json     TEXT NOT NULL,
  flags_json     TEXT NOT NULL,
  gate_outcome   TEXT NOT NULL CHECK (gate_outcome IN ('pass','quarantined')),
  gate_reasons   TEXT NOT NULL DEFAULT '[]'
);

-- result_cells: denormalized per-cell rows with cohort-key columns for cheap aggregation
CREATE TABLE result_cells (
  result_id     TEXT NOT NULL REFERENCES results(id),
  cell_id       TEXT NOT NULL,
  status        TEXT NOT NULL,
  error_code    TEXT,
  model_id      TEXT NOT NULL,
  quant         TEXT NOT NULL,
  runtime       TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  backend       TEXT NOT NULL,
  execution_context TEXT NOT NULL,
  browser_family TEXT NOT NULL, browser_major INTEGER NOT NULL,
  os_family     TEXT NOT NULL,
  gpu_vendor    TEXT, gpu_architecture TEXT,
  init_ms REAL, ttft_ms_median REAL, decode_tps_median REAL,
  embed_sps_median REAL, asr_rtf_median REAL,
  cell_json     TEXT NOT NULL,             -- full cell object
  PRIMARY KEY (result_id, cell_id)
);
CREATE INDEX idx_cells_cohort ON result_cells
  (cell_id, browser_family, browser_major, os_family, gpu_vendor, gpu_architecture, status);

-- errors: sampled client error beacons (see 07 §4.2). No env beyond browser_family.
CREATE TABLE errors ( id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, area TEXT,
  error_code TEXT, browser_family TEXT, suite_version TEXT );

-- meta: key/value bookkeeping (valid suite versions, yanked versions, snapshot cursors)
CREATE TABLE meta ( k TEXT PRIMARY KEY, v TEXT NOT NULL );
```

Quarantined submissions live in the same tables with `gate_outcome='quarantined'` (single write path, no divergence); every read used for aggregation filters `gate_outcome='pass'`. Migrations: sequential SQL files in `apps/api/migrations/`, applied via wrangler; never edit an applied migration.

## 4. API contract (Worker, Hono)

| Endpoint | Auth/limits | Behavior |
|---|---|---|
| `POST /api/v1/results` | Turnstile token required; edge rate limit 10/h/IP (burst 3); body ≤ 32 KB | Validate schema → verify Turnstile → dedupe `client_nonce` (replay returns the original 201) → run plausibility gates → insert → **always** `201 {"result_id": "…"}` on stored (pass *or* quarantined — gate outcome is never revealed; see `06` §4.4) |
| `GET /r/{result_id}` (page) + `GET /api/v1/results/{id}` (JSON) | Public; cache 1 h | Returns the single stored result (either outcome). Unknown id → 404 |
| `GET /api/v1/aggregates?cell=…&browser=…&os=…&gpu=…` | Public; cache 1 h; rate limit 60/min/IP | Reads the latest snapshot from R2 and filters — never touches D1 |
| `GET /api/v1/health` | Public | `200 {"ok":true,"suite":"1.0.0","snapshot_at":"…"}` |
| `GET /api/v1/registry` | Public; long cache | Current registry JSON (so third parties can mirror the matrix) |

Error semantics (uniform body `{"error": {"code": "…", "message": "…"}}`):
`400 schema_invalid` · `401 turnstile_failed` · `404 not_found` · `413 payload_too_large` · `429 rate_limited` (with `Retry-After`) · `503 ingest_disabled` (kill switch, `07` §6.2). Messages are static strings — never echo client input.

Versioning: breaking API changes → `/api/v2/…`; `/api/v1` maintained ≥ 6 months after v2 ships.

## 5. Snapshots (explorer data)

Cron writes to R2:
- `snapshots/latest.json` → pointer `{ "path": "snapshots/2026-07-12T10/agg-<contenthash>.json", "suite": "1.x" }`
- Immutable content-hashed aggregate files, one per view family, each ≤ 500 KB compressed (NFR-P3): `agg-cells-*.json` (per-cell cohort stats), `agg-matrix-*.json` (support matrix), `agg-quality-*.json` (data-quality counters for the public stats page).
Client fetches `latest.json` (no-cache) then the immutable file (cache-forever). This is what makes read scale free (`07` §3).

## 6. Public dataset dumps

Daily (cron) to R2 `dumps/YYYY-MM-DD/`, weekly mirrored as a GitHub release asset:
- `results.parquet` + `results.csv` — one row per (result, cell), validated (`pass`) only; columns = the denormalized cell columns above + envelope fields + flags. **No `client_nonce`, no gate internals.**
- `quarantine.parquet` — same shape + `gate_reasons`; separately named so no one ingests it by accident.
- `schema.json`, `LICENSE` (CC-BY-4.0), `README.md` (methodology link, suite-version caveats, known biases).
Dumps are append-only history; a yanked suite version ships a corrected `README` note, not deleted files.
