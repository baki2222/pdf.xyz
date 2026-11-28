import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine-errors";
import {
  PDFJS_BOARD_MAX_PAGES,
  PDFJS_BOARD_MAX_WALK,
  PDF_PAGE_TREE_TOO_COSTLY_MESSAGE,
  SPLIT_TOOL_NAME,
  type PageTreeCost,
  boardPageLimitMessage,
  pageTreeWalk,
  pdfjsBoardPageCount,
} from "@/lib/pdf/pdfjs-guard";
import { expectRatioBelow, measureTime } from "../time-bound";
import { runBounded, type BoundedOutcome } from "./bounded";

/**
 * The upload board of every reader:'pdfjs' tool (PDF Viewer, PDF to JPG/PNG,
 * PDF to Text, PDF to Markdown) on a page tree too big to walk.
 *
 * History (PDF Viewer review, PR #310): a 100,000-page PDF (28.9 MB, under
 * the file ceiling) sat on "Reading your PDF…" for minutes on every such
 * page. The board fetched every page for its rotation, and pdf.js finds page
 * i by walking the tree from its root: on a flat tree that is O(pages) per
 * page. Measured on base, a flat tree: 10,000 pages 3.6-5.4 s, 20,000 13.1
 * s, 40,000 63.7 s, 100,000 still reading when killed. The board now refuses
 * a file past PDFJS_BOARD_MAX_PAGES, typed, before any page is fetched.
 *
 * Second history (hostile review, 2026-11-10): that bound was on the page
 * count pdf.js reports, which is the root /Count — a number the file states
 * — while the walk's cost is the /Kids the file CONTAINS. A /Count of 10,000
 * over a root /Kids of 1,000,000 copies of one page (7 MB) read for 127 s;
 * 10,000 real pages under a chain of /Pages nodes with every /Count true,
 * 29-50 s; an inner node with no /Count, or a /Count lower than the real
 * tree, the same. The docblock said "past it no tree shape can cost more than
 * this many pages squared, which is seconds", and these tests built only
 * flat and 32-ary trees, so nothing here could disagree. The board now also
 * refuses a tree whose walk the preflight's count of its /Kids puts past
 * PDFJS_BOARD_MAX_WALK, and the worst shapes found are held below, both past
 * the bound (refused) and AT it (read, in seconds).
 *
 * Run in a child (./bounded) with a hard kill: the walk is pdf.js's own and
 * no in-process timeout interrupts it.
 */
const CHILD = "src/tests/hostile/pdfjs-board-pages.child.ts";
const GROWTH_MB = 300;

/** Every PDF in the legit corpus, found by reading the directory. */
const CORPUS_FILES = readdirSync(
  path.join(process.cwd(), "src/tests/fixtures/legit-corpus"),
)
  .filter((f) => f.toLowerCase().endsWith(".pdf"))
  .sort();

/** Pages with /Rotate 90 in a child fixture of `pages` (index % 7 === 3). */
const rotatedIn = (pages: number) =>
  pages >= 4 ? Math.floor((pages - 4) / 7) + 1 : 0;

function settled(r: BoundedOutcome): Record<string, unknown> {
  expect(r, JSON.stringify(r).slice(0, 600)).toMatchObject({
    kind: "settled",
  });
  return (r as { value: Record<string, unknown> }).value;
}

const refusal = (pages: number) => ({
  name: "PdfEngineError",
  typed: true,
  message: boardPageLimitMessage(pages),
});

const treeRefusal = {
  name: "PdfEngineError",
  typed: true,
  message: PDF_PAGE_TREE_TOO_COSTLY_MESSAGE,
};

/** A tree no lookup costs anything on: what the page-limit unit tests pass. */
const EMPTY: PageTreeCost = { entries: 0, nodes: 0 };

/** The charge the preflight's count of a child fixture puts on `pages` lookups. */
function charge(v: Record<string, unknown>, pages: number): number {
  const tree = v.tree as { entries: number | null; nodes: number } | undefined;
  // Health: the child read the preflight's counts (Infinity arrives as null).
  expect(tree, JSON.stringify(v).slice(0, 300)).toBeTruthy();
  return pageTreeWalk(pages, {
    entries: tree!.entries ?? Number.POSITIVE_INFINITY,
    nodes: tree!.nodes,
  });
}

