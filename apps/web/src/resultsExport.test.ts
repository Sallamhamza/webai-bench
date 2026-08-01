import { describe, expect, it } from "vitest";
import type { CellRunResult } from "@webai-bench/harness";
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
});
