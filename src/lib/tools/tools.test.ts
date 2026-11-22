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
import { rankTools, searchTools, toolSearchIndex } from "./search-tools";
import type { Tool } from "./types";
import { expectFasterThan, expectRatioBelow } from "@/tests/time-bound";

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

  it("finds the Office to PDF tool by each format it takes, keywords or not", () => {
    // Added 2026-11-04 with ODT, RTF, ODS and ODP, which carry no keyword of
    // their own: the search's formats field is the catalogue's `accept`.
    const firstFor = (query: string) => searchTools(query)[0]?.slug;
    for (const slug of ["word-to-pdf", "excel-to-pdf", "powerpoint-to-pdf"]) {
      const accept = tools.find((t) => t.slug === slug)!.accept;
      expect(accept.length).toBeGreaterThanOrEqual(3);
      for (const format of accept)
        expect(firstFor(`${format.toLowerCase()} to pdf`), format).toBe(slug);
    }
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
  // INVERTED 2026-10-30: "webp" was `{ unsupported: "WEBP" }` while no tool
  // opened WebP. JPG / PNG to PDF now decode it, so the search must lead
  // there. "tiff" kept the unsupported answer's second row until 2026-11-04
  // (INVERTED: JPG / PNG to PDF read TIFF); AVIF holds it now.
  ["webp", { top: ["jpg-to-pdf", "png-to-pdf"], never: NO_WEBPAGE }],
  ["tiff", { top: ["jpg-to-pdf", "png-to-pdf"], never: NO_WEBPAGE }],
  ["avif", { unsupported: "AVIF", never: NO_WEBPAGE }],
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

/**
 * ADDED 2026-11-15 (Compare PDF S4): Compare PDF's outputs are TXT and HTML
 * now (its redline), and the search reads a tool's formats as accept ∪
 * outputs, so "html" and "pdf to html" list it too, after HTML to PDF —
 * true, since it writes HTML from PDFs, and accepted (as "pdf to txt" already
 * listed it). Pinned so it never leads a conversion query.
 */
describe("Compare PDF's HTML redline in the search", () => {
  const index = toolSearchIndex();
  const slugs = (q: string) => search(index, q).results.map((d) => d.id);

  it.each(["html", "pdf to html", "html to pdf"])(
    "%s: HTML to PDF first, Compare PDF listed after it",
    (q) => {
      const got = slugs(q);
      expect(got[0], q).toBe("html-to-pdf");
      expect(got.slice(1), q).toContain("compare-pdf");
    },
  );

  it("Compare PDF never leads a conversion query", () => {
    for (const q of [
      "pdf to html",
      "html to pdf",
      "convert pdf to html",
      "pdf to txt",
      "pdf to text",
      "convert pdf to txt",
      "txt",
    ])
      expect(slugs(q)[0], q).not.toBe("compare-pdf");
  });
});

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

  /**
   * WAS `perQuery < 2` ms: one mean of 445 searches against a constant, the
   * verdict set by the runner (ci-flake audit 2026-11-19, tools.test.ts:376).
   * A search that rebuilt the index per keystroke cost 1.28 ms a query on
   * the dev host — green there, red only on a CI runner slow enough.
   *
   * Now two parts. The speed-independent one, `readsKept`: every call of
   * the two public search paths READS the one kept index. The explorer's
   * per-keystroke call is `rankTools` (tools-explorer.tsx), and the 404's
   * "Did you mean" calls `searchTools` (path-suggest.ts). The kept index's
   * `entries` is swapped for a counting getter while both paths run over
   * the corpus, so a path that searched any other index, a fresh build per
   * keystroke included, leaves its calls unread. Mutants (verify
   * 2026-11-22, each on a copy of search-tools.ts): `search(toolSearchIndex(),
   * query)` in `searchTools` made `search(buildIndex(toolDocs(tools)), query)`
   * read the kept index 0 times in 89 calls (honest: 3,329) and is red here,
   * where the earlier `kept` (the memo's identity alone) stayed green at
   * 1.21x of 0.25x; the same bypass in `rankTools` read 0 in 89 (honest:
   * 3,329); `index ??=` made `index =` fails the identity check above it.
   * A slowdown inside `search` itself has no
   * count; only the records below see it, and they record. The timed one: a
   * query against a whole build of the index, same run, interleaved,
   * time-boxed samples, best per call. A search that holds a build inside it
   * reads 1 or more by construction (dev host: 1.01-1.08); the honest search
   * reads 0.06 there. Measure mode until CI calibrates it: no CI figure
   * exists for this ratio yet (the test never printed a number; its
   * whole-test time stayed under the reporter's 300 ms floor in all 26 CI
   * runs read, 2026-11-18..21).
   */
  it("answers a query over the whole catalogue in a small fraction of building it", () => {
    const again = toolSearchIndex();
    expect(again).toBe(index);
    const queries = CORPUS.map(([query]) => query);
    expect(queries.length).toBeGreaterThanOrEqual(40);
    const reads = readsOfKeptIndex(again, () => {
      for (const query of queries) searchTools(query);
    });
    const rankReads = readsOfKeptIndex(again, () => {
      for (const query of queries) rankTools(query);
    });
    // Positive control: the counter itself sees a search of the kept index.
    expect(
      readsOfKeptIndex(again, () => search(again, "merge")),
    ).toBeGreaterThan(0);
    const readsKept = reads >= queries.length && rankReads >= queries.length;
    expect(
      readsKept,
      `kept index read ${reads} times by ${queries.length} searchTools calls, ${rankReads} by as many rankTools calls`,
    ).toBe(true);
    // `builds`, the witness of both records below: how many index builds the
    // two public paths ran over the whole corpus. `readsKept` alone cannot
    // see a build BESIDE the kept index (witness audit 2026-11-22: a copy of
    // search-tools.ts with `void buildIndex(toolDocs(tools));` before the
    // search in `searchTools` kept `readsKept` true and every query paid a
    // full build). Every build spreads every doc's keywords, so it iterates
    // the first tool's keywords array, cached docs or fresh; a search never
    // does. Positive control first: one build is counted.
    expect(buildsDuring(() => buildIndex(toolDocs(tools)))).toBeGreaterThan(0);
    const builds = buildsDuring(() => {
      for (const query of queries) {
        searchTools(query);
        rankTools(query);
      }
    });
    expect(builds, "index builds during the corpus's searches").toBe(0);
    const docs = toolDocs(tools);
    const sides = [
      () => buildIndex(docs),
      // Through `searchTools`, a public per-query path, so the timed path is
      // one `readsKept` counted (review 2026-11-22: timing `search(index, q)`
      // over a prebuilt index never reached the memo).
      () => {
        for (const query of queries) searchTools(query);
        return queries.length;
      },
    ] as const;
    // Warm both: the first build and the first pass pay compilation.
    sides[0]();
    sides[1]();
    const best = [Infinity, Infinity];
    for (let round = 0; round < 3; round++)
      sides.forEach((side, i) => {
        let calls = 0;
        let spent = 0;
        const t0 = performance.now();
        do {
          side();
          calls += 1;
          spent = performance.now() - t0;
        } while (spent < SAMPLE_MS);
        best[i] = Math.min(best[i]!, spent / calls);
      });
    const buildMs = best[0]!;
    const queryMs = best[1]! / queries.length;
    expectRatioBelow("tools-search-query-vs-build", queryMs, buildMs, 0.25, {
      mode: "measure",
      witness: "builds",
      detail: `per query ${queryMs.toPrecision(3)} ms, per build ${buildMs.toPrecision(3)} ms`,
    });
    // The person-facing promise: one query well inside a 60 Hz frame.
    expectFasterThan("tools-search-query-frame", queryMs, 16, {
      mode: "measure",
      witness: "builds",
    });
  });
});

