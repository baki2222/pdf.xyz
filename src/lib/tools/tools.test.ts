import { describe, expect, it } from "vitest";
import type { UnsupportedFormat } from "@/lib/intent/formats";
import {
  buildIndex,
  search,
  toolDocs,
  wordsOf,
  type SearchIndex,
  type ToolDoc,
} from "@/lib/intent/search";
import { categories } from "./categories";
import {
  getAllToolSlugs,
  getRelatedTools,
  getToolBySlug,
  getToolsByCategory,
  toolCount,
  tools,
} from "./index";
import { SYNONYM_GROUPS } from "./intents";
import { searchTools, toolSearchIndex } from "./search-tools";
import type { Tool } from "./types";

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

  it("never returns the closest-match fallback — a suggestion must match every word", () => {
    // The 404's "Did you mean" takes whatever this returns, up to three. The
    // ranked search falls back to tools matching ANY word; offered as a
    // suggestion, /merge-zzqx would get Merge PDF for a word nobody typed.
    expect(search(toolSearchIndex(), "merge zzqx").mode).toBe("closest");
    expect(searchTools("merge zzqx")).toEqual([]);
  });
});

/**
 * THE SEARCH CORPUS: what a person types, and what they want first.
 *
 * Started 2026-09-27 as the probes that failed the old single-substring
 * search ("merge pdfs" and "pdf word" found nothing, "word" returned Protect
 * and Unlock because "password" contains it). Extended 2026-10-09 with the
 * rows the redesign measured as still open — "make smaller", "flip", "heic",
 * "webp", "pdf to doc", the misspelling "mrege" — and with a row for every
 * synonym group, filed as `syn` so both directions can be checked below.
 * Rows that already passed stay: "only these were open" is not a licence to
 * leave the rest unguarded.
 *
 * Each row runs through the explorer's own call (`search` over the catalogue
 * index), so the mode is part of the expectation: a "first" row must match
 * EVERY word, not win on the fallback.
 */
type Expect =
  | { first: string }
  | { top: readonly string[] }
  | { closest: string }
  | { unsupported: UnsupportedFormat; never: readonly string[] }
  | { empty: true };

type Row = readonly [query: string, expect: Expect, via?: "syn"];

const NO_WEBPAGE = ["webpage-to-pdf", "html-to-pdf"] as const;

