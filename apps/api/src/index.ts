import { Hono } from "hono";
import { parseSubmissionPayload } from "@webai-bench/schema";

// SP5 spike (docs/08-delivery-plan.md §2): toy ingest proving Worker + D1 + Turnstile round
// trip. NOT the real ingest API (that's Phase 2, E7) — deliberately minimal: one table, no
// plausibility gates, no rate limiting, no dedupe. Delete once E7-S1/E7-S2 land for real.

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
}

interface ToyResultRow {
  id: string;
  created_at: string;
  payload_json: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/v1/health", (c) => c.json({ ok: true, suite: "0.0.0", snapshot_at: null }));

app.post("/api/v1/results/toy", async (c) => {
  const cpuStart = performance.now();
  const rawBody = await c.req.text();

  const turnstileToken = c.req.header("cf-turnstile-response");
  if (!turnstileToken) {
    return c.json({ error: { code: "turnstile_failed", message: "missing token" } }, 401);
  }

  const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: c.env.TURNSTILE_SECRET_KEY, response: turnstileToken }),
  });
  const verifyJson = await verifyRes.json<{ success: boolean }>();
  if (!verifyJson.success) {
    return c.json({ error: { code: "turnstile_failed", message: "verification failed" } }, 401);
  }

  const parsed = parseSubmissionPayload(rawBody);
  if (!parsed.ok) {
    const status = parsed.error === "payload_too_large" ? 413 : 400;
    return c.json({ error: { code: parsed.error, message: parsed.detail } }, status);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO toy_results (id, created_at, payload_json) VALUES (?, ?, ?)")
    .bind(id, createdAt, rawBody)
    .run();

  // Wall-clock bracket for our own visibility only — NOT the billed CPU time. Cloudflare's
  // Workers CPU-time metric (what counts against free-tier quota) excludes I/O wait (the
  // Turnstile fetch above), so it will read much lower than this. See docs/spikes/sp5-findings.md
  // for the real figure, read from Cloudflare's dashboard/wrangler tail.
  const wallClockMs = performance.now() - cpuStart;

  return c.json({ result_id: id, wall_clock_ms: wallClockMs }, 201);
});

app.get("/api/v1/results/toy/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, created_at, payload_json FROM toy_results WHERE id = ?",
  )
    .bind(id)
    .first<ToyResultRow>();

  if (!row) {
    return c.json({ error: { code: "not_found", message: "unknown id" } }, 404);
  }

  return c.json({
    result_id: row.id,
    created_at: row.created_at,
    payload: JSON.parse(row.payload_json) as unknown,
  });
});

export default app;
