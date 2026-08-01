import { assembleCellResult, type CellRunResult } from "@webai-bench/harness";
import type { CellRegistryEntry } from "@webai-bench/registry";
import { EMBEDDING_SENTENCES, LLM_PROMPT } from "./fixtures";
import { createAdapterForCell } from "./adapterFactory";

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Mirrors adapterFactory's runtime -> fixture dispatch. Kept as its own small switch rather than
// exported/shared from adapterFactory since there are only two fixture files and two task
// shapes — a shared lookup would be more indirection than the two-line duplication it replaces.
function fixtureTextForCell(cell: CellRegistryEntry): string {
  return cell.runtime === "transformers.js" ? JSON.stringify(EMBEDDING_SENTENCES) : LLM_PROMPT;
}

export interface ExportPayload {
  suite_version: string;
  exported_at: string;
  cells: unknown[];
}

/**
 * FR3.4: users who decline submission can still export their results locally as JSON. Reuses
 * assembleCellResult() — the same schema-conformant assembly E1-S6 built for the future
 * submission flow — so a local export isn't a bespoke shape that'd need reconciling later.
 * `integrity_verified` is always "unknown" here: this app doesn't verify weight integrity
 * against a known-good hash yet (03-architecture.md's integrity recording, FR2.9, is unbuilt).
 */
export async function buildExportPayload(
  cells: readonly CellRegistryEntry[],
  results: ReadonlyMap<string, CellRunResult>,
  suiteVersion: string,
): Promise<ExportPayload> {
  const cellsWithResults = cells.filter((cell) => results.has(cell.cell_id));

  const exportedCells = await Promise.all(
    cellsWithResults.map(async (cell) => {
      const result = results.get(cell.cell_id);
      if (!result) throw new Error(`unreachable: filtered for results.has(${cell.cell_id})`);

      const fixtureSha256 = await sha256Hex(fixtureTextForCell(cell));
      const { runtimeVersion } = createAdapterForCell(cell).meta;

      const { cell: draft, flags } = assembleCellResult(
        {
          cellId: cell.cell_id,
          modelId: cell.model_id,
          revision: cell.revision,
          quant: cell.quant,
          runtime: cell.runtime,
          runtimeVersion,
          backend: cell.backend,
          integrityVerified: "unknown",
          fixtureSha256,
        },
        result,
      );

      return { ...draft, flags };
    }),
  );

  return {
    suite_version: suiteVersion,
    exported_at: new Date().toISOString(),
    cells: exportedCells,
  };
}
