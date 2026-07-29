import { describe, expect, it } from "vitest";
import { computeCellFlags, computeStatValue } from "./stats";
import type { CellSample } from "./runner";

function sample(overrides: Partial<CellSample> = {}): CellSample {
  return {
    ttftMs: 900,
    decodeTps: 14,
    tokensGenerated: 128,
    runtimeReportedTps: 14,
    ...overrides,
  };
}

describe("computeStatValue", () => {
  it("returns null for an empty array", () => {
    expect(computeStatValue([])).toBeNull();
  });

  it("returns the same value for all three fields on a single sample", () => {
    expect(computeStatValue([42])).toEqual({ median: 42, min: 42, max: 42 });
  });

  it("computes median/min/max for an odd-length set, unsorted input", () => {
    expect(computeStatValue([5, 1, 3])).toEqual({ median: 3, min: 1, max: 5 });
  });

  it("computes median as the average of the two middle values for an even-length set", () => {
    expect(computeStatValue([1, 2, 3, 4])).toEqual({ median: 2.5, min: 1, max: 4 });
  });
});

describe("computeCellFlags — thermal_variance (04 §5, >0.25 spread)", () => {
  it("does not flag when decode_tps spread is within threshold", () => {
    const samples = [
      sample({ decodeTps: 14 }),
      sample({ decodeTps: 14.5 }),
      sample({ decodeTps: 15 }),
    ];
    expect(computeCellFlags(samples)).not.toContain("thermal_variance");
  });

  it("flags when (max - min) / median exceeds 0.25", () => {
    // spread = (20 - 10) / 12 = 0.833
    const samples = [
      sample({ decodeTps: 10 }),
      sample({ decodeTps: 12 }),
      sample({ decodeTps: 20 }),
    ];
    expect(computeCellFlags(samples)).toContain("thermal_variance");
  });

  it("does not divide by zero / flag when decode_tps median is 0", () => {
    const samples = [sample({ decodeTps: 0 }), sample({ decodeTps: 0 })];
    expect(() => computeCellFlags(samples)).not.toThrow();
    expect(computeCellFlags(samples)).toEqual([]);
  });

  it("returns no flags when there are no decode_tps samples at all", () => {
    const samples = [sample({ decodeTps: null })];
    expect(computeCellFlags(samples)).toEqual([]);
  });
});

describe("computeCellFlags — runtime_disagreement (04 §5, >15% gap)", () => {
  it("does not flag when runtime-reported and bracketed decode_tps agree within 15%", () => {
    const samples = [
      sample({ decodeTps: 14, runtimeReportedTps: 14.5 }),
      sample({ decodeTps: 14, runtimeReportedTps: 14.5 }),
    ];
    expect(computeCellFlags(samples)).not.toContain("runtime_disagreement");
  });

  it("flags when the runtime's self-reported figure differs from ours by more than 15%", () => {
    const samples = [
      sample({ decodeTps: 10, runtimeReportedTps: 20 }), // 100% gap
      sample({ decodeTps: 10, runtimeReportedTps: 20 }),
    ];
    expect(computeCellFlags(samples)).toContain("runtime_disagreement");
  });

  it("does not flag when there are no runtime-reported values to compare against", () => {
    const samples = [sample({ decodeTps: 10, runtimeReportedTps: null })];
    expect(computeCellFlags(samples)).toEqual([]);
  });

  it("can report both flags at once", () => {
    const samples = [
      sample({ decodeTps: 10, runtimeReportedTps: 30 }),
      sample({ decodeTps: 12, runtimeReportedTps: 30 }),
      sample({ decodeTps: 30, runtimeReportedTps: 30 }), // wide decode_tps spread too
    ];
    const flags = computeCellFlags(samples);
    expect(flags).toContain("thermal_variance");
    expect(flags).toContain("runtime_disagreement");
  });
});
