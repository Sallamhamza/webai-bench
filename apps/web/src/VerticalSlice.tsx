import { useState } from "react";
import {
  createWebLLMAdapter,
  runSuite,
  type SuiteProgressEvent,
  type CellRunResult,
} from "@webai-bench/harness";
import { getCellById } from "@webai-bench/registry";
import { useProbe } from "./useProbe";
import { toHarnessMinRequirements } from "./registryView";

// THROWAWAY — delete once E4-S3 (real adapter wiring in the app shell) lands. This is the
// vertical-slice gate the team decided to run before building any more UI on top of the E2
// adapter layer, which so far has only been tested against mocked SDKs (see
// packages/harness/src/adapters/README.md's test boundary). Mocks can prove contract shape,
// state transitions, and timing-bracket plumbing — they cannot prove the specific things this
// slice exists to check against a real browser and a real WebLLM engine:
//   1. dispose() actually releases GPU memory — the two cells below run back-to-back in one
//      session specifically to catch a leak that would otherwise look like "cell 2 doesn't run
//      on this device" in published data, rather than a harness bug.
//   2. real thrown errors map sensibly to CellRunResult.status/errorReason (mocks only throw
//      what the test told them to throw).
//   3. TTFT lands where the timing bracket assumes it does for this adapter (SP2's evidence was
//      spike code, not this adapter).
//   4. Stop actually aborts a running generation (not exercised here yet — running to completion
///     first; see docs/06-security-privacy.md §6.4).
// No presets, no results card, no styling — raw JSON is the entire "UI." Any surprise found here
// belongs in adapters/QUIRKS.md, since that's what makes the runtime_disagreement flag
// interpretable later.

// Same fixture text as packages/registry/fixtures/llm-prompt.txt (04-benchmark-methodology.md
// §2) — inlined rather than fetched, since this page is deleted before ship.
const LLM_PROMPT = `You are a helpful assistant. Read the following passage carefully, then answer the question at the end in a clear, well-organized paragraph.

Passage: A public library in a mid-sized town recently completed a renovation that added a dedicated quiet study area, a small recording studio for community podcasts, and a room for tutoring sessions run by local volunteers. The library's staff reported that visits from teenagers increased noticeably after the renovation, particularly in the late afternoon after school lets out. Circulation of physical books stayed roughly flat compared to the previous year, but the number of people using the library's computers and study spaces rose by nearly a third. The library director noted that the renovation was funded through a combination of a state grant, a matching contribution from the town council, and a smaller fundraising campaign organized by a group of local parents. Several other libraries in the region have since sent staff to tour the renovated space, considering similar upgrades of their own. The director cautioned that the renovation alone was not responsible for the increase in visits; a new after-school bus route that stops directly outside the library also began running the same month, and staff believe both changes together explain the change in patterns.

Question: Based on the passage, what factors most likely contributed to the increase in library visits, and why might it be difficult to attribute the change to any single cause?`;

// Both WebLLM/webgpu, deliberately different model sizes (360M then 1.7B) — the point of running
// two cells in one session is specifically to exercise dispose()-then-reinit, not to prove the
// first cell alone works.
const SLICE_CELL_IDS = [
  "smollm2-360m__q4__webllm__webgpu",
  "smollm2-1.7b__q4f16__webllm__webgpu",
] as const;

type RunState =
  | { status: "idle" }
  | { status: "running"; events: SuiteProgressEvent[] }
  | { status: "done"; results: Map<string, CellRunResult> };

export function VerticalSlice() {
  const probeState = useProbe();
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  if (probeState.status === "probing") return null;

  const handleRun = () => {
    const cells = SLICE_CELL_IDS.map((cellId) => {
      const cell = getCellById(cellId);
      if (!cell) throw new Error(`vertical slice: unknown cell_id ${cellId}`);
      return {
        cellId: cell.cell_id,
        createAdapter: () =>
          createWebLLMAdapter({ modelId: cell.adapter_model_ref, prompt: LLM_PROMPT }),
        minRequirements: toHarnessMinRequirements(cell.min_requirements),
        // Found the hard way on the first slice run: without these, runSuite() applies one
        // suite-wide default (120s) to every cell regardless of size, cutting off the 1.7B
        // cell's real download well before the registry's own 180s budget for it.
        timeoutInitMs: cell.timeout_init_ms,
        timeoutRunMs: cell.timeout_run_ms,
      };
    });

    setRunState({ status: "running", events: [] });

    const { result } = runSuite(cells, probeState.result, {
      // N=1, not the normative N=3 (04 §2) — this slice exists to prove the wiring works at
      // all, not to validate statistics; a real conformance run will use the real default.
      repsPerCell: 1,
      onProgress: (event) => {
        console.log("[vertical-slice]", event.phase, event.cellId, event.result ?? "");
        setRunState((prev) =>
          prev.status === "running" ? { status: "running", events: [...prev.events, event] } : prev,
        );
      },
    });

    void result.then((results) => {
      console.log("[vertical-slice] done", results);
      setRunState({ status: "done", results });
    });
  };

  return (
    <section style={{ border: "2px dashed red", padding: "1rem", marginTop: "2rem" }}>
      <h2>Vertical slice (throwaway — real browser gate before E4)</h2>
      <p>
        Runs {SLICE_CELL_IDS.join(" then ")} back-to-back with the real WebLLM adapter. Open
        devtools console for full output.
      </p>
      <button type="button" onClick={handleRun} disabled={runState.status === "running"}>
        {runState.status === "running" ? "Running…" : "Run vertical slice"}
      </button>
      {runState.status === "running" ? <pre>{JSON.stringify(runState.events, null, 2)}</pre> : null}
      {runState.status === "done" ? (
        <pre>{JSON.stringify(Object.fromEntries(runState.results), null, 2)}</pre>
      ) : null}
    </section>
  );
}
