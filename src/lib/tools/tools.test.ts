import { describe, expect, it } from "vitest";
import { categories } from "./categories";
import {
  getAllToolSlugs,
  getRelatedTools,
  getToolBySlug,
  getToolsByCategory,
  searchTools,
  toolCount,
  tools,
} from "./index";

const categoryIds = new Set(categories.map((c) => c.id));

describe("tool catalog integrity", () => {
  it("exposes a non-empty catalog", () => {
    expect(toolCount).toBeGreaterThan(0);
    expect(tools).toHaveLength(toolCount);
  });

  it("has unique slugs", () => {
    const slugs = getAllToolSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("assigns every tool to a known category", () => {
    for (const tool of tools) {
      expect(categoryIds.has(tool.category)).toBe(true);
    }
  });

  it("resolves every tool by slug", () => {
    for (const slug of getAllToolSlugs()) {
      expect(getToolBySlug(slug)?.slug).toBe(slug);
    }
  });

  it("returns undefined for an unknown slug", () => {
    expect(getToolBySlug("definitely-not-a-real-tool")).toBeUndefined();
  });

  it("only references existing tools in `related`", () => {
    for (const tool of tools) {
      for (const related of getRelatedTools(tool)) {
        expect(getToolBySlug(related.slug)).toBeDefined();
      }
    }
  });

  it("groups every category with matching tools", () => {
    for (const category of categories) {
      const grouped = getToolsByCategory(category.id);
      for (const tool of grouped) {
        expect(tool.category).toBe(category.id);
      }
    }
  });
});

describe("searchTools", () => {
  it("returns the full catalog for an empty query", () => {
    expect(searchTools("   ")).toHaveLength(toolCount);
  });

  it("finds a tool by keyword", () => {
    const results = searchTools("merge");
    expect(results.some((t) => t.slug === "merge-pdf")).toBe(true);
  });

  it("returns nothing for gibberish", () => {
    expect(searchTools("zzzzzxyq")).toHaveLength(0);
  });
});
