import { simd, threads } from "wasm-feature-detect";

// Capability probe (FR1.1–FR1.2, docs/02-requirements.md). Runs on page load, before any
// download. FR1.2 is the hard rule: this must never throw, and every field is optional/null
// when unavailable — a probe crash would take down the whole app shell before a visitor sees
// anything. Every individual detector is therefore isolated in its own try/catch.

export type BrowserFamily = "chrome" | "edge" | "firefox" | "safari" | "other";
export type OsFamily = "windows" | "macos" | "linux" | "android" | "ios" | "other";

// Whitelist, not the full adapter.features set — only what the suite actually branches on
// (03-architecture.md §5.4/§5.5: shader-f16 splits q4f16/q4f32 model variants).
const TRACKED_WEBGPU_FEATURES = ["shader-f16", "timestamp-query"] as const;

export interface ProbeResult {
  webgpu: {
    available: boolean;
    vendor: string | null;
    architecture: string | null;
    features: string[];
    limits: { maxBufferSize: number | null; maxStorageBufferBindingSize: number | null };
  };
  wasm: { simd: boolean; threads: boolean };
  crossOriginIsolated: boolean;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  browser: { family: BrowserFamily; major: number | null };
  os: { family: OsFamily; versionCoarse: string | null };
}

async function probeWebGpu(): Promise<ProbeResult["webgpu"]> {
  const empty: ProbeResult["webgpu"] = {
    available: false,
    vendor: null,
    architecture: null,
    features: [],
    limits: { maxBufferSize: null, maxStorageBufferBindingSize: null },
  };

  try {
    const gpu = navigator.gpu;
    if (!gpu) return empty;

    const adapter = await gpu.requestAdapter();
    if (!adapter) return empty;

    const info = adapter.info;
    const features = TRACKED_WEBGPU_FEATURES.filter((f) => adapter.features.has(f));

    return {
      available: true,
      vendor: info?.vendor || null,
      architecture: info?.architecture || null,
      features,
      limits: {
        maxBufferSize: adapter.limits.maxBufferSize ?? null,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize ?? null,
      },
    };
  } catch {
    return empty;
  }
}

async function probeWasm(): Promise<ProbeResult["wasm"]> {
  // wasm-feature-detect's own detectors already catch internally and resolve false on
  // unsupported engines, but we wrap anyway per FR1.2 — never trust a dependency's contract
  // to be the only thing standing between us and a crashed probe.
  const [simdSupported, threadsSupported] = await Promise.all([
    simd().catch(() => false),
    threads().catch(() => false),
  ]);
  return { simd: simdSupported, threads: threadsSupported };
}

function probeCrossOriginIsolated(): boolean {
  try {
    return self.crossOriginIsolated === true;
  } catch {
    return false;
  }
}

function probeHardwareConcurrency(): number | null {
  try {
    return navigator.hardwareConcurrency ?? null;
  } catch {
    return null;
  }
}

// navigator.deviceMemory is a Chromium-only, non-standard hint (FR1.1) — not in the stable DOM
// lib types, hence the ambient declaration rather than a cast at every call site.
declare global {
  interface Navigator {
    deviceMemory?: number;
  }
}

function probeDeviceMemory(): number | null {
  try {
    return navigator.deviceMemory ?? null;
  } catch {
    return null;
  }
}

// UA-Client-Hints (NavigatorUAData) isn't in stable DOM lib types either; same ambient-declare
// approach. Chromium-only — Firefox/Safari always fall through to the UA-string regex path.
interface NavigatorUABrandVersion {
  brand: string;
  version: string;
}
interface NavigatorUAData {
  brands: NavigatorUABrandVersion[];
  platform: string;
}
declare global {
  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

const UA_BROWSER_PATTERNS: Array<[BrowserFamily, RegExp]> = [
  ["edge", /Edg\/(\d+)/],
  ["chrome", /Chrome\/(\d+)/],
  ["firefox", /Firefox\/(\d+)/],
  ["safari", /Version\/(\d+).*Safari/],
];

function browserFromUserAgentString(ua: string): { family: BrowserFamily; major: number | null } {
  for (const [family, pattern] of UA_BROWSER_PATTERNS) {
    const match = pattern.exec(ua);
    if (match) {
      const major = match[1] ? Number.parseInt(match[1], 10) : null;
      return { family, major: Number.isNaN(major) ? null : major };
    }
  }
  return { family: "other", major: null };
}

function probeBrowser(): ProbeResult["browser"] {
  try {
    const uaData = navigator.userAgentData;
    if (uaData) {
      const brandNames = uaData.brands.map((b) => b.brand);
      const known: Array<[BrowserFamily, string]> = [
        ["edge", "Microsoft Edge"],
        ["chrome", "Google Chrome"],
        ["chrome", "Chromium"],
      ];
      for (const [family, brandName] of known) {
        const brand = uaData.brands.find((b) => b.brand === brandName);
        if (brand) {
          const major = Number.parseInt(brand.version, 10);
          return { family, major: Number.isNaN(major) ? null : major };
        }
      }
      if (brandNames.length > 0) return { family: "other", major: null };
    }
    return browserFromUserAgentString(navigator.userAgent);
  } catch {
    return { family: "other", major: null };
  }
}

const UA_OS_PATTERNS: Array<[OsFamily, RegExp]> = [
  ["windows", /Windows NT ([\d.]+)/],
  ["macos", /Mac OS X ([\d_.]+)/],
  ["android", /Android ([\d.]+)/],
  ["ios", /OS ([\d_]+) like Mac OS X/],
  ["linux", /Linux/],
];

function probeOs(): ProbeResult["os"] {
  try {
    const uaData = navigator.userAgentData;
    if (uaData?.platform) {
      const platformMap: Record<string, OsFamily> = {
        Windows: "windows",
        macOS: "macos",
        Android: "android",
        Linux: "linux",
        Chrome_OS: "linux",
      };
      const family = platformMap[uaData.platform];
      if (family) return { family, versionCoarse: null };
    }

    const ua = navigator.userAgent;
    for (const [family, pattern] of UA_OS_PATTERNS) {
      const match = pattern.exec(ua);
      if (match) {
        const versionCoarse = match[1] ? match[1].replaceAll("_", ".") : null;
        return { family, versionCoarse };
      }
    }
    return { family: "other", versionCoarse: null };
  } catch {
    return { family: "other", versionCoarse: null };
  }
}

export async function probe(): Promise<ProbeResult> {
  const [webgpu, wasm] = await Promise.all([probeWebGpu(), probeWasm()]);

  return {
    webgpu,
    wasm,
    crossOriginIsolated: probeCrossOriginIsolated(),
    hardwareConcurrency: probeHardwareConcurrency(),
    deviceMemoryGb: probeDeviceMemory(),
    browser: probeBrowser(),
    os: probeOs(),
  };
}
