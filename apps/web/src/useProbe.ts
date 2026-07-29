import { useEffect, useState } from "react";
import { probe, type ProbeResult } from "@webai-bench/harness";

export type ProbeState = { status: "probing" } | { status: "done"; result: ProbeResult };

// FR1.1: probe runs once on page load, before any download. probe() itself never throws
// (FR1.2), so there's no "failed" state here — only "probing" then "done".
export function useProbe(): ProbeState {
  const [state, setState] = useState<ProbeState>({ status: "probing" });

  useEffect(() => {
    let cancelled = false;
    void probe().then((result) => {
      if (!cancelled) setState({ status: "done", result });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