/**
 * How many times `run` iterates the first tool's keywords array: once per
 * index build (`buildIndex` spreads each doc's keywords, and a doc holds the
 * tool's own array). An own `Symbol.iterator` is set on that array for the
 * length of `run`, then removed.
 */
function buildsDuring(run: () => unknown): number {
  const keywords = tools[0]!.keywords as string[];
  if (keywords.length === 0 || Object.isFrozen(keywords))
    throw new Error("the first tool's keywords cannot carry a counter");
  if (Object.prototype.hasOwnProperty.call(keywords, Symbol.iterator))
    throw new Error("the keywords array already has its own iterator");
  const values = Array.prototype[Symbol.iterator];
  let builds = 0;
  Object.defineProperty(keywords, Symbol.iterator, {
    configurable: true,
    value(this: string[]) {
      builds += 1;
      return values.call(this);
    },
  });
  try {
    run();
  } finally {
    delete (keywords as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  }
  return builds;
}

/** One time-boxed sample: at least this long, so a timer tick is noise. */
const SAMPLE_MS = 100;

/**
 * How often `run` reads the kept index's `entries` (every `search` of an
 * index reads it once). The property is swapped for a counting getter on
 * the module's own index object for the length of `run`, then put back as
 * as it was; a search of any other index is not counted.
 */
function readsOfKeptIndex(
  kept: SearchIndex<ToolDoc<Tool>>,
  run: () => unknown,
): number {
  const own = Object.getOwnPropertyDescriptor(kept, "entries");
  if (!own || !("value" in own))
    throw new Error("index.entries is not a data property");
  const entries = kept.entries;
  let reads = 0;
  Object.defineProperty(kept, "entries", {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      return entries;
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(kept, "entries", own);
  }
  return reads;
}

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
