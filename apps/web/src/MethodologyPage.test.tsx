import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { REGISTRY } from "@webai-bench/registry";
import { MethodologyPage } from "./MethodologyPage";

describe("MethodologyPage", () => {
  it("renders the current suite version", () => {
    render(<MethodologyPage />);
    expect(screen.getByText(REGISTRY.suite_version)).toBeInTheDocument();
  });

  it("is honest about real-browser coverage being partial", () => {
    render(<MethodologyPage />);
    expect(screen.getByText(/early prototype/i)).toBeInTheDocument();
    expect(screen.getByText(/WebLLM/)).toBeInTheDocument();
  });
});
