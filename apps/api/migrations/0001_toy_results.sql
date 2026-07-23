-- SP5 spike (docs/08-delivery-plan.md §2): toy ingest table, not the real schema from
-- docs/05-data-model-and-api.md §3. Deliberately minimal — proves the Worker+D1 round trip only.
CREATE TABLE toy_results (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
