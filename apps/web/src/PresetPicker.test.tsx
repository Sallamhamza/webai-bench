import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresetPicker } from "./PresetPicker";

describe("PresetPicker", () => {
  it("calls onSelect('quick') when Quick run is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PresetPicker onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Quick run" }));
    expect(onSelect).toHaveBeenCalledWith("quick");
  });

  it("calls onSelect('full') when Full run is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PresetPicker onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Full run" }));
    expect(onSelect).toHaveBeenCalledWith("full");
  });

  it("disables both buttons when disabled", () => {
    render(<PresetPicker onSelect={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Quick run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Full run" })).toBeDisabled();
  });
});
