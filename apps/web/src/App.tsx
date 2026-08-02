import { useMemo, useState } from "react";
import { Sp5ToyIngest } from "./Sp5ToyIngest";
import { useProbe } from "./useProbe";
import { buildCellViewModels } from "./registryView";
import { runnablePresetCellIds, type PresetId } from "./presets";
import { CellList } from "./CellList";
import { PresetPicker } from "./PresetPicker";
import { RunPanel } from "./RunPanel";

// E4-S2/S3: registry-driven cell selection (FR1.3, FR2.8-S) plus the actual run flow
// (adapters, progress, Stop, results, JSON export). Selection state lives here since both
// CellList/PresetPicker (choosing cells) and RunPanel (running the chosen cells) need it.
function BenchmarkSetup() {
  const probeState = useProbe();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const cellViewModels = useMemo(
    () => (probeState.status === "done" ? buildCellViewModels(probeState.result) : []),
    [probeState],
  );

  if (probeState.status === "probing") {
    return (
      <section aria-busy="true">
        <h2>Benchmark setup</h2>
        <p>Checking device capabilities…</p>
      </section>
    );
  }

  const handlePreset = (preset: PresetId) => {
    setSelectedIds(new Set(runnablePresetCellIds(preset, cellViewModels)));
  };

  const handleToggle = (cellId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      return next;
    });
  };

  return (
    <>
      <section>
        <h2>Benchmark setup</h2>
        <PresetPicker onSelect={handlePreset} />
        <CellList
          cellViewModels={cellViewModels}
          selectedIds={selectedIds}
          onToggle={handleToggle}
        />
      </section>
      <RunPanel
        cellViewModels={cellViewModels}
        selectedIds={selectedIds}
        probeResult={probeState.result}
      />
    </>
  );
}

export function App() {
  return (
    <main>
      <h1>WebAI Bench</h1>
      <p>
        Runs small AI models directly in your browser and measures how they perform on your device —
        nothing you run here leaves your machine unless you choose to share results.
      </p>

      <BenchmarkSetup />

      {/* Sp5ToyIngest is still a real spike, not dead code: it proves the Cloudflare
          Worker+D1+Turnstile submission round trip against the live deploy, and its own
          documented removal condition ("delete once the real ingest API + consent client,
          E7/E8, land") hasn't been met yet — those epics haven't been built. Sp1-Sp4 were
          removed in E4-S4 because *their* conditions (E1-S1 probe, E1-S2 runner, E2-S1/S2
          adapters) all landed earlier this session. */}
      <Sp5ToyIngest />
    </main>
  );
}
