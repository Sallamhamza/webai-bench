// Visibility guard (E1-S5, FR2.6 / docs/04-benchmark-methodology.md §4 step 7). Checked at each
// rep boundary — before warmup, before each measured rep — not continuously during a run, per
// the normative doc's exact wording ("at a rep boundary"). If the tab isn't visible at a
// boundary, execution pauses until it is; the cell that was interrupted still runs to completion
// but is reported with status "visibility-interrupted" instead of "success" (05
// data-model-and-api.md §2's status enum), excluded from submission-eligible aggregates while
// still shown locally (FR2.6).

export function isVisible(): boolean {
  try {
    return document.visibilityState === "visible";
  } catch {
    // No document (non-browser context) or a throwing accessor — fail open. A run that can
    // never observe "visible" again must not pause forever.
    return true;
  }
}

/** Resolves once the tab becomes visible. Resolves immediately if already visible. */
export function waitForVisible(): Promise<void> {
  if (isVisible()) return Promise.resolve();
  return new Promise((resolve) => {
    const onVisibilityChange = () => {
      if (isVisible()) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
  });
}
