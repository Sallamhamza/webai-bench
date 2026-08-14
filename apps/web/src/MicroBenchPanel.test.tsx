import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MicroBenchResult, ProbeResult } from "@webai-bench/harness";
import { MicroBenchPanel } from "./MicroBenchPanel";

const runMicroBenchmarksMock = vi.hoisted(() => vi.fn());

vi.mock("@webai-bench/harness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@webai-bench/harness")>();
  return { ...actual, runMicroBenchmarks: runMicroBenchmarksMock };
});

function fakeProbe(): ProbeResult {
  return {
    webgpu: {
      available: true,
      vendor: "nvidia",
      architecture: "ampere",
      features: [],
      limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1 },
    },
    wasm: { simd: true, threads: true },
    crossOriginIsolated: true,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    browser: { family: "chrome", major: 138 },
    os: { family: "windows", versionCoarse: "11" },
  };
}

describe("MicroBenchPanel", () => {
  afterEach(() => {
    runMicroBenchmarksMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("fetches the wasm asset, runs the benchmarks, and displays the results", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    );
    const result: MicroBenchResult = {
      matmulF32Gflops: { median: 1234.5, min: 1200, max: 1300 },
      matmulF16Gflops: null,
      memBwGbps: { median: 42, min: 40, max: 44 },
      wasmScoreSingle: { median: 999_999, min: 900_000, max: 1_000_000 },
      wasmScoreMulti: null,
    };
    runMicroBenchmarksMock.mockResolvedValue(result);

    render(<MicroBenchPanel probeResult={fakeProbe()} />);
    await user.click(screen.getByRole("button", { name: "Run device benchmarks" }));

    expect(await screen.findByText("1234.5 GFLOPS")).toBeInTheDocument();
    expect(screen.getByText("not available on this device")).toBeInTheDocument();
    expect(screen.getByText("42.0 GB/s")).toBeInTheDocument();
    expect(runMicroBenchmarksMock).toHaveBeenCalledOnce();
  });

  it("disables the button while running", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    );
    runMicroBenchmarksMock.mockReturnValue(new Promise(() => {}));

    render(<MicroBenchPanel probeResult={fakeProbe()} />);
    await user.click(screen.getByRole("button", { name: "Run device benchmarks" }));

    expect(await screen.findByRole("button", { name: "Measuring…" })).toBeDisabled();
  });
});
