import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

describe("App", () => {
  it("shows the benchmark view by default and switches to methodology on click", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("button", { name: "Benchmark" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("heading", { name: "Methodology" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Methodology" }));

    expect(screen.getByRole("heading", { name: "Methodology" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Methodology" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Benchmark" })).not.toHaveAttribute("aria-current");
  });
});
