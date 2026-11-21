// @vitest-environment node
/**
 * Text to PDF's page setup (audit backlog #5, 2026-11-16): every page size ×
 * orientation × text size the chips offer, held to the PDF the engine saves.
 *
 * Until then the page was one fixed US Letter, 11 pt page, and nothing here
 * could be wrong in more than one way. With 30 combinations a layout can be
 * right on the default and wrong on the others — a column measured at the
 * default text size, lines cut at the default line count — so the checks
 * below read the SAVED bytes (page box, text matrix, font size of every
 * drawn line), not the layout the engine meant to draw, and bound each with
 * a number computed independently of the engine:
 *
 *  - line width from Courier's published advance (600/1000 em per glyph),
 *    not from pdf-lib's own measurement;
 *  - lines per page as floor(usable height / line height) from the page box
 *    read back out of the file.
 *
 * Bengali and Chinese go through the same layout with the shipped Noto
 * faces at every combination, and one real PDF each at the tightest corner.
 */
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { layoutPlainText, textToPdf } from "./text-to-pdf";
import {
  DEFAULT_TEXT_PAGE_OPTIONS,
  TEXT_FONT_SIZES,
  TEXT_ORIENTATIONS,
  TEXT_PAGE_SIZES,
  textPageGeometry,
  type TextPageOptions,
} from "./text-page-options";
import { TEXT_PAGE_MARGIN_PT } from "./page-geometry";
import {
  embedDrawingFont,
  resetFontCache,
  setFontByteSource,
} from "./unicode-font";
import { readNotoTtf } from "./noto-source";
import { proveGlyphs } from "@/tests/unicode-fonts";

/** Every combination the chips offer, discovered from their tables. */
const COMBOS: TextPageOptions[] = TEXT_PAGE_SIZES.flatMap((s) =>
  TEXT_ORIENTATIONS.flatMap((o) =>
    TEXT_FONT_SIZES.map((fontSize) => ({
      pageSize: s.id,
      orientation: o.id,
      fontSize,
    })),
  ),
);
const name = (o: TextPageOptions) =>
  `${o.pageSize} ${o.orientation} ${o.fontSize} pt`;

/** Courier's advance width, from the PDF standard-14 metrics (AFM). */
const COURIER_ADVANCE_EM = 600 / 1000;

/** Text that exercises every wrapping path, ending on a part-filled page. */
function latinCorpus(): string {
  const prose = Array.from(
    { length: 60 },
    (_, i) => `word${i} lorem ipsum dolor sit amet`,
  ).join(" ");
  const unbroken = "x".repeat(400);
  const lines = [prose, "", unbroken, "\tindented with a tab", "   spaces"];
  for (let i = 0; i < 130; i++) lines.push(`line ${i + 1}`);
  return lines.join("\n");
}

interface DrawnRun {
  font: string;
  size: number;
  x: number;
  y: number;
  text: string;
}

/** Every text run on a page, in drawing order, as the file stores it. */
function drawnRuns(doc: PDFDocument, index: number): DrawnRun[] {
  const page = doc.getPage(index);
  const contents = page.node.Contents();
  if (!contents) return [];
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  const source = streams
    .map((s) => {
      const raw = s as PDFRawStream;
      const data = raw.dict.get(PDFName.of("Filter"))
        ? inflateSync(raw.contents)
        : raw.contents;
      return Buffer.from(data).toString("latin1");
    })
    .join("\n");
  const runs: DrawnRun[] = [];
  const pattern =
    /\/(\S+) ([\d.]+) Tf[\s\S]*?1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g;
  for (const m of source.matchAll(pattern)) {
    runs.push({
      font: m[1]!,
      size: Number(m[2]),
      x: Number(m[3]),
      y: Number(m[4]),
      text: Buffer.from(m[5]!, "hex").toString("latin1"),
    });
  }
  return runs;
}

