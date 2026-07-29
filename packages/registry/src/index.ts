import registryJson from "./registry.json";
import { SuiteRegistrySchema, type CellRegistryEntry, type SuiteRegistry } from "./schema";

// Data-only definition of the benchmark matrix (model ids, pinned HF revisions, quants,
// timeouts, license metadata, suite version). See docs/03-architecture.md §5.5 and §6, and
// docs/adr/0004-registry-v1-scope.md for what's deliberately *not* in v1 (Whisper/ASR, Tier-2).
//
// Validated once, at module load — a malformed registry.json should fail loudly at import time
// (in tests and in the app), not produce a silently-broken matrix.
export const REGISTRY: SuiteRegistry = SuiteRegistrySchema.parse(registryJson);

export const SUITE_VERSION = REGISTRY.suite_version;

export function getCellById(cellId: string): CellRegistryEntry | undefined {
  return REGISTRY.cells.find((cell) => cell.cell_id === cellId);
}

export {
  SuiteRegistrySchema,
  CellRegistryEntrySchema,
  MinRequirementsSchema,
  type SuiteRegistry,
  type CellRegistryEntry,
  type MinRequirements,
} from "./schema";
