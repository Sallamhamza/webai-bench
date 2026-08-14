import { describe, expect, it } from "vitest";
import type { CellRunResult, MicroBenchResult } from "@webai-bench/harness";
import { REGISTRY, getCellById } from "@webai-bench/registry";
import { buildExportPayload } from "./resultsExport";

function successResult(): CellRunResult {
  return {
    status: "success",
    download: null,
    cacheHit: true,
    initMs: 1000,
    samples: [
      {
        ttftMs: 100,
        decodeTps: 20,
        tokensGenerated: 50,
        runtimeReportedTps: 20,
        embedSps: null,
        batching: null,
      },
    ],
  };
}

describe("buildExportPayload", () => {
  it("includes only cells present in the results map, schema-conformant", async () => {
    const cell = getCellById("smollm2-360m__q4__webllm__webgpu");
    if (!cell) throw new Error("fixture cell not found in registry");

    const results = new Map<string, CellRunResult>([[cell.cell_id, successResult()]]);
    const payload = await buildExportPayload(REGISTRY.cells, results, REGISTRY.suite_version);

    expect(payload.suite_version).toBe(REGISTRY.suite_version);
    expect(payload.cells).toHaveLength(1);
    expect(payload.cells[0]).toMatchObject({ cell_id: cell.cell_id, status: "success" });
    expect(() => new Date(payload.exported_at).toISOString()).not.toThrow();
  });

  it("returns an empty cells array when no results are present", async () => {
    const payload = await buildExportPayload(REGISTRY.cells, new Map(), REGISTRY.suite_version);
    expect(payload.cells).toEqual([]);
  });

  it("defaults micro to all-null (schema's 'not measured', not an error) when the caller doesn't supply it", async () => {
    const payload = await buildExportPayload(REGISTRY.cells, new Map(), REGISTRY.suite_version);
    expect(payload.micro).toEqual({
      matmul_f32_gflops: null,
      matmul_f16_gflops: null,
      mem_bw_gbps: null,
      wasm_score_single: null,
      wasm_score_multi: null,
    });
  });

  it("maps a supplied MicroBenchResult's camelCase fields to the schema's snake_case shape", async () => {
    const micro: MicroBenchResult = {
      matmulF32Gflops: { median: 1200, min: 1100, max: 1300 },
      matmulF16Gflops: null,
      memBwGbps: { median: 40, min: 38, max: 42 },
      wasmScoreSingle: { median: 500_000, min: 480_000, max: 520_000 },
      wasmScoreMulti: { median: 3_000_000, min: 2_900_000, max: 3_100_000 },
    };

    const payload = await buildExportPayload(
      REGISTRY.cells,
      new Map(),
      REGISTRY.suite_version,
      micro,
    );

    expect(payload.micro).toEqual({
      matmul_f32_gflops: micro.matmulF32Gflops,
      matmul_f16_gflops: micro.matmulF16Gflops,
      mem_bw_gbps: micro.memBwGbps,
      wasm_score_single: micro.wasmScoreSingle,
      wasm_score_multi: micro.wasmScoreMulti,
    });
  });
});
