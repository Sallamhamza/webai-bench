import { useCallback, useEffect, useRef, useState } from "react";

// SP5 spike (docs/08-delivery-plan.md §2): the browser-driven half of the Worker+D1+Turnstile
// round trip. wrangler-dev-side validation (fake token + Cloudflare's public test secret) already
// passed; this proves it end-to-end against the live deploy with a REAL widget-issued token,
// which the real secret key requires. Throwaway — delete once the real ingest API + consent
// client (E7/E8) land.

const API_BASE = "https://webai-bench-api.hamzaeng277.workers.dev";
// Public site key — safe to embed client-side (that's the whole point of a site key).
const TURNSTILE_SITE_KEY = "0x4AAAAAAD8G1v9bMLb6NGm9";

const TOY_PAYLOAD = {
  schema_version: "1.0",
  suite_version: "1.0.0",
  client_nonce: crypto.randomUUID(),
  consent: { submit: true, consent_version: "c1" },
  env: {
    browser: { family: "chrome", major: 138 },
    os: { family: "windows", version_coarse: "11" },
    gpu: { vendor: "nvidia", architecture: "ampere" },
    webgpu: {
      available: true,
      features: ["shader-f16", "timestamp-query"],
      limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824 },
    },
    wasm: { simd: true, threads: true },
    cross_origin_isolated: true,
    hardware_concurrency: 8,
    device_memory_gb: 8,
    execution_context: "worker",
  },
  micro: {
    matmul_f32_gflops: { median: 412.5, min: 401.0, max: 420.1 },
    matmul_f16_gflops: null,
    mem_bw_gbps: { median: 88.2, min: 85.0, max: 91.3 },
    wasm_score_single: { median: 1520, min: 1490, max: 1544 },
    wasm_score_multi: { median: 9800, min: 9500, max: 10100 },
  },
  cells: [
    {
      cell_id: "sp5-toy-cell",
      model_id: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
      revision: "abc123def456",
      quant: "q4f16",
      runtime: "webllm",
      runtime_version: "0.2.79",
      backend: "webgpu",
      status: "success",
      error_code: null,
      download: { mb: 1042.7, ms: 183200 },
      cache_hit: false,
      integrity_verified: true,
      init_ms: 8450,
      ttft_ms: { median: 910, min: 870, max: 1310 },
      decode_tps: { median: 14.2, min: 13.8, max: 14.6 },
      tokens_generated: 128,
      runtime_reported_tps: 14.5,
      fixture_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
  ],
  flags: [],
};

type Phase =
  "loading-widget" | "awaiting-token" | "ready" | "submitting" | "reading-back" | "done" | "error";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void },
      ) => string;
    };
  }
}

export function Sp5ToyIngest() {
  const [phase, setPhase] = useState<Phase>("loading-widget");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postResult, setPostResult] = useState<{ result_id: string; wall_clock_ms: number } | null>(
    null,
  );
  const [readBack, setReadBack] = useState<unknown>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (renderedRef.current) return;
    const scriptId = "cf-turnstile-script";
    const existing = document.getElementById(scriptId);

    const renderWidget = () => {
      if (renderedRef.current || !widgetRef.current || !window.turnstile) return;
      renderedRef.current = true;
      window.turnstile.render(widgetRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t) => {
          setToken(t);
          setPhase("ready");
        },
      });
      setPhase("awaiting-token");
    };

    if (existing) {
      renderWidget();
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = renderWidget;
    document.body.appendChild(script);
  }, []);

  const submit = useCallback(async () => {
    if (!token) return;
    setPhase("submitting");
    setError(null);

    try {
      const postRes = await fetch(`${API_BASE}/api/v1/results/toy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-turnstile-response": token },
        body: JSON.stringify(TOY_PAYLOAD),
      });
      const postJson = await postRes.json();
      if (!postRes.ok) {
        throw new Error(`POST ${postRes.status}: ${JSON.stringify(postJson)}`);
      }
      setPostResult(postJson as { result_id: string; wall_clock_ms: number });

      setPhase("reading-back");
      const getRes = await fetch(`${API_BASE}/api/v1/results/toy/${postJson.result_id}`);
      const getJson = await getRes.json();
      if (!getRes.ok) {
        throw new Error(`GET ${getRes.status}: ${JSON.stringify(getJson)}`);
      }
      setReadBack(getJson);
      setPhase("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [token]);

  return (
    <section>
      <h2>SP5 spike — live Worker + D1 + Turnstile round trip</h2>
      <p>
        API: <code>{API_BASE}</code>
      </p>
      <p data-testid="sp5-phase">phase: {phase}</p>

      <div ref={widgetRef} />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!token || phase === "submitting"}
      >
        Submit toy result (uses real Turnstile token)
      </button>

      {error && <p data-testid="sp5-error">failed: {error}</p>}
      {postResult && (
        <p data-testid="sp5-post-result">
          result_id: {postResult.result_id} · wall_clock_ms: {postResult.wall_clock_ms.toFixed(1)}
        </p>
      )}
      {readBack !== null && (
        <pre data-testid="sp5-readback">{JSON.stringify(readBack, null, 2)}</pre>
      )}
    </section>
  );
}
