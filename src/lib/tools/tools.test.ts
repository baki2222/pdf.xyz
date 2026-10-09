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

  /*
   * The corpus is the probes that failed against the old single-substring
   * search, each with the tool a person typing it wants FIRST. Before:
   * "merge pdfs" and "pdf word" found nothing, "jpg pdf" found only PDF to
   * JPG, and "word" returned Protect and Unlock because "password" contains
   * it. Both directions of every two-format pair are here, because an AND
   * match alone ties them and only the ordering rule tells them apart.
   */
  it.each([
    ["merge pdfs", "merge-pdf"],
    ["combine pdfs", "merge-pdf"],
    ["compress pdfs", "compress-pdf"],
    ["pdf word", "pdf-to-word"],
    ["word pdf", "word-to-pdf"],
    ["word to pdf", "word-to-pdf"],
    ["pdf to word", "pdf-to-word"],
    ["jpg pdf", "jpg-to-pdf"],
    ["pdf jpg", "pdf-to-jpg"],
    ["images to pdf", "jpg-to-pdf"],
    ["pdf/a", "pdf-to-pdfa"],
    // Incremental typing must keep narrowing — whole-word matching would
    // empty the grid on every keystroke before the word is finished.
    ["mer", "merge-pdf"],
    ["comp", "compress-pdf"],
  ])("%s → %s first", (query, slug) => {
    expect(searchTools(query)[0]?.slug).toBe(slug);
  });

  it("a word inside another word is not a match", () => {
    const slugs = searchTools("word").map((t) => t.slug);
    expect(slugs).toContain("word-to-pdf");
    expect(slugs).not.toContain("protect-pdf");
    expect(slugs).not.toContain("unlock-pdf");
    // Control: the same tools ARE found by the word they actually contain.
    expect(searchTools("password").map((t) => t.slug)).toContain("protect-pdf");
  });

  it("every tool comes first for its own name", () => {
    // The positive control over the whole catalogue: derived, so a new tool
    // whose name the ranking cannot find is caught on the day it lands.
    const misses = tools
      .map((tool) => [tool.name, searchTools(tool.name)[0]?.slug, tool.slug])
      .filter(([, got, want]) => got !== want);
    expect(misses).toEqual([]);
  });

  it("stopwords alone do not empty the grid, punctuation alone does", () => {
    expect(searchTools("to").length).toBeGreaterThan(0);
    expect(searchTools("???")).toEqual([]);
  });
});