const CORPUS: readonly Row[] = [
  // The 2026-09-27 probes, both directions of every two-format pair.
  ["merge pdfs", { first: "merge-pdf" }],
  ["combine pdfs", { first: "merge-pdf" }],
  ["compress pdfs", { first: "compress-pdf" }],
  ["pdf word", { first: "pdf-to-word" }],
  ["word pdf", { first: "word-to-pdf" }],
  ["word to pdf", { first: "word-to-pdf" }],
  ["pdf to word", { first: "pdf-to-word" }],
  ["jpg pdf", { first: "jpg-to-pdf" }],
  ["pdf jpg", { first: "pdf-to-jpg" }],
  ["images to pdf", { first: "jpg-to-pdf" }],
  ["pdf/a", { first: "pdf-to-pdfa" }],
  // Incremental typing must keep narrowing: whole-word matching would empty
  // the grid on every keystroke before the word is finished.
  ["mer", { first: "merge-pdf" }],
  ["comp", { first: "compress-pdf" }],
  ["rotat", { first: "rotate-pdf" }],
  // The rows the redesign spec requires.
  ["make smaller", { first: "compress-pdf" }],
  ["shrink", { first: "compress-pdf" }],
  ["flip", { first: "rotate-pdf" }, "syn"],
  ["rotate", { first: "rotate-pdf" }],
  ["join", { first: "merge-pdf" }],
  ["pdf to doc", { first: "pdf-to-word" }, "syn"],
  ["split pages", { first: "split-pdf" }],
  ["word", { top: ["word-to-pdf", "pdf-to-word"] }],
  ["heic", { unsupported: "HEIC", never: NO_WEBPAGE }],
  ["webp", { unsupported: "WEBP", never: NO_WEBPAGE }],
  // Misspellings: one edit, a swap counting as one.
  ["mrege", { first: "merge-pdf" }],
  ["comprss pdf", { first: "compress-pdf" }],
  ["spilt pdf", { first: "split-pdf" }],
  // A synonym row per group: each fails if its group is taken away.
  ["minify pdf", { first: "compress-pdf" }, "syn"],
  ["lighter pdf", { first: "compress-pdf" }, "syn"],
  ["append pdfs", { first: "merge-pdf" }, "syn"],
  ["burst pdf", { first: "split-pdf" }, "syn"],
  ["esignature", { first: "sign-pdf" }, "syn"],
  ["scanned to text", { first: "ocr-pdf" }, "syn"],
  ["unprotect pdf", { first: "unlock-pdf" }, "syn"],
  ["lock pdf", { first: "protect-pdf" }, "syn"],
  ["pdf to xls", { first: "pdf-to-excel" }, "syn"],
  ["pdf to ppt", { first: "pdf-to-powerpoint" }, "syn"],
  ["picture to pdf", { first: "jpg-to-pdf" }, "syn"],
  ["censor pdf", { first: "redact-pdf" }, "syn"],
  ["arrange pages", { first: "organize-pages" }, "syn"],
  ["recap pdf", { first: "summarize-pdf" }, "syn"],
  ["pdf chatbot", { first: "chat-with-pdf" }, "syn"],
  ["link to pdf", { first: "webpage-to-pdf" }, "syn"],
  ["monochrome pdf", { first: "grayscale-pdf" }, "syn"],
  ["pdf borders", { first: "crop-pdf" }, "syn"],
  ["restore pdf", { first: "repair-pdf" }, "syn"],
  ["archival pdf", { first: "pdf-to-pdfa" }, "syn"],
  ["paginate", { first: "page-numbers" }, "syn"],
  ["erase pages", { first: "remove-pages" }, "syn"],
  ["pdf translator", { first: "translate-pdf" }, "syn"],
  ["comment on pdf", { first: "annotate-pdf" }, "syn"],
  ["modify pdf", { first: "edit-pdf" }, "syn"],
  // Phrases people use whole.
  ["password", { first: "protect-pdf" }],
  ["e-sign a pdf", { first: "sign-pdf" }],
  ["trim the margins", { first: "crop-pdf" }],
  ["broken pdf", { first: "repair-pdf" }],
  ["remove password", { first: "unlock-pdf" }],
  ["black and white", { first: "grayscale-pdf" }],
  ["black out text", { first: "redact-pdf" }],
  ["make a scan searchable", { first: "ocr-pdf" }],
  ["photos to pdf", { first: "jpg-to-pdf" }],
  ["chat with pdf", { first: "chat-with-pdf" }],
  ["signature", { first: "sign-pdf" }],
  ["sign", { first: "sign-pdf" }],
  ["ocr", { first: "ocr-pdf" }],
  ["excel to pdf", { first: "excel-to-pdf" }],
  ["pdf to excel", { first: "pdf-to-excel" }],
  ["png to pdf", { first: "png-to-pdf" }],
  ["pdf to png", { first: "pdf-to-png" }],
  ["md to pdf", { first: "markdown-to-pdf" }],
  ["pdf to markdown", { first: "pdf-to-markdown" }],
  ["txt to pdf", { first: "text-to-pdf" }],
  ["html to pdf", { first: "html-to-pdf" }],
  ["url to pdf", { first: "webpage-to-pdf" }],
  ["website to pdf", { first: "webpage-to-pdf" }],
  ["extract text", { first: "pdf-to-text" }],
  ["page numbers", { first: "page-numbers" }],
  ["watermark", { first: "watermark-pdf" }],
  ["fill form", { first: "fill-forms" }],
  ["tables to excel", { first: "extract-tables" }],
  ["invoice", { first: "ai-extract" }],
  ["letterhead", { first: "overlay-pdf" }],
  ["compare", { first: "compare-pdf" }],
  // The fallback, labelled as such, and only on evidence.
  ["merge zzqx", { closest: "merge-pdf" }],
  ["heic to pdf", { unsupported: "HEIC", never: NO_WEBPAGE }],
  ["zzzzzxyq", { empty: true }],
  ["???", { empty: true }],
];

