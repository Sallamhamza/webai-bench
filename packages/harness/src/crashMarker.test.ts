import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForStaleCrashMarker, clearCrashMarker, writeCrashMarker } from "./crashMarker";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("crash marker round trip", () => {
  it("returns null when nothing has ever been written", () => {
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("finds a marker after writeCrashMarker", () => {
    writeCrashMarker("smollm2-1.7b__q4f16__webllm__webgpu");
    const marker = checkForStaleCrashMarker();
    expect(marker?.cellId).toBe("smollm2-1.7b__q4f16__webllm__webgpu");
    expect(marker?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
  });

  it("returns null after clearCrashMarker", () => {
    writeCrashMarker("some-cell");
    clearCrashMarker();
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("overwrites a previous marker rather than accumulating", () => {
    writeCrashMarker("cell-a");
    writeCrashMarker("cell-b");
    expect(checkForStaleCrashMarker()?.cellId).toBe("cell-b");
  });
});

describe("crash marker — defensive behavior", () => {
  it("treats corrupt JSON in storage as no marker, not a crash", () => {
    localStorage.setItem("webai-bench:run-started", "{not valid json");
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("treats a well-formed but wrong-shaped value as no marker", () => {
    localStorage.setItem("webai-bench:run-started", JSON.stringify({ foo: "bar" }));
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("never throws when localStorage.setItem throws (writeCrashMarker)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeCrashMarker("cell-a")).not.toThrow();
  });

  it("never throws when localStorage.getItem throws (checkForStaleCrashMarker)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => checkForStaleCrashMarker()).not.toThrow();
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("never throws when localStorage.removeItem throws (clearCrashMarker)", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearCrashMarker()).not.toThrow();
  });
});
