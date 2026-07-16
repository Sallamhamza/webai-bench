import { Hono } from "hono";

const app = new Hono();

app.get("/api/v1/health", (c) => c.json({ ok: true, suite: "0.0.0", snapshot_at: null }));

export default app;