/** Why `row` fails against `index`, or null when it passes. */
function miss(
  index: SearchIndex<ToolDoc<Tool>>,
  [query, expected]: Row,
): string | null {
  const { results, mode, unsupported } = search(index, query);
  const slugs = results.map((doc) => doc.id);
  const got = `${mode} [${slugs.slice(0, 3).join(", ")}]`;
  if ("first" in expected) {
    return mode === "all" && slugs[0] === expected.first
      ? null
      : `${query}: want ${expected.first} first, got ${got}`;
  }
  if ("top" in expected) {
    const top = slugs.slice(0, expected.top.length).sort();
    return mode === "all" &&
      JSON.stringify(top) === JSON.stringify([...expected.top].sort())
      ? null
      : `${query}: want top ${expected.top.join(" + ")}, got ${got}`;
  }
  if ("closest" in expected) {
    return mode === "closest" && slugs[0] === expected.closest
      ? null
      : `${query}: want closest ${expected.closest}, got ${got}`;
  }
  if ("unsupported" in expected) {
    const leaked = slugs.filter((slug) => expected.never.includes(slug));
    return unsupported === expected.unsupported && leaked.length === 0
      ? null
      : `${query}: want the ${expected.unsupported} answer and none of ${expected.never.join(", ")}, got ${unsupported} ${got}`;
  }
  return mode === "empty" && slugs.length === 0
    ? null
    : `${query}: want empty, got ${got}`;
}

describe("the search corpus", () => {
  const index = toolSearchIndex();

  it("is a corpus worth the name (size floors, explicit and derived)", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(40);
    // With the derived rows (one per tool name above, one per keyword phrase
    // below) the whole corpus clears the 90-row floor several times over.
    expect(CORPUS.length + tools.length).toBeGreaterThanOrEqual(90);
  });

  it.each(CORPUS.map((row) => [row[0], row] as const))("%s", (_, row) => {
    expect(miss(index, row)).toBeNull();
  });

  it("a query that IS a tool's keyword phrase, word for word, names that tool first", () => {
    // Derived over every keyword in the catalogue. The 404 relies on it:
    // /tools/pdf-to-docx must suggest PDF to Word, whose keyword it spells,
    // and not Word to PDF, which holds the same two words. A phrase two tools
    // share ("image to pdf") names one of them.
    // Phrases are compared as the search reads them (plurals folded), so
    // "save pages" and "save page" are one phrase that two tools share.
    const owners = new Map<string, Set<string>>();
    for (const tool of tools) {
      for (const keyword of tool.keywords) {
        const key = wordsOf(keyword).join(" ");
        owners.set(key, (owners.get(key) ?? new Set()).add(tool.slug));
      }
    }
    expect(owners.size).toBeGreaterThanOrEqual(100);
    const misses = [...owners].filter(([phrase, slugs]) => {
      const first = search(index, phrase).results[0]?.id;
      return !first || !slugs.has(first);
    });
    expect(misses.map(([phrase]) => phrase)).toEqual([]);
  });

  it("answers a query over the whole catalogue in well under 2 ms", () => {
    // A generous bound, on purpose (CI machines are slower than a laptop);
    // a regression to a per-keystroke cost a person can feel still fails it.
    const queries = CORPUS.map(([query]) => query);
    for (const query of queries) search(index, query);
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      for (const query of queries) search(index, query);
    }
    const perQuery = (performance.now() - start) / (queries.length * 5);
    expect(perQuery).toBeLessThan(2);
  });
});

describe("every synonym group earns its place, and every synonym row needs one", () => {
  const docs = toolDocs(tools);

  it("finds the groups (health)", () => {
    expect(SYNONYM_GROUPS.length).toBeGreaterThanOrEqual(20);
    expect(
      CORPUS.filter(([, , via]) => via === "syn").length,
    ).toBeGreaterThanOrEqual(SYNONYM_GROUPS.length);
  });

  it("each group is exercised: some corpus row fails without it", () => {
    // Rule 1, first direction: a group no row needs is decoration, and a
    // list of decorations stops meaning anything.
    const idle = SYNONYM_GROUPS.filter((group) => {
      const without = buildIndex(docs, {
        synonyms: SYNONYM_GROUPS.filter((g) => g !== group),
      });
      return CORPUS.every((row) => miss(without, row) === null);
    }).map((group) => group[0]);
    expect(idle).toEqual([]);
  });

  it("each row filed as a synonym row fails with no synonyms at all", () => {
    // The other direction: a row that passes on the catalogue's own words is
    // not evidence for any group, and filing it as one would let a group look
    // exercised when nothing needs it.
    const bare = buildIndex(docs, { synonyms: [] });
    const unearned = CORPUS.filter(
      (row) => row[2] === "syn" && miss(bare, row) === null,
    ).map(([query]) => query);
    expect(unearned).toEqual([]);
  });

  it("positive control: removing the rotate group fails the row it was built for", () => {
    const without = buildIndex(docs, {
      synonyms: SYNONYM_GROUPS.filter((g) => g[0] !== "rotate"),
    });
    expect(miss(without, ["flip", { first: "rotate-pdf" }])).not.toBeNull();
  });
});