describe("Text to PDF page setup: the saved PDF at every combination", () => {
  it("offers the sizes, orientations and text sizes it says (health check)", () => {
    expect(TEXT_PAGE_SIZES.map((s) => s.id)).toEqual(
      expect.arrayContaining(["a4", "letter"]),
    );
    expect(TEXT_ORIENTATIONS.map((o) => o.id)).toEqual([
      "portrait",
      "landscape",
    ]);
    expect(TEXT_FONT_SIZES.length).toBeGreaterThanOrEqual(5);
    expect(COMBOS).toHaveLength(
      TEXT_PAGE_SIZES.length *
        TEXT_ORIENTATIONS.length *
        TEXT_FONT_SIZES.length,
    );
  });

  it("the engine default is the page this tool always drew: US Letter, 11 pt on 16 pt lines", () => {
    const g = textPageGeometry(DEFAULT_TEXT_PAGE_OPTIONS);
    expect([g.width, g.height, g.fontSize, g.lineHeight]).toEqual([
      612, 792, 11, 16,
    ]);
    expect(g.linesPerPage).toBe(42);
  });

  it.each(COMBOS.map((o) => [name(o), o] as const))(
    "%s: page box, every line inside it, full pages hold floor(usable / line height)",
    async (_label, options) => {
      // Topped up so the last page is part-filled at THIS combination.
      const courier = await (await PDFDocument.create()).embedFont("Courier");
      const g = textPageGeometry(options);
      let text = latinCorpus();
      if (layoutPlainText(text, courier, g).lineCount % g.linesPerPage === 0)
        text += "\ntail";
      const bytes = await textToPdf(text, { ...options, title: "notes" });
      const doc = await PDFDocument.load(bytes);
      const paper = TEXT_PAGE_SIZES.find((s) => s.id === options.pageSize)!;
      const [W, H] =
        options.orientation === "landscape"
          ? [paper.size.height, paper.size.width]
          : [paper.size.width, paper.size.height];
      const M = TEXT_PAGE_MARGIN_PT;
      const lineHeight = (options.fontSize * 16) / 11;
      const expectedPerPage = Math.floor((H - 2 * M) / lineHeight);

      const bodyCounts: number[] = [];
      const drawn: string[] = [];
      for (let p = 0; p < doc.getPageCount(); p++) {
        const box = doc.getPage(p).getMediaBox();
        expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, W, H]);
        const runs = drawnRuns(doc, p);
        // Title, then the "n / N" footer, then the body lines.
        expect(runs.length, `page ${p + 1} drew no body`).toBeGreaterThan(2);
        const body = runs.slice(2);
        bodyCounts.push(body.length);
        body.forEach((run, k) => {
          expect(run.size).toBe(options.fontSize);
          expect(run.x).toBeCloseTo(M, 6);
          // Each line one line height below the one before, from the margin.
          expect(run.y).toBeCloseTo(H - M - k * lineHeight, 6);
          const width = run.text.length * COURIER_ADVANCE_EM * run.size;
          const ascent = run.size * 0.8;
          const descent = run.size * 0.2;
          expect(
            run.x + width,
            `"${run.text}" runs past the right margin`,
          ).toBeLessThanOrEqual(W - M + 1e-6);
          expect(run.y - descent).toBeGreaterThanOrEqual(M);
          expect(run.y + ascent).toBeLessThanOrEqual(H);
          drawn.push(run.text);
        });
      }
      expect(bodyCounts.length).toBeGreaterThan(1);
      // Every page but the last is full; the last holds what is left.
      for (const count of bodyCounts.slice(0, -1))
        expect(count).toBe(expectedPerPage);
      expect(bodyCounts.at(-1)!).toBeGreaterThan(0);
      expect(bodyCounts.at(-1)!).toBeLessThan(expectedPerPage);
      // Nothing lost to the wrap: the words come back in order.
      const squash = (s: string) => s.replace(/\s+/g, "");
      expect(squash(drawn.join(""))).toBe(squash(text.replace(/\t/g, "    ")));
    },
    30_000,
  );

  it("CONTROL: the checks see a layout cut for the wrong page", async () => {
    // A4 portrait text cut at Letter landscape's line count must fail the
    // "full pages hold floor(usable / line height)" check above.
    const a4 = textPageGeometry({
      ...DEFAULT_TEXT_PAGE_OPTIONS,
      pageSize: "a4",
    });
    const wrong = textPageGeometry({
      ...DEFAULT_TEXT_PAGE_OPTIONS,
      orientation: "landscape",
    });
    expect(wrong.linesPerPage).not.toBe(a4.linesPerPage);
    // And a 9 pt column measured at 14 pt wraps differently.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont("Courier");
    const at = (fontSize: number) =>
      layoutPlainText(latinCorpus(), font, {
        ...textPageGeometry({ ...DEFAULT_TEXT_PAGE_OPTIONS, fontSize }),
      }).lineCount;
    expect(at(9)).toBeLessThan(at(14));
  });

  it("an empty layout is one empty page, and empty text is refused", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont("Courier");
    for (const o of COMBOS) {
      const layout = layoutPlainText("", font, textPageGeometry(o));
      expect(layout.pages).toEqual([{ lines: [""] }]);
    }
    await expect(
      textToPdf("   ", { pageSize: "a4", fontSize: 14 }),
    ).rejects.toThrow(/Add some text/);
  });

  it("refuses a size or text size the chips do not offer", () => {
    expect(() =>
      textPageGeometry({ ...DEFAULT_TEXT_PAGE_OPTIONS, fontSize: 13 }),
    ).toThrow(/no text size/);
    expect(() =>
      textPageGeometry({
        ...DEFAULT_TEXT_PAGE_OPTIONS,
        pageSize: "a3" as never,
      }),
    ).toThrow(/no page size/);
  });
});

