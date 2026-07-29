import type { CellSample } from "./runner";

// Stats module (E1-S6, docs/04-benchmark-methodology.md §5 — "From samples to reported
// numbers"). Pure functions, no schema dependency — resultAssembly.ts is the layer that maps
// these onto the schema's shape.

export interface StatValue {
  median: number;
  min: number;
  max: number;
}

/** Median/min/max over a set of raw samples. Null for an empty set (no samples — e.g. a cell
 * that never reached the measured-reps stage). */
export function computeStatValue(values: readonly number[]): StatValue | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const med = n % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  return { median: med, min: sorted[0] ?? 0, max: sorted[n - 1] ?? 0 };
}

const THERMAL_VARIANCE_THRESHOLD = 0.25;
const RUNTIME_DISAGREEMENT_THRESHOLD = 0.15;

/**
 * Derived flags, exactly per 04 §5's two normative definitions. Computed per cell — that's what
 * each flag is actually about ("this cell's decode_tps was thermally variable"). 05 §2's wire
 * format puts `flags` at the payload envelope, not per-cell, so unioning multiple cells' flags
 * into that array is a future multi-cell orchestrator's job, not this function's — no such
 * orchestrator exists yet (only single-cell runCell()).
 */
export function computeCellFlags(samples: readonly CellSample[]): string[] {
  const flags: string[] = [];

  const decodeTpsValues = samples.map((s) => s.decodeTps).filter((v): v is number => v !== null);
  const decodeTpsStat = computeStatValue(decodeTpsValues);
  if (!decodeTpsStat || decodeTpsStat.median === 0) {
    return flags;
  }

  const spread = (decodeTpsStat.max - decodeTpsStat.min) / decodeTpsStat.median;
  if (spread > THERMAL_VARIANCE_THRESHOLD) {
    flags.push("thermal_variance");
  }

  const runtimeReportedValues = samples
    .map((s) => s.runtimeReportedTps)
    .filter((v): v is number => v !== null);
  const runtimeReportedStat = computeStatValue(runtimeReportedValues);
  if (runtimeReportedStat) {
    const disagreement =
      Math.abs(runtimeReportedStat.median - decodeTpsStat.median) / decodeTpsStat.median;
    if (disagreement > RUNTIME_DISAGREEMENT_THRESHOLD) {
      flags.push("runtime_disagreement");
    }
  }

  return flags;
}
