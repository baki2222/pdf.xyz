import { describe, expect, test } from "vitest";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine-errors";
import {
  PDFJS_BOARD_MAX_PAGES,
  boardPageLimitMessage,
  pdfjsBoardPageCount,
} from "@/lib/pdf/pdfjs-guard";
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
 * Run in a child (./bounded) with a hard kill: the walk is pdf.js's own and
 * no in-process timeout interrupts it.
 */
const CHILD = "src/tests/hostile/pdfjs-board-pages.child.ts";
const GROWTH_MB = 300;

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

describe("the reader:'pdfjs' board reaches an outcome on a page tree of any size", () => {
  test("the refusal's copy states the file's pages, the limit and what to do, each read from its source", () => {
    const limit = PDFJS_BOARD_MAX_PAGES.toLocaleString("en-US");
    const copy = boardPageLimitMessage(123_456);
    expect(copy).toContain("123,456 pages");
    expect(copy).toContain(`more than the ${limit}`);
    expect(copy).toContain(`parts of ${limit} pages or fewer`);
    // Health: the figure it quotes is the bound the test below enforces.
    expect(PDFJS_BOARD_MAX_PAGES).toBe(10_000);
  });

  test("the bound is inclusive, and a /Count pdf.js reads below 1 is still the unreadable refusal", () => {
    expect(pdfjsBoardPageCount(PDFJS_BOARD_MAX_PAGES)).toBe(
      PDFJS_BOARD_MAX_PAGES,
    );
    expect(pdfjsBoardPageCount(1)).toBe(1);
    expect(() => pdfjsBoardPageCount(PDFJS_BOARD_MAX_PAGES + 1)).toThrow(
      boardPageLimitMessage(PDFJS_BOARD_MAX_PAGES + 1),
    );
    expect(() => pdfjsBoardPageCount(0)).toThrow(UNREADABLE_PDF_MESSAGE);
    expect(() => pdfjsBoardPageCount(-1)).toThrow(UNREADABLE_PDF_MESSAGE);
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
    const small = settled(
      await runBounded(CHILD, [`flat:${PDFJS_BOARD_MAX_PAGES + 1}`], 60_000),
    );
    const big = settled(await runBounded(CHILD, ["flat:100000"], 60_000));
    expect(small.error).toMatchObject({ typed: true });
    expect(big.error).toMatchObject({ typed: true });
    // Health: the second file really is ten times the first.
    expect((big.bytes as number) / (small.bytes as number)).toBeGreaterThan(9);
    // Ten times the pages: about ten times the bytes to parse, where a walk
    // would cost a hundred times. A floor on the small one keeps a fast run's
    // few milliseconds from making the ratio noise.
    const ratio = (big.ms as number) / Math.max(small.ms as number, 250);
    expect(ratio, `${big.ms} ms vs ${small.ms} ms`).toBeLessThan(30);
  }, 150_000);

  test(`positive control at the bound: a flat tree of exactly ${PDFJS_BOARD_MAX_PAGES} pages still loads, every rotation read`, async () => {
    // The worst shape at the largest count the board takes: 3.5 s on base
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

  test.each(["gs-ebook-long.pdf", "qpdf-rotated.pdf"])(
    "positive control: legit-corpus %s gets the same board pdf-lib reads",
    async (file) => {
      const v = settled(await runBounded(CHILD, [`corpus:${file}`], 60_000));
      expect(v.ok).toBe(true);
      // An independent reader of the same tree: pdf-lib's rotations.
      expect(v.rotations).toEqual(v.pdfLibRotations);
      expect(v.pageCount).toBe((v.pdfLibRotations as unknown[]).length);
    },
    90_000,
  );

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