/** Built from code points, so no raw script bytes sit in this file. */
const BENGALI = String.fromCodePoint(
  0x0986,
  0x09ae,
  0x09be,
  0x09b0,
  0x0020,
  0x09b8,
  0x09cb,
  0x09a8,
  0x09be,
  0x09b0,
  0x0020,
  0x09ac,
  0x09be,
  0x0982,
  0x09b2,
  0x09be,
);
const CHINESE = String.fromCodePoint(0x673a, 0x5bc6, 0x6587, 0x4ef6);

/** The combinations on one page size: the slice one test lays out. */
const combosOf = (pageSize: string) =>
  COMBOS.filter((o) => o.pageSize === pageSize);

/** Lays `text` out at every combination in `combos`, holding each layout. */
async function everyLineFits(
  script: string,
  text: string,
  combos: readonly TextPageOptions[],
): Promise<void> {
  // Health: an empty slice would pass every check below vacuously.
  expect(combos.length, `${script}: no combination in this slice`).toBe(
    TEXT_ORIENTATIONS.length * TEXT_FONT_SIZES.length,
  );
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [text, "notes"], "mono");
  for (const o of combos) {
    const g = textPageGeometry(o);
    const layout = layoutPlainText(text, font, g);
    const pages = layout.pages;
    expect(pages.length, name(o)).toBeGreaterThan(1);
    for (const page of pages.slice(0, -1))
      expect(page.lines.length, name(o)).toBe(g.linesPerPage);
    expect(pages.at(-1)!.lines.length).toBeLessThanOrEqual(g.linesPerPage);
    for (const line of pages.flatMap((p) => p.lines))
      expect(
        font.widthOfTextAtSize(line, g.fontSize),
        `${name(o)}: a ${script} line is wider than the column`,
      ).toBeLessThanOrEqual(g.maxWidth + 1e-6);
    const squash = (s: string) => s.replace(/\s+/g, "");
    expect(squash(pages.flatMap((p) => p.lines).join(""))).toBe(squash(text));
  }
}

describe("Text to PDF page setup: Bengali and Chinese wrap and paginate at every combination", () => {
  it("health: the per-page-size slices are non-empty and cover every combination once", () => {
    const slices = TEXT_PAGE_SIZES.map((s) => combosOf(s.id));
    for (const [i, slice] of slices.entries())
      expect(slice.length, TEXT_PAGE_SIZES[i]!.id).toBeGreaterThan(0);
    expect(slices.flat()).toEqual(COMBOS);
    // Positive control: a size the table does not have is an empty slice,
    // which `everyLineFits` refuses before it lays anything out.
    expect(combosOf("no-such-size")).toHaveLength(0);
  });

  let previous: Parameters<typeof setFontByteSource>[0];
  beforeAll(() => {
    previous = setFontByteSource(async (pack) => readNotoTtf(pack));
    resetFontCache();
  });
  afterAll(() => {
    setFontByteSource(previous);
    resetFontCache();
  });

  for (const [script, sample] of [
    ["Bengali", BENGALI],
    ["Chinese", CHINESE],
  ] as const) {
    // Long runs with no space (Chinese), long spaced runs (Bengali), short
    // lines to a part-filled last page.
    const text = [
      Array.from({ length: 16 }, () => sample).join(" "),
      sample.replace(/ /g, "").repeat(12),
      ...Array.from({ length: 90 }, (_, i) => `${sample} ${i}`),
    ].join("\n");

    // One test per page size, not one for all of them: the single test took
    // up to 85,092 ms of its 240 s on CI (run 44891504062, 11-21; 73,952 ms
    // over the 12 runs of 11-18), the slowest in the suite. Each slice is
    // about a third of the combinations. The timeout stays the hang backstop
    // at 240 s, checked when the test ends; it is no guard on the shaping
    // cost, which a count would have to hold.
    for (const size of TEXT_PAGE_SIZES)
      it(`${script} on ${size.id}: no line wider than the column, full pages hold the line count`, async () => {
        await everyLineFits(script, text, combosOf(size.id));
      }, 240_000);

    it(`${script}: a real PDF at the tightest corner draws every glyph`, async () => {
      const bytes = await textToPdf(text, {
        pageSize: "a4",
        orientation: "portrait",
        fontSize: Math.max(...TEXT_FONT_SIZES),
        // A title in the script too: `proveGlyphs` reads every <hex> Tj as
        // glyph ids, so a Helvetica title would read as missing glyphs.
        title: sample.replace(/ /g, ""),
      });
      const doc = await PDFDocument.load(bytes);
      const a4 = TEXT_PAGE_SIZES.find((s) => s.id === "a4")!.size;
      expect(doc.getPage(0).getSize()).toEqual(a4);
      const proof = await proveGlyphs(bytes);
      expect(proof.notdefIds).toEqual([]);
      expect(proof.emptyOutlineIds).toEqual([]);
    }, 60_000);
  }
});
