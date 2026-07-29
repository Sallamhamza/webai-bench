import { describe, expect, it } from "vitest";
import { CellSchema } from "@webai-bench/schema";
import { assembleCellResult, type CellMetadata } from "./resultAssembly";
import type { CellRunResult, CellSample } from "./runner";

function metadata(overrides: Partial<CellMetadata> = {}): CellMetadata {
  return {
    cellId: "smollm2-1.7b__q4f16__webllm__webgpu",
    modelId: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    revision: "abc123def456",
    quant: "q4f16",
    runtime: "webllm",
    runtimeVersion: "0.2.79",
    backend: "webgpu",
    integrityVerified: true,
    fixtureSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ...overrides,
  };
}

function sample(overrides: Partial<CellSample> = {}): CellSample {
  return {
    ttftMs: 900,
    decodeTps: 14,
    tokensGenerated: 128,
    runtimeReportedTps: 14.5,
    embedSps: null,
    batching: null,
    ...overrides,
  };
}

function successResult(samples: CellSample[]): CellRunResult {
  return {
    status: "success",
    download: { mb: 1042.7, ms: 183200 },
    cacheHit: false,
    initMs: 8450,
    samples,
  };
}

describe("assembleCellResult — success path", () => {
  it("produces a cell that validates against the real CellSchema", () => {
    const samples = [sample({ ttftMs: 900 }), sample({ ttftMs: 910 }), sample({ ttftMs: 920 })];
    const { cell } = assembleCellResult(metadata(), successResult(samples));
    expect(() => CellSchema.parse(cell)).not.toThrow();
  });

  it("maps metadata fields straight through", () => {
    const { cell } = assembleCellResult(metadata(), successResult([sample()]));
    expect(cell.cell_id).toBe("smollm2-1.7b__q4f16__webllm__webgpu");
    expect(cell.model_id).toBe("HuggingFaceTB/SmolLM2-1.7B-Instruct");
    expect(cell.quant).toBe("q4f16");
    expect(cell.backend).toBe("webgpu");
  });

  it("computes ttft_ms/decode_tps as stat values over the samples", () => {
    const samples = [
      sample({ ttftMs: 900, decodeTps: 14 }),
      sample({ ttftMs: 910, decodeTps: 14.5 }),
      sample({ ttftMs: 920, decodeTps: 15 }),
    ];
    const { cell } = assembleCellResult(metadata(), successResult(samples));
    expect(cell.ttft_ms).toEqual({ median: 910, min: 900, max: 920 });
    expect(cell.decode_tps).toEqual({ median: 14.5, min: 14, max: 15 });
  });

  it("takes tokens_generated from the last sample", () => {
    const samples = [
      sample({ tokensGenerated: 128 }),
      sample({ tokensGenerated: 128 }),
      sample({ tokensGenerated: 130 }), // last
    ];
    const { cell } = assembleCellResult(metadata(), successResult(samples));
    expect(cell.tokens_generated).toBe(130);
  });

  it("uses the median runtime_reported_tps", () => {
    const samples = [
      sample({ runtimeReportedTps: 14 }),
      sample({ runtimeReportedTps: 14.5 }),
      sample({ runtimeReportedTps: 15 }),
    ];
    const { cell } = assembleCellResult(metadata(), successResult(samples));
    expect(cell.runtime_reported_tps).toBe(14.5);
  });

  it("passes download/cache_hit/init_ms through from the run result", () => {
    const { cell } = assembleCellResult(metadata(), successResult([sample()]));
    expect(cell.download).toEqual({ mb: 1042.7, ms: 183200 });
    expect(cell.cache_hit).toBe(false);
    expect(cell.init_ms).toBe(8450);
  });

  it("returns the same flags computeCellFlags would compute for these samples", () => {
    const samples = [
      sample({ decodeTps: 10, runtimeReportedTps: 30 }),
      sample({ decodeTps: 30, runtimeReportedTps: 30 }),
    ];
    const { flags } = assembleCellResult(metadata(), successResult(samples));
    expect(flags).toContain("thermal_variance");
    expect(flags).toContain("runtime_disagreement");
  });
});

describe("assembleCellResult — embedding cells (ADR 0003)", () => {
  it("computes embed_sps as a stat value and passes batching through", () => {
    const samples = [
      sample({
        ttftMs: null,
        decodeTps: null,
        tokensGenerated: null,
        runtimeReportedTps: null,
        embedSps: 500,
        batching: true,
      }),
      sample({
        ttftMs: null,
        decodeTps: null,
        tokensGenerated: null,
        runtimeReportedTps: null,
        embedSps: 520,
        batching: true,
      }),
      sample({
        ttftMs: null,
        decodeTps: null,
        tokensGenerated: null,
        runtimeReportedTps: null,
        embedSps: 510,
        batching: true,
      }),
    ];
    const { cell } = assembleCellResult(
      metadata({ runtime: "transformers.js", backend: "wasm" }),
      successResult(samples),
    );

    expect(cell.embed_sps).toEqual({ median: 510, min: 500, max: 520 });
    expect(cell.batching).toBe(true);
    expect(cell.ttft_ms).toBeNull();
    expect(cell.decode_tps).toBeNull();
    expect(() => CellSchema.parse(cell)).not.toThrow();
  });

  it("defaults embed_sps/batching to null for a cell with no embedding samples", () => {
    const { cell } = assembleCellResult(metadata(), successResult([sample()]));
    expect(cell.embed_sps).toBeNull();
    expect(cell.batching).toBeNull();
  });
});

describe("assembleCellResult — no-samples paths (unsupported/error/etc.)", () => {
  it("validates against schema with sensible zero/null defaults when there are no samples", () => {
    const runResult: CellRunResult = {
      status: "unsupported",
      reason: "requires WebGPU — not available on this device/browser",
      download: null,
      cacheHit: false,
      initMs: null,
      samples: [],
    };
    const { cell } = assembleCellResult(metadata(), runResult);

    expect(() => CellSchema.parse(cell)).not.toThrow();
    expect(cell.status).toBe("unsupported");
    expect(cell.ttft_ms).toBeNull();
    expect(cell.decode_tps).toBeNull();
    expect(cell.tokens_generated).toBe(0);
    expect(cell.runtime_reported_tps).toBe(0);
    expect(cell.init_ms).toBe(0);
  });

  it("returns no flags when there are no samples to compute them from", () => {
    const runResult: CellRunResult = {
      status: "init-error",
      reason: "boom",
      download: null,
      cacheHit: false,
      initMs: null,
      samples: [],
    };
    const { flags } = assembleCellResult(metadata(), runResult);
    expect(flags).toEqual([]);
  });
});

describe("assembleCellResult — actually validates, not just structurally matches", () => {
  it("throws when the supplied metadata would violate the schema (e.g. empty model_id)", () => {
    expect(() =>
      assembleCellResult(metadata({ modelId: "" }), successResult([sample()])),
    ).toThrow();
  });
});
