// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolCard } from "./tool-card";
import { getToolBySlug } from "@/lib/tools";

describe("ToolCard", () => {
  it("renders a tool's name and links to its page", () => {
    const tool = getToolBySlug("merge-pdf");
    expect(tool).toBeDefined();

    render(<ToolCard tool={tool!} />);

    expect(screen.getByText(tool!.name)).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/tools/${tool!.slug}`);
  });
});
