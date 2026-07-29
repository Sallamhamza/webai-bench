import { afterEach, describe, expect, it, vi } from "vitest";
import { isVisible, waitForVisible } from "./visibilityGuard";

function setVisibilityState(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

afterEach(() => {
  setVisibilityState("visible");
});

describe("isVisible", () => {
  it("returns true when visibilityState is 'visible'", () => {
    setVisibilityState("visible");
    expect(isVisible()).toBe(true);
  });

  it("returns false when visibilityState is 'hidden'", () => {
    setVisibilityState("hidden");
    expect(isVisible()).toBe(false);
  });

  it("fails open (returns true) when accessing visibilityState throws", () => {
    Object.defineProperty(document, "visibilityState", {
      get() {
        throw new Error("boom");
      },
      configurable: true,
    });
    expect(isVisible()).toBe(true);
  });
});

describe("waitForVisible", () => {
  it("resolves immediately when already visible", async () => {
    setVisibilityState("visible");
    await expect(waitForVisible()).resolves.toBeUndefined();
  });

  it("waits for a visibilitychange event before resolving", async () => {
    setVisibilityState("hidden");
    let resolved = false;
    const promise = waitForVisible().then(() => {
      resolved = true;
    });

    // Still hidden — a visibilitychange firing while still hidden must not resolve.
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(resolved).toBe(false);

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await promise;
    expect(resolved).toBe(true);
  });

  it("removes its event listener once resolved (no leak)", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    setVisibilityState("hidden");

    const promise = waitForVisible();
    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await promise;

    expect(addSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
