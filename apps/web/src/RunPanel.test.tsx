import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CellRunResult, ProbeResult, SuiteRunHandle } from "@webai-bench/harness";
import { REGISTRY } from "@webai-bench/registry";
import { RunPanel } from "./RunPanel";
import type { CellViewModel } from "./registryView";

const runSuiteMock = vi.hoisted(() => vi.fn());

vi.mock("@webai-bench/harness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@webai-bench/harness")>();
  return { ...actual, runSuite: runSuiteMock };
});

function fakeProbe(): ProbeResult {
  return {
    webgpu: {
      available: true,
      vendor: "nvidia",
      architecture: "ampere",
      features: ["shader-f16"],
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

function allRunnable(): CellViewModel[] {
  return REGISTRY.cells.map((cell) => ({ cell, runnable: true, reason: null }));
}

function successResult(): CellRunResult {
  return {
    status: "success",
    download: null,
    cacheHit: true,
    initMs: 10,
    samples: [
      {
        ttftMs: 1,
        decodeTps: 1,
        tokensGenerated: 1,
        runtimeReportedTps: 1,
        embedSps: null,
        batching: null,
      },
    ],
  };
}

function mockHandleResolving(results: Map<string, CellRunResult>): SuiteRunHandle {
  return { result: Promise.resolve(results), stop: vi.fn() };
}

describe("RunPanel", () => {
  afterEach(() => {
    runSuiteMock.mockReset();
  });

  it("starts immediately (no size-warning gate) for a small selection", async () => {
    const user = userEvent.setup();
    const smallCellId = "all-minilm-l6-v2__default__transformers.js__wasm"; // 90 MB, under the 300 MB gate
    const results = new Map([[smallCellId, successResult()]]);
    runSuiteMock.mockReturnValue(mockHandleResolving(results));

    render(
      <RunPanel
        cellViewModels={allRunnable()}
        selectedIds={new Set([smallCellId])}
        probeResult={fakeProbe()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start run" }));

    expect(runSuiteMock).toHaveBeenCalledOnce();
    expect(await screen.findByText(smallCellId)).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("shows the size-warning confirm dialog before starting a >=300MB selection", async () => {
    const user = userEvent.setup();
    const bigCellId = "smollm2-1.7b__q4f32__webllm__webgpu"; // 1350 MB
    runSuiteMock.mockReturnValue(mockHandleResolving(new Map()));

    render(
      <RunPanel
        cellViewModels={allRunnable()}
        selectedIds={new Set([bigCellId])}
        probeResult={fakeProbe()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start run" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/approximately 1350 MB/)).toBeInTheDocument();
    expect(runSuiteMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(runSuiteMock).toHaveBeenCalledOnce();
  });

  it("cancelling the size-warning dialog does not start a run", async () => {
    const user = userEvent.setup();
    const bigCellId = "smollm2-1.7b__q4f32__webllm__webgpu";
    runSuiteMock.mockReturnValue(mockHandleResolving(new Map()));

    render(
      <RunPanel
        cellViewModels={allRunnable()}
        selectedIds={new Set([bigCellId])}
        probeResult={fakeProbe()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start run" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(runSuiteMock).not.toHaveBeenCalled();
  });

  it("clicking Stop mid-run calls the suite handle's stop()", async () => {
    const user = userEvent.setup();
    const smallCellId = "all-minilm-l6-v2__default__transformers.js__wasm";
    const stop = vi.fn();
    // Never-resolving result — keeps the panel in the "running" state so Stop is clickable.
    runSuiteMock.mockReturnValue({ result: new Promise(() => {}), stop });

    render(
      <RunPanel
        cellViewModels={allRunnable()}
        selectedIds={new Set([smallCellId])}
        probeResult={fakeProbe()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start run" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    expect(stop).toHaveBeenCalledOnce();
  });

  it("disables Start run when nothing is selected", () => {
    render(
      <RunPanel cellViewModels={allRunnable()} selectedIds={new Set()} probeResult={fakeProbe()} />,
    );
    expect(screen.getByRole("button", { name: "Start run" })).toBeDisabled();
  });
});
