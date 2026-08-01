import { describe, expect, it } from "vitest";
import { needsSizeWarning, totalDownloadMb } from "./sizeWarning";

describe("totalDownloadMb", () => {
  it("sums expected_download_mb across cells", () => {
    expect(totalDownloadMb([{ expected_download_mb: 90 }, { expected_download_mb: 230 }])).toBe(
      320,
    );
  });

  it("returns 0 for an empty selection", () => {
    expect(totalDownloadMb([])).toBe(0);
  });
});

describe("needsSizeWarning", () => {
  it("is false just under the 300 MB threshold", () => {
    expect(needsSizeWarning(299.9)).toBe(false);
  });

  it("is true at exactly the 300 MB threshold", () => {
    expect(needsSizeWarning(300)).toBe(true);
  });

  it("is true well above the threshold", () => {
    expect(needsSizeWarning(1350)).toBe(true);
  });
});
