import { useEffect, useState } from "react";
import { Sp2WebllmSpike } from "./Sp2WebllmSpike";
import { Sp4VarianceStudy } from "./Sp4VarianceStudy";

// SP1 spike (docs/08-delivery-plan.md §2): prove Cloudflare Pages gives us
// cross-origin isolation and that Hugging Face Hub CDN fetches survive COEP.
// Throwaway — delete once the real capability probe (E1-S1) lands.

type FetchProbe = { status: "pending" | "ok" | "failed"; detail: string };

const HF_PROBE_URL = "https://huggingface.co/api/models/HuggingFaceTB/SmolLM2-360M-Instruct";

function useHfCorsProbe(): FetchProbe {
  const [probe, setProbe] = useState<FetchProbe>({ status: "pending", detail: "fetching…" });

  useEffect(() => {
    let cancelled = false;
    // HF's CDN blocks requests whose Referer is on *.workers.dev (returns 404) — see
    // docs/adr/0001-hf-referrer-policy.md. no-referrer sidesteps it on every host.
    fetch(HF_PROBE_URL, { mode: "cors", referrerPolicy: "no-referrer" })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setProbe({ status: "failed", detail: `HTTP ${res.status}` });
          return;
        }
        setProbe({ status: "ok", detail: `HTTP ${res.status}, CORS fetch succeeded` });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setProbe({ status: "failed", detail: message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return probe;
}

export function App() {
  const hfProbe = useHfCorsProbe();
  const isolated = typeof self !== "undefined" ? self.crossOriginIsolated : undefined;

  return (
    <main>
      <h1>WebAI Bench — SP1 spike</h1>
      <p>Placeholder shell — capability probe and benchmark runner land in Phase 1 (E1/E4).</p>

      <h2>crossOriginIsolated</h2>
      <p data-testid="coi-status">{String(isolated)}</p>

      <h2>Hugging Face Hub CDN fetch (CORS under COEP)</h2>
      <p data-testid="hf-status">
        {hfProbe.status}: {hfProbe.detail}
      </p>

      <Sp2WebllmSpike />
      <Sp4VarianceStudy />
    </main>
  );
}