describe("the reader:'pdfjs' board reaches an outcome on a page tree of any size", () => {
  test("the refusal's copy states the file's pages, the limit and what to do, each read from its source", () => {
    const limit = PDFJS_BOARD_MAX_PAGES.toLocaleString("en-US");
    const copy = boardPageLimitMessage(123_456);
    expect(copy).toContain("123,456 pages");
    expect(copy).toContain(`more than the ${limit}`);
    expect(copy).toContain(`parts of ${limit} pages or fewer`);
    // The way out is named, so the alert links it (ErrorNote).
    expect(copy).toContain(SPLIT_TOOL_NAME);
    expect(PDF_PAGE_TREE_TOO_COSTLY_MESSAGE).toContain(SPLIT_TOOL_NAME);
    // Health: the figure it quotes is the bound the test below enforces.
    expect(PDFJS_BOARD_MAX_PAGES).toBe(10_000);
  });

  test("the bound is inclusive, and a /Count pdf.js reads below 1 is still the unreadable refusal", () => {
    expect(pdfjsBoardPageCount(PDFJS_BOARD_MAX_PAGES, EMPTY)).toBe(
      PDFJS_BOARD_MAX_PAGES,
    );
    expect(pdfjsBoardPageCount(1, EMPTY)).toBe(1);
    expect(() => pdfjsBoardPageCount(PDFJS_BOARD_MAX_PAGES + 1, EMPTY)).toThrow(
      boardPageLimitMessage(PDFJS_BOARD_MAX_PAGES + 1),
    );
    expect(() => pdfjsBoardPageCount(0, EMPTY)).toThrow(UNREADABLE_PDF_MESSAGE);
    expect(() => pdfjsBoardPageCount(-1, EMPTY)).toThrow(
      UNREADABLE_PDF_MESSAGE,
    );
  });

  test("the walk bound is inclusive, charges every /Kids element and node, and an unknown tree is refused", () => {
    // One page whose single lookup is exactly the budget: read.
    expect(
      pdfjsBoardPageCount(1, { entries: PDFJS_BOARD_MAX_WALK, nodes: 0 }),
    ).toBe(1);
    expect(() =>
      pdfjsBoardPageCount(1, { entries: PDFJS_BOARD_MAX_WALK + 1, nodes: 0 }),
    ).toThrow(PDF_PAGE_TREE_TOO_COSTLY_MESSAGE);
    // The product: 2 lookups of half the budget each is the budget.
    const half = PDFJS_BOARD_MAX_WALK / 2;
    expect(pdfjsBoardPageCount(2, { entries: half, nodes: 0 })).toBe(2);
    expect(() => pdfjsBoardPageCount(3, { entries: half, nodes: 0 })).toThrow(
      PDF_PAGE_TREE_TOO_COSTLY_MESSAGE,
    );
    // Nodes are charged too: a tree of nodes alone can be refused.
    expect(() =>
      pdfjsBoardPageCount(1, { entries: 0, nodes: PDFJS_BOARD_MAX_WALK }),
    ).toThrow(PDF_PAGE_TREE_TOO_COSTLY_MESSAGE);
    expect(() =>
      pdfjsBoardPageCount(1, { entries: Number.POSITIVE_INFINITY, nodes: 1 }),
    ).toThrow(PDF_PAGE_TREE_TOO_COSTLY_MESSAGE);
    // The page limit speaks first: its copy says what the user can act on.
    expect(() =>
      pdfjsBoardPageCount(PDFJS_BOARD_MAX_PAGES + 1, {
        entries: Number.POSITIVE_INFINITY,
        nodes: 1,
      }),
    ).toThrow(boardPageLimitMessage(PDFJS_BOARD_MAX_PAGES + 1));
  });

  test("a flat 100,000-page tree is refused, typed, in seconds — not read for minutes", async () => {
    const v = settled(await runBounded(CHILD, ["flat:100000"], 60_000));
    expect(v.error).toMatchObject(refusal(100_000));
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test(`a flat tree one page past the limit (${PDFJS_BOARD_MAX_PAGES + 1}) is refused before any page is fetched`, async () => {
    const pages = PDFJS_BOARD_MAX_PAGES + 1;
    const v = settled(await runBounded(CHILD, [`flat:${pages}`], 60_000));
    expect(v.error).toMatchObject(refusal(pages));
  }, 90_000);

  test("past the limit the outcome costs what the file's bytes cost, not pages squared", async () => {
    // One child, both sizes alternated three times, each call on a fresh
    // copy so its preflight really runs (CI-flake audit lane 2). It WAS one
    // sample of each from two children run one after the other, under a
    // 250 ms floor that made it an absolute 7.5 s bound: CI's test reached
    // 9,354 ms (43998624497), so the data could not rule out a red. The
    // pair is six opens, an estimated 17 s at worst on CI: kill 120 s.
    const small = PDFJS_BOARD_MAX_PAGES + 1;
    const v = settled(
      await runBounded(CHILD, [`pair:${small}:100000:3`], 120_000),
    );
    const got = v as {
      controlFetched: number;
      fetched: number[];
      smallMs: number[];
      bigMs: number[];
      entries: number[];
      typed: boolean[];
      bytes: { small: number; big: number };
      calls: number;
      distinctPreflights: number;
    };
    // Health: every call's preflight ran and counted its own tree, and
    // every call was refused, typed.
    const counted = got.entries;
    expect(counted).toEqual([small, 100_000, small, 100_000, small, 100_000]);
    expect(got.typed).toEqual(Array(6).fill(true));
    // One preflight answer per call: none was the guard's cached answer.
    expect(got.distinctPreflights).toBe(got.calls);
    expect(got.calls).toBeGreaterThanOrEqual(6);
    // The second file really is ten times the first.
    expect(got.bytes.big / got.bytes.small).toBeGreaterThan(9);
    // Pages squared is pdf.js walking the tree page by page, so it is a
    // count (review 2026-11-22): past the limit no page is fetched, on any
    // runner; a board that fetched even 500 of them before refusing read
    // ratio 15, inside 30, with `counted` unchanged. Positive control: the
    // 3-page read in the same child fetched at least its 3 pages.
    expect(got.controlFetched).toBeGreaterThanOrEqual(3);
    const pagesFetched = got.fetched;
    expect(pagesFetched).toEqual(Array(6).fill(0));
    // Ten times the pages: about ten times the bytes to parse, where a walk
    // would cost a hundred times. Best of 3 samples each, every sample at
    // least 100 ms of calls (the old 250 ms floor on the small side is no
    // longer needed). Measure mode until harvested.
    const bigMs = Math.min(...got.bigMs);
    const smallMs = Math.min(...got.smallMs);
    expectRatioBelow("board-pages-past-limit", bigMs, smallMs, 30, {
      detail: `big ${got.bigMs.map(Math.round).join("/")} ms, small ${got.smallMs.map(Math.round).join("/")} ms`,
      mode: "measure",
      witness: "pagesFetched",
    });
  }, 150_000);

  test(`positive control at the bound: a flat tree of exactly ${PDFJS_BOARD_MAX_PAGES} pages still loads, every rotation read`, async () => {
    // What pdf-lib writes, at the largest count the board takes: 2.9-3.5 s
    // (Windows, Node 24). CI is slower; the bound is the hang's, not a race.
    const v = settled(
      await runBounded(CHILD, [`flat:${PDFJS_BOARD_MAX_PAGES}`], 120_000),
    );
    expect(v).toMatchObject({
      ok: true,
      pageCount: PDFJS_BOARD_MAX_PAGES,
      rotationCount: PDFJS_BOARD_MAX_PAGES,
      rotated: rotatedIn(PDFJS_BOARD_MAX_PAGES),
    });
  }, 150_000);

  test("positive control: a balanced tree at the bound loads, every rotation read", async () => {
    const v = settled(
      await runBounded(CHILD, [`balanced:${PDFJS_BOARD_MAX_PAGES}`], 60_000),
    );
    expect(v).toMatchObject({
      ok: true,
      pageCount: PDFJS_BOARD_MAX_PAGES,
      rotated: rotatedIn(PDFJS_BOARD_MAX_PAGES),
    });
  }, 90_000);

  test.each(CORPUS_FILES)(
    "positive control: legit-corpus %s gets the same board pdf-lib reads",
    async (file) => {
      const v = settled(await runBounded(CHILD, [`corpus:${file}`], 60_000));
      expect(v.ok).toBe(true);
      // An independent reader of the same tree: pdf-lib's rotations.
      expect(v.rotations).toEqual(v.pdfLibRotations);
      expect(v.pageCount).toBe((v.pdfLibRotations as unknown[]).length);
      // The preflight's count sees the tree: every page is an element of
      // some /Kids, and some node holds them.
      const tree = v.tree as PageTreeCost;
      expect(tree.entries).toBeGreaterThanOrEqual(v.pageCount as number);
      expect(tree.nodes).toBeGreaterThanOrEqual(1);
    },
    90_000,
  );

  test("the legit corpus is found, not named: every file in it, and no fewer than it holds today", () => {
    // Health (CLAUDE.md rule 4): a directory that quietly emptied, or a
    // filter that matched nothing, would make the controls above vacuous.
    expect(CORPUS_FILES.length).toBeGreaterThanOrEqual(14);
    expect(CORPUS_FILES).toEqual(
      expect.arrayContaining(["gs-ebook-long.pdf", "qpdf-rotated.pdf"]),
    );
  });

  test("the legit-corpus controls are not vacuous: 13 pages, and one rotated page", async () => {
    const long = settled(
      await runBounded(CHILD, ["corpus:gs-ebook-long.pdf"], 60_000),
    );
    const rotated = settled(
      await runBounded(CHILD, ["corpus:qpdf-rotated.pdf"], 60_000),
    );
    expect(long).toMatchObject({ ok: true, pageCount: 13 });
    expect(rotated).toMatchObject({ ok: true, rotations: [90, 0] });
  }, 120_000);
});

/**
 * The trees whose cost the declared page count does not show. Each refused
 * case's charge is held past the bound too (so a refusal for some other
 * reason cannot pass), and each control AT the bound is held within 5 %
 * under it (so a control far below the bound cannot pass for one at it).
 */
describe("the board's walk is bounded by the /Kids the file contains, not by its /Count", () => {
  const PAST = [
    // [case, the page count pdf.js reports, what it is]
    ["lie:10000:10000:1000000", 10_000, "a million repeats of one page"],
    ["lie:10000:60000", 10_000, "/Count 10,000 over 60,000 real pages"],
    ["uncounted:10000:60000", 10_000, "an inner node with no /Count"],
    ["chain:10000", 10_000, "a chain, every /Count true"],
    ["objstm:10000x10000x1000000", 10_000, "the padded root, object stream"],
    ["indirect:10000x10000x1000000", 10_000, "the padded /Kids, array object"],
    ["indirstm:10000x10000x1000000", 10_000, "that array, object stream"],
    ["stringy:10000x10000x1000000", 10_000, "a ] in a string, then padding"],
  ] as const;

  test.each(PAST)(
    "%s (%s pages reported; %s) is refused, typed, in seconds",
    async (c, pages) => {
      const v = settled(await runBounded(CHILD, [c], 60_000));
      expect(v.error).toMatchObject(treeRefusal);
      // Kept raw (review 2026-11-22): never flaky (absent from CI's >300 ms
      // list in all 12 runs of 2026-11-18, so 20 s is over 66x), and the
      // refusal's type is the same however long it took to reach.
      expect(v.ms as number).toBeLessThan(20_000);
      // Refused for its tree: the count puts it past the bound.
      expect(charge(v, pages)).toBeGreaterThan(PDFJS_BOARD_MAX_WALK);
    },
    90_000,
  );

  const AT = [
    // [case, pages] — the worst shapes found, sized to just under the bound.
    ["lie:10000:10000:9970", 10_000],
    ["lie:10000:19950", 10_000],
    ["uncounted:10000:19950", 10_000],
    ["chain:3015", 3_015],
  ] as const;

  test.each(AT)(
    "positive control at the walk bound: %s still loads, every rotation read",
    async (c, pages) => {
      const v = settled(await runBounded(CHILD, [c], 120_000));
      expect(v).toMatchObject({
        ok: true,
        pageCount: pages,
        rotationCount: pages,
        rotated: rotatedIn(pages),
      });
      // An absolute promise, kept as one (CI-flake audit lane 2): it is the
      // only check that sees a uniform slowdown of pdf.js's walk. CI read
      // 4.2-21.0 s across the four cases (lie:10000:19950 21,024 ms, run
      // 43629904891-era logs, 27 of them): 2.85x. Printed on every pass.
      // No count sees a uniform slowdown, by its nature: the page count was
      // named as a witness once and stayed equal under a 3 ms-per-page spin
      // (witness audit, 2026-11-22). So the record is pending
      // (wall-clock-pending.ts), and the raw bound below is what fails.
      measureTime("board-pages-at-walk-bound", v.ms as number, 60_000, {
        instance: c,
      });
      expect(v.ms as number).toBeLessThan(60_000);
      const walk = charge(v, pages);
      expect(walk).toBeLessThanOrEqual(PDFJS_BOARD_MAX_WALK);
      expect(walk).toBeGreaterThan(PDFJS_BOARD_MAX_WALK * 0.95);
    },
    150_000,
  );

  test.each([
    "objstm:10000x10000x0",
    "indirect:10000x10000x0",
    "indirstm:10000x10000x0",
  ])(
    "the honest neighbour %s loads: an array is counted where pdf.js finds it",
    async (c) => {
      const v = settled(await runBounded(CHILD, [c], 120_000));
      expect(v).toMatchObject({ ok: true, pageCount: 10_000 });
      // Counted, not bounded by the size of the stream that holds it.
      expect((v.tree as PageTreeCost).entries).toBeLessThan(10_100);
      expect((v.tree as PageTreeCost).entries).toBeGreaterThanOrEqual(10_000);
    },
    150_000,
  );
});
