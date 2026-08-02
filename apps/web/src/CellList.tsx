import type { CellViewModel } from "./registryView";

export interface CellListProps {
  cellViewModels: readonly CellViewModel[];
  selectedIds: ReadonlySet<string>;
  onToggle: (cellId: string) => void;
  disabled?: boolean;
}

// FR1.3: unrunnable cells are shown greyed-out with the reason, never a blank failure
// (NFR-C2) — every cell renders, runnable or not, so a visitor always sees why a given
// runtime/backend combo is missing rather than just not seeing it.
export function CellList({
  cellViewModels,
  selectedIds,
  onToggle,
  disabled = false,
}: CellListProps) {
  return (
    <ul className="cell-list">
      {cellViewModels.map(({ cell, runnable, reason }) => {
        const inputId = `cell-${cell.cell_id}`;
        const reasonId = `${inputId}-reason`;
        return (
          <li key={cell.cell_id} className={runnable ? undefined : "cell-unrunnable"}>
            <label htmlFor={inputId}>
              <input
                id={inputId}
                type="checkbox"
                checked={selectedIds.has(cell.cell_id)}
                disabled={disabled || !runnable}
                aria-describedby={!runnable && reason ? reasonId : undefined}
                onChange={() => onToggle(cell.cell_id)}
              />
              <span className="cell-name">
                {cell.model_id} ({cell.quant}) — {cell.runtime}/{cell.backend}
              </span>
              <span className="cell-size">{"~" + String(cell.expected_download_mb) + " MB"}</span>
            </label>
            {/* Tied to the checkbox via aria-describedby (not just visually adjacent) so a
                screen-reader user tabbing to a disabled cell hears *why* it's unrunnable
                (FR1.3), not just "checkbox, dimmed." */}
            {!runnable && reason ? (
              <p id={reasonId} className="cell-reason">
                {reason}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
