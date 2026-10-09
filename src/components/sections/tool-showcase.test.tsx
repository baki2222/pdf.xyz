// @vitest-environment jsdom
/**
 * The home toolbox, as markup: what every viewport keeps.
 *
 * On a phone the toolbox was 3,678px tall (measured 2026-10-10): fifty
 * dot-leader rows under eight category heads, a third of the home page
 * spent saying nothing about where to start. WP-06 makes it a two-column
 * grid of category cards on a phone — the category and its count, its first
 * tools, a way to all of them — and keeps the full index from `sm`.
 *
 * Hidden on a phone is not removed. Every tool row stays in the HTML, so the
 * home page still links every tool (`internal-links.test.ts` counts the home
 * catalogue among each tool's inbound links). The phone layout itself —
 * height, and how many tools each card shows — is measured in a real
 * browser by `e2e/tool-layout.mobile.spec.ts`; jsdom has no layout.
 */
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { ToolShowcase } from "./tool-showcase";
import { categories, getToolsByCategory, tools } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("ToolShowcase", () => {
  it("links every tool in the catalogue", () => {
    const { container } = render(<ToolShowcase />);
    const linked = new Set(
      [...container.querySelectorAll('a[href^="/tools/"]')].map((a) =>
        a.getAttribute("href"),
      ),
    );
    // Health: the catalogue, not a sample.
    expect(tools.length).toBeGreaterThanOrEqual(40);
    expect(tools.filter((t) => !linked.has(`/tools/${t.slug}`))).toEqual([]);
  });

  it("each category's heading is a link to its page, named with its count", () => {
    const { container } = render(<ToolShowcase />);
    const section = container.querySelector("section#tools") as HTMLElement;
    for (const category of categories) {
      const count = getToolsByCategory(category.id).length;
      const link = within(section).getByRole("link", {
        name: new RegExp(`^${escape(category.name)} ${count} tools$`),
      });
      expect(link).toHaveAttribute("href", categoryHref(category.id));
      expect(link.closest("h3"), category.id).not.toBeNull();
    }
  });

  it("keeps a way to every category's full list beside its index, on wide screens", () => {
    const { container } = render(<ToolShowcase />);
    for (const category of categories) {
      const viewAll = within(container).getByRole("link", {
        name: new RegExp(`^View all ${escape(category.name)}`),
      });
      expect(viewAll).toHaveAttribute("href", categoryHref(category.id));
    }
  });

  it("an h2 opens it and a card h3 never skips a level", () => {
    const { container } = render(<ToolShowcase />);
    const levels = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
      (h) => Number(h.tagName.slice(1)),
    );
    expect(levels[0]).toBe(2);
    expect(levels.filter((l) => l === 3)).toHaveLength(categories.length);
    expect(levels.filter((l) => l > 3)).toEqual([]);
  });
});
