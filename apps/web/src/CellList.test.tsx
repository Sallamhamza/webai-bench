import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CellViewModel } from "./registryView";
import { CellList } from "./CellList";
import { REGISTRY } from "@webai-bench/registry";

function viewModels(
  overrides: Partial<Record<string, { runnable: boolean; reason: string | null }>> = {},
) {
  return REGISTRY.cells.map((cell): CellViewModel => {
    const o = overrides[cell.cell_id];
    return o ? { cell, ...o } : { cell, runnable: true, reason: null };
  });
}

describe("CellList", () => {
  it("renders one row per cell, all checked when selected", () => {
    const ids = new Set(REGISTRY.cells.map((c) => c.cell_id));
    render(<CellList cellViewModels={viewModels()} selectedIds={ids} onToggle={vi.fn()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(REGISTRY.cells.length);
    for (const cb of checkboxes) expect(cb).toBeChecked();
  });

  it("disables the checkbox and shows the reason for an unrunnable cell", () => {
    const targetId = "smollm2-360m__q4__webllm__webgpu";
    const reason = "requires WebGPU — not available on this device/browser";
    render(
      <CellList
        cellViewModels={viewModels({ [targetId]: { runnable: false, reason } })}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(reason)).toBeInTheDocument();
    const checkbox = document.getElementById(`cell-${targetId}`);
    expect(checkbox).toBeDisabled();
  });

  it("calls onToggle with the cell_id when a runnable cell's checkbox is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<CellList cellViewModels={viewModels()} selectedIds={new Set()} onToggle={onToggle} />);
    const firstCellId = REGISTRY.cells[0]?.cell_id;
    const checkbox = document.getElementById(`cell-${String(firstCellId)}`);
    if (!checkbox) throw new Error("checkbox not found");
    await user.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(firstCellId);
  });
});
