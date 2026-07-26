import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wasm-feature-detect", () => ({
  simd: vi.fn().mockResolvedValue(false),
  threads: vi.fn().mockResolvedValue(false),
}));

import { simd, threads } from "wasm-feature-detect";
import { probe } from "./probe";

function defineNavigatorProp(name: string, value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true });
}

function deleteNavigatorProp(name: string): void {
  Object.defineProperty(navigator, name, { value: undefined, configurable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  deleteNavigatorProp("gpu");
  deleteNavigatorProp("userAgentData");
  vi.mocked(simd).mockResolvedValue(false);
  vi.mocked(threads).mockResolvedValue(false);
});

describe("probe() — FR1.2: never throws, nulls when unavailable", () => {
  it("resolves with safe defaults when every underlying API is absent", async () => {
    defineNavigatorProp("gpu", undefined);
    defineNavigatorProp("userAgentData", undefined);
    defineNavigatorProp("hardwareConcurrency", undefined);
    defineNavigatorProp("deviceMemory", undefined);
    defineNavigatorProp("userAgent", "");

    const result = await probe();

    expect(result).toEqual({
      webgpu: {
        available: false,
        vendor: null,
        architecture: null,
        features: [],
        limits: { maxBufferSize: null, maxStorageBufferBindingSize: null },
      },
      wasm: { simd: false, threads: false },
      crossOriginIsolated: expect.any(Boolean),
      hardwareConcurrency: null,
      deviceMemoryGb: null,
      browser: { family: "other", major: null },
      os: { family: "other", versionCoarse: null },
    });
  });

  it("never throws even when navigator.gpu.requestAdapter itself throws", async () => {
    defineNavigatorProp("gpu", {
      requestAdapter: () => {
        throw new Error("boom");
      },
    });

    await expect(probe()).resolves.toBeDefined();
  });

  it("never throws when wasm-feature-detect rejects", async () => {
    vi.mocked(simd).mockRejectedValue(new Error("boom"));
    vi.mocked(threads).mockRejectedValue(new Error("boom"));

    const result = await probe();
    expect(result.wasm).toEqual({ simd: false, threads: false });
  });

  it("never throws when navigator.userAgentData getter throws", async () => {
    Object.defineProperty(navigator, "userAgentData", {
      get() {
        throw new Error("boom");
      },
      configurable: true,
    });

    await expect(probe()).resolves.toBeDefined();
  });
});

describe("probe() — WebGPU detection", () => {
  it("reports available: false when navigator.gpu is undefined", async () => {
    defineNavigatorProp("gpu", undefined);
    const result = await probe();
    expect(result.webgpu.available).toBe(false);
  });

  it("reports available: false when requestAdapter resolves null", async () => {
    defineNavigatorProp("gpu", { requestAdapter: async () => null });
    const result = await probe();
    expect(result.webgpu.available).toBe(false);
  });

  it("reports vendor/architecture/features/limits from a real adapter", async () => {
    defineNavigatorProp("gpu", {
      requestAdapter: async () => ({
        info: { vendor: "nvidia", architecture: "ampere" },
        features: { has: (f: string) => f === "shader-f16" },
        limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824 },
      }),
    });

    const result = await probe();
    expect(result.webgpu).toEqual({
      available: true,
      vendor: "nvidia",
      architecture: "ampere",
      features: ["shader-f16"],
      limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824 },
    });
  });
});

describe("probe() — wasm detection (via wasm-feature-detect)", () => {
  it("reports simd/threads support as returned by the library", async () => {
    vi.mocked(simd).mockResolvedValue(true);
    vi.mocked(threads).mockResolvedValue(true);

    const result = await probe();
    expect(result.wasm).toEqual({ simd: true, threads: true });
  });
});

describe("probe() — browser detection", () => {
  it("prefers userAgentData (Client Hints) when available", async () => {
    defineNavigatorProp("userAgentData", {
      brands: [{ brand: "Google Chrome", version: "138" }],
      platform: "Windows",
    });

    const result = await probe();
    expect(result.browser).toEqual({ family: "chrome", major: 138 });
  });

  it("falls back to UA-string parsing for Firefox", async () => {
    defineNavigatorProp("userAgentData", undefined);
    defineNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
    );

    const result = await probe();
    expect(result.browser).toEqual({ family: "firefox", major: 141 });
  });

  it("falls back to UA-string parsing for Safari", async () => {
    defineNavigatorProp("userAgentData", undefined);
    defineNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    );

    const result = await probe();
    expect(result.browser).toEqual({ family: "safari", major: 18 });
  });
});

describe("probe() — OS detection", () => {
  it("prefers userAgentData.platform when available", async () => {
    defineNavigatorProp("userAgentData", { brands: [], platform: "macOS" });
    const result = await probe();
    expect(result.os.family).toBe("macos");
  });

  it("falls back to UA-string parsing for Android", async () => {
    defineNavigatorProp("userAgentData", undefined);
    defineNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
    );
    const result = await probe();
    expect(result.os).toEqual({ family: "android", versionCoarse: "14" });
  });

  it("falls back to UA-string parsing for iOS", async () => {
    defineNavigatorProp("userAgentData", undefined);
    defineNavigatorProp(
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    );
    const result = await probe();
    expect(result.os).toEqual({ family: "ios", versionCoarse: "18.0" });
  });
});

describe("probe() — misc fields", () => {
  it("reports hardwareConcurrency and deviceMemory when present", async () => {
    defineNavigatorProp("hardwareConcurrency", 8);
    defineNavigatorProp("deviceMemory", 8);
    const result = await probe();
    expect(result.hardwareConcurrency).toBe(8);
    expect(result.deviceMemoryGb).toBe(8);
  });

  it("reports null for hardwareConcurrency/deviceMemory when absent", async () => {
    defineNavigatorProp("hardwareConcurrency", undefined);
    defineNavigatorProp("deviceMemory", undefined);
    const result = await probe();
    expect(result.hardwareConcurrency).toBeNull();
    expect(result.deviceMemoryGb).toBeNull();
  });

  it("reflects self.crossOriginIsolated", async () => {
    Object.defineProperty(self, "crossOriginIsolated", { value: true, configurable: true });
    const result = await probe();
    expect(result.crossOriginIsolated).toBe(true);
  });
});
