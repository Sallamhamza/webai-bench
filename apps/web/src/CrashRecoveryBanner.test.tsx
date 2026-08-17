import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkForStaleCrashMarker, writeCrashMarker } from "@webai-bench/harness";
import { CrashRecoveryBanner } from "./CrashRecoveryBanner";

// Uses the real crashMarker.ts primitives against real localStorage (jsdom provides a working
// one) rather than mocking them — this is exactly the kind of pure-storage-boundary code that's
// cheap and worthwhile to exercise for real, same reasoning as wasmScore.test.ts running the
// actual compiled kernel instead of a mock.
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("CrashRecoveryBanner", () => {
  it("renders nothing when there is no stale marker", () => {
    render(<CrashRecoveryBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the crashed cell and lets the user dismiss it, clearing the marker", async () => {
    const user = userEvent.setup();
    writeCrashMarker("smollm2-1.7b__q4f16__webllm__webgpu");

    render(<CrashRecoveryBanner />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("smollm2-1.7b__q4f16__webllm__webgpu");

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(checkForStaleCrashMarker()).toBeNull();
  });

  it("falls back to the raw timestamp string if it can't be parsed as a date", () => {
    localStorage.setItem(
      "webai-bench:run-started",
      JSON.stringify({ cellId: "some-cell", ts: "not-a-real-date" }),
    );

    render(<CrashRecoveryBanner />);

    expect(screen.getByRole("alert")).toHaveTextContent("not-a-real-date");
  });
});
