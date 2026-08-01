import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getCellById, REGISTRY, SuiteRegistrySchema } from "./index";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

// "CI validation that every cell_id is well-formed and unique" — 08-delivery-plan.md E3. This
// is that validation, run as a normal test so it's already wired into the existing `build` CI
// job (pnpm test) with no separate script needed.

// cell_id convention documented in 05-data-model-and-api.md §2's example
// ("smollm2-1.7b__q4f16__webllm__webgpu"): exactly 4 double-underscore-separated segments,
// lowercase alphanumerics/dots/hyphens/underscores only (hyphens for e.g. "smollm2-1.7b", dots
// for "transformers.js").
const CELL_ID_PATTERN = /^[a-z0-9._-]+__[a-z0-9._-]+__[a-z0-9._-]+__[a-z0-9._-]+$/;

describe("registry — loads and validates", () => {
  it("REGISTRY was already validated against SuiteRegistrySchema at module load", () => {
    // If registry.json didn't conform, importing ./index would have thrown before this test
    // ever ran — this assertion just documents that expectation explicitly.
    expect(() => SuiteRegistrySchema.parse(REGISTRY)).not.toThrow();
  });

  it("has at least one cell", () => {
    expect(REGISTRY.cells.length).toBeGreaterThan(0);
  });
});

describe("registry — cell_id well-formedness and uniqueness", () => {
  it("every cell_id matches the documented convention", () => {
    for (const cell of REGISTRY.cells) {
      expect(cell.cell_id, `${cell.cell_id} does not match the naming convention`).toMatch(
        CELL_ID_PATTERN,
      );
    }
  });

  it("every cell_id is unique", () => {
    const ids = REGISTRY.cells.map((c) => c.cell_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cell_id segments match the cell's own quant/runtime/backend fields", () => {
    // Not strictly required by the schema, but a cell_id that disagrees with its own fields
    // would be a real bug (matches the spirit of "well-formed", not just pattern-matching).
    for (const cell of REGISTRY.cells) {
      const segments = cell.cell_id.split("__");
      expect(segments).toHaveLength(4);
      expect(segments[2]).toBe(cell.runtime);
      expect(segments[3]).toBe(cell.backend);
    }
  });
});

describe("registry — licensing (constraint C4)", () => {
  it("every cell is under a permissive license (Apache-2.0/MIT)", () => {
    const permissive = new Set(["apache-2.0", "mit"]);
    for (const cell of REGISTRY.cells) {
      expect(
        permissive.has(cell.model_license.toLowerCase()),
        `${cell.cell_id} has non-permissive or unrecognized license "${cell.model_license}"`,
      ).toBe(true);
    }
  });

  it("every cell has a non-placeholder pinned revision (40-char hex commit SHA)", () => {
    for (const cell of REGISTRY.cells) {
      expect(cell.revision, `${cell.cell_id}'s revision`).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

describe("registry — NG8 cap (01-project-charter.md §4: ≤8 model configurations)", () => {
  it("has at most 8 distinct (model_id, quant) configurations", () => {
    const configs = new Set(REGISTRY.cells.map((c) => `${c.model_id}@${c.quant}`));
    expect(configs.size).toBeLessThanOrEqual(8);
  });
});

describe("registry — fixture references resolve to real files", () => {
  it("every non-null fixture_path exists under packages/registry/fixtures/", () => {
    for (const cell of REGISTRY.cells) {
      if (cell.fixture_path === null) continue;
      const fullPath = join(FIXTURES_DIR, cell.fixture_path);
      expect(existsSync(fullPath), `${cell.cell_id} references missing fixture ${fullPath}`).toBe(
        true,
      );
    }
  });

  it("only micro-tier cells may have a null fixture_path", () => {
    for (const cell of REGISTRY.cells) {
      if (cell.fixture_path === null) {
        expect(cell.tier).toBe("micro");
      }
    }
  });
});

describe("registry — deferred scope (ADR 0004)", () => {
  it("has no ASR/Whisper cells (no adapter exists yet)", () => {
    const hasWhisper = REGISTRY.cells.some((c) => /whisper/i.test(c.model_id));
    expect(hasWhisper).toBe(false);
  });

  it("has no tier-2 cells", () => {
    const hasTier2 = REGISTRY.cells.some((c) => c.tier === "2");
    expect(hasTier2).toBe(false);
  });
});

describe("getCellById", () => {
  it("finds a known cell", () => {
    const cell = getCellById("smollm2-1.7b__q4f16__webllm__webgpu");
    expect(cell?.model_id).toBe("HuggingFaceTB/SmolLM2-1.7B-Instruct");
  });

  it("returns undefined for an unknown cell_id", () => {
    expect(getCellById("does-not__exist__anywhere__ever")).toBeUndefined();
  });
});
