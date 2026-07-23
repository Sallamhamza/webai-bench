import { useCallback, useState } from "react";
import {
  pipeline,
  type FeatureExtractionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";

// SP3 spike (docs/08-delivery-plan.md §2): Transformers.js embedding on webgpu AND wasm EPs?
// Loads the same MiniLM-class embedding model (03-architecture.md §5.5 Tier-0) on both execution
// providers, one after another, and compares init/embed timing plus fallback behavior when an
// EP fails. Throwaway — delete once the real Transformers.js adapter (E2-S2) lands.

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const SAMPLE_TEXT = "Benchmarking in-browser AI inference across devices.";
const DEVICES = ["webgpu", "wasm"] as const;
type DeviceKey = (typeof DEVICES)[number];

interface DeviceResult {
  device: DeviceKey;
  status: "pending" | "loading" | "embedding" | "ok" | "error";
  progressText: string;
  initMs?: number;
  embedMs?: number;
  dims?: readonly number[];
  error?: string;
}

function initial(): Record<DeviceKey, DeviceResult> {
  return {
    webgpu: { device: "webgpu", status: "pending", progressText: "" },
    wasm: { device: "wasm", status: "pending", progressText: "" },
  };
}

export function Sp3TransformersEmbedding() {
  const [results, setResults] = useState<Record<DeviceKey, DeviceResult>>(initial());
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResults(initial());

    for (const device of DEVICES) {
      const patch = (partial: Partial<DeviceResult>) => {
        setResults((prev) => ({ ...prev, [device]: { ...prev[device], ...partial } }));
      };

      try {
        patch({ status: "loading" });
        const t0 = performance.now();
        const extractor: FeatureExtractionPipeline = await pipeline(
          "feature-extraction",
          MODEL_ID,
          {
            device,
            progress_callback: (p: ProgressInfo) => {
              if (p.status === "progress" && "file" in p) {
                patch({ progressText: `${p.file}: ${p.progress?.toFixed(0) ?? 0}%` });
              } else {
                patch({ progressText: p.status });
              }
            },
          },
        );
        const initMs = performance.now() - t0;

        patch({ status: "embedding", initMs });
        const t1 = performance.now();
        const output = await extractor(SAMPLE_TEXT, { pooling: "mean", normalize: true });
        const embedMs = performance.now() - t1;

        patch({ status: "ok", embedMs, dims: output.dims });
        await extractor.dispose();
      } catch (err: unknown) {
        patch({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }

    setRunning(false);
  }, []);

  return (
    <section>
      <h2>SP3 spike — Transformers.js embedding (webgpu + wasm)</h2>
      <p>
        Model: <code>{MODEL_ID}</code>
      </p>
      <button type="button" onClick={() => void run()} disabled={running}>
        Run SP3 embedding spike
      </button>

      <table>
        <thead>
          <tr>
            <th>device</th>
            <th>status</th>
            <th>init ms</th>
            <th>embed ms</th>
            <th>output dims</th>
            <th>notes / error</th>
          </tr>
        </thead>
        <tbody>
          {DEVICES.map((device) => {
            const r = results[device];
            return (
              <tr key={device}>
                <td>{device}</td>
                <td data-testid={`sp3-${device}-status`}>{r.status}</td>
                <td>{r.initMs?.toFixed(0) ?? ""}</td>
                <td>{r.embedMs?.toFixed(1) ?? ""}</td>
                <td>{r.dims ? r.dims.join("x") : ""}</td>
                <td data-testid={`sp3-${device}-note`}>{r.error ?? r.progressText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
