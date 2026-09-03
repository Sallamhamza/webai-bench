import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MicroBenchResult, ProbeResult } from "@webai-bench/harness";
import { MicroBenchPanel } from "./MicroBenchPanel";

const runMicroBenchmarksMock = vi.hoisted(() => vi.fn());
const runMultiThreadWasmScoreMock = vi.hoisted(() => vi.fn());

vi.mock("@webai-bench/harness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@webai-bench/harness")>();
  return { ...actual, runMicroBenchmarks: runMicroBenchmarksMock };
});

// jsdom has no real Worker — the actual orchestration is exercised for real in
// runMultiThreadWasmScore.test.ts (with a fake Worker at the platform boundary); this component
// test only needs to know MicroBenchPanel calls it and passes the result through.
vi.mock("./runMultiThreadWasmScore", () => ({
  runMultiThreadWasmScore: runMultiThreadWasmScoreMock,
}));

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
    runMultiThreadWasmScoreMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("fetches the wasm asset, runs the benchmarks, and displays the results", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    );
    const multiStat = { median: 5_000_000, min: 4_800_000, max: 5_200_000 };
    runMultiThreadWasmScoreMock.mockResolvedValue(multiStat);
    const result: MicroBenchResult = {
      matmulF32Gflops: { median: 1234.5, min: 1200, max: 1300 },
      matmulF16Gflops: null,
      memBwGbps: { median: 42, min: 40, max: 44 },
      wasmScoreSingle: { median: 999_999, min: 900_000, max: 1_000_000 },
      wasmScoreMulti: multiStat,
    };
    runMicroBenchmarksMock.mockResolvedValue(result);
    const probe = fakeProbe();

    render(<MicroBenchPanel probeResult={probe} />);
    await user.click(screen.getByRole("button", { name: "Run device benchmarks" }));

    expect(await screen.findByText("1234.5 GFLOPS")).toBeInTheDocument();
    expect(screen.getByText("not available on this device")).toBeInTheDocument(); // matmulF16Gflops
    expect(screen.getByText("42.0 GB/s")).toBeInTheDocument();
    expect(screen.getByText("5000000 ops/s")).toBeInTheDocument();
    expect(runMultiThreadWasmScoreMock).toHaveBeenCalledWith(
      expect.any(String),
      probe.hardwareConcurrency,
      probe.crossOriginIsolated,
    );
    expect(runMicroBenchmarksMock).toHaveBeenCalledWith(probe, expect.anything(), multiStat);
  });

  it("calls onComplete with the result so a caller can lift it up (e.g. into RunPanel's export)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    );
    runMultiThreadWasmScoreMock.mockResolvedValue(null);
    const result: MicroBenchResult = {
      matmulF32Gflops: null,
      matmulF16Gflops: null,
      memBwGbps: null,
      wasmScoreSingle: { median: 1, min: 1, max: 1 },
      wasmScoreMulti: null,
    };
    runMicroBenchmarksMock.mockResolvedValue(result);
    const onComplete = vi.fn();

    render(<MicroBenchPanel probeResult={fakeProbe()} onComplete={onComplete} />);
    await user.click(screen.getByRole("button", { name: "Run device benchmarks" }));

    await screen.findByText("1 ops/s");
    expect(onComplete).toHaveBeenCalledWith(result);
  });

  it("works fine without onComplete (it's optional)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    );
    runMultiThreadWasmScoreMock.mockResolvedValue(null);
    runMicroBenchmarksMock.mockResolvedValue({
      matmulF32Gflops: null,
      matmulF16Gflops: null,
      memBwGbps: null,
      wasmScoreSingle: null,
      wasmScoreMulti: null,
    });

    render(<MicroBenchPanel probeResult={fakeProbe()} />);
    await expect(
      user.click(screen.getByRole("button", { name: "Run device benchmarks" })),
    ).resolves.not.toThrow();
  });

  it("disables the button while running", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    );
    runMultiThreadWasmScoreMock.mockResolvedValue(null);
    runMicroBenchmarksMock.mockReturnValue(new Promise(() => {}));

    render(<MicroBenchPanel probeResult={fakeProbe()} />);
    await user.click(screen.getByRole("button", { name: "Run device benchmarks" }));

    expect(await screen.findByRole("button", { name: "Measuring…" })).toBeDisabled();
  });
});
