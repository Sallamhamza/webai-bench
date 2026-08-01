import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCachedModels } from "./clearCache";

describe("clearCachedModels", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "caches");
  });

  it("deletes every Cache Storage entry", async () => {
    const deleteFn = vi.fn().mockResolvedValue(true);
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { keys: vi.fn().mockResolvedValue(["a", "b"]), delete: deleteFn },
    });

    await clearCachedModels();

    expect(deleteFn).toHaveBeenCalledWith("a");
    expect(deleteFn).toHaveBeenCalledWith("b");
    expect(deleteFn).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when Cache Storage isn't available", async () => {
    Reflect.deleteProperty(globalThis, "caches");
    await expect(clearCachedModels()).resolves.toBeUndefined();
  });
});
