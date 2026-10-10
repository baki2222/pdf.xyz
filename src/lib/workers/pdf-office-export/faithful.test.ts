// @vitest-environment node
/**
 * PDF to PowerPoint keeps the page: its size, every picture where the page
 * paints it, every line of text where it sits, the other ink — in the order
 * the page paints them.
 *
 * ── THE DEFECT (reported by the owner, 2026-10-10, with files) ──────────────
 *
 * A 33-page slide-style tutorial (a screenshot and a caption per page) came
 * back as 33 16:9 slides of one unpositioned text box each: 80 KB, no media
 * at all. A competitor's export of the same PDF kept the 4:3 page size and put
 * every screenshot where it was. Every check this repository had was green on
 * the text-only deck, because every one of them asked about the package (does
 * it walk, does it open, is the text there) and none asked where anything is.
 *
 * ── HOW THESE ASK ───────────────────────────────────────────────────────────
 *
 * Each fixture is a generated PDF that records what it draws and where
 * (`@/tests/pptx-fidelity-fixtures`), run through the engine with the
 * PRODUCTION deps builder (`pdfOfficeExportDeps`), and the deck is read back
 * by a reader that shares nothing with the writer (`@/tests/pptx-deck-read`).
 * Only `extract` — pdftotext, which the engine runs to classify a locked or
 * damaged file — is stood in for, so the suite runs where poppler is not
 * installed (CI's unit job); the page reader under test is the real one.
 *
 * The round trip through a real presentation engine, which asks whether the
 * slides LOOK like the pages, is `fidelity.roundtrip.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  cellGridPdf,
  circleClipPdf,
  CLIP_PHOTO_SIDE,
  drawingBits,
  gradientPixels,
  imageCaptionPdf,
  mixedSizesPdf,
  oversizeScanPdf,
  paintOrderPdf,
  pdftotextStandIn,
  PPTX_FIDELITY_FIXTURES,
  rotatedFramePdf,
  scannedPdf,
  scanPixels,
  undecodablePicturePdf,
  vectorShapesPdf,
  type ClippedPicturePage,
  type FixtureText,
  type PptxFixture,
} from "@/tests/pptx-fidelity-fixtures";
import { decodePng } from "@/lib/png-probe";
import { JPEG_30X20 } from "@/tests/jpeg-fixtures";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import {
  contains,
  onSlide,
  pictureAt,
  readDeck,
  type Deck,
  type DeckPicture,
  type DeckSlide,
  type DeckText,
} from "@/tests/pptx-deck-read";
import { runPdfOfficeExport, type PdfOfficeExportRun } from "./engine";
import { pdfOfficeExportDeps } from "./native";
import {
  MAX_BILEVEL_PICTURE_SIDE,
  MAX_LAYERS_PER_PAGE,
  scanPdfPages,
} from "./page-scan";
import { inspectPptxPackage } from "./pptx-inspect";
import { readPptx } from "./validate-ooxml";

async function exportFixture(
  fixture: PptxFixture,
): Promise<Extract<PdfOfficeExportRun, { ok: true }>> {
  const run = await runPdfOfficeExport("pdf-to-powerpoint", fixture.pdf, {
    ...pdfOfficeExportDeps(),
    extract: async () => pdftotextStandIn(fixture),
  });
  if (!run.ok) throw new Error(`${fixture.name}: ${run.kind}: ${run.message}`);
  return run;
}

async function deckOf(fixture: PptxFixture): Promise<Deck> {
  return readDeck((await exportFixture(fixture)).output);
}

/** The text box holding `t`'s text, or a failure naming what is there. */
function textBox(slide: DeckSlide, t: FixtureText): DeckText {
  const box = slide.texts.find((b) => b.text.trim() === t.text);
  if (!box)
    throw new Error(
      `no text box reads "${t.text}"; the slide has ${JSON.stringify(slide.texts.map((b) => b.text))}`,
    );
  return box;
}

const near = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance;

function colorClose(a: string | null, b: string, tolerance = 3): boolean {
  if (!a) return false;
  for (let i = 0; i < 6; i += 2)
    if (
      Math.abs(
        parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16),
      ) > tolerance
    )
      return false;
  return true;
}

describe("every fixture: a deck PowerPoint's readers accept, one slide per page", () => {
  it.each(PPTX_FIDELITY_FIXTURES.map((build) => [build.name, build]))(
    "%s",
    async (_, build) => {
      const fixture = await build();
      const run = await exportFixture(fixture);
      expect((await readPptx(run.output)).problems).toEqual([]);
      const inspection = await inspectPptxPackage(run.output);
      expect(inspection.problems).toEqual([]);
      expect(inspection.counts.slides).toBe(fixture.pages.length);
      const deck = await readDeck(run.output);
      expect(deck.slides).toHaveLength(fixture.pages.length);
    },
  );
});

describe("the slide is the first page's size, not a fixed 16:9", () => {
  it("a 720 × 540 pt page gives a 720 × 540 pt (4:3) slide", async () => {
    const deck = await deckOf(await imageCaptionPdf());
    expect(deck.width).toBeCloseTo(720, 1);
    expect(deck.height).toBeCloseTo(540, 1);
  });

  it("a US Letter portrait first page gives a portrait slide", async () => {
    const deck = await deckOf(await scannedPdf());
    expect(deck.width).toBeCloseTo(612, 1);
    expect(deck.height).toBeCloseTo(792, 1);
  });
});

describe("pictures: each its own picture, where the page paints it", () => {
  it("places every picture of the image-and-caption page within a point", async () => {
    const fixture = await imageCaptionPdf();
    const deck = await deckOf(fixture);
    const page = fixture.pages[0]!;
    const slide = deck.slides[0]!;
    // Health: the fixture draws three pictures; a page that drew none would
    // make every "found it" below vacuous.
    expect(page.images).toHaveLength(3);
    for (const img of page.images) {
      const want = onSlide(page.displayed, deck, img.shown);
      const got = slide.pictures.find(
        (p) =>
          near(p.x, want.x, 1) &&
          near(p.y, want.y, 1) &&
          near(p.width, want.width, 1) &&
          near(p.height, want.height, 1),
      );
      expect(
        got,
        `no picture at ${JSON.stringify(want)}; pictures: ${JSON.stringify(slide.pictures.map(({ x, y, width, height }) => ({ x, y, width, height })))}`,
      ).toBeDefined();
      if (!got) continue;
      expect(got.contentType).toMatch(/^image\/(png|jpeg)$/);
      expect([got.pixelWidth, got.pixelHeight]).toEqual([
        img.pixelWidth,
        img.pixelHeight,
      ]);
      if (img.crop) {
        expect(got.crop).not.toBeNull();
        expect(got.crop!.right).toBeCloseTo(img.crop.right, 2);
        expect(got.crop!.left).toBeCloseTo(img.crop.left, 2);
      }
    }
  });

  it("copies a plain JPEG byte for byte, with no re-encoding", async () => {
    const fixture = await imageCaptionPdf();
    const deck = await deckOf(fixture);
    const page = fixture.pages[0]!;
    const source = page.images.find((i) => i.source === "jpeg")!;
    const want = onSlide(page.displayed, deck, source.shown);
    const jpeg = deck.slides[0]!.pictures.find(
      (p) => near(p.x, want.x, 1) && near(p.y, want.y, 1),
    );
    expect(jpeg, "no picture where the JPEG is drawn").toBeDefined();
    expect(jpeg!.contentType).toBe("image/jpeg");
    expect(Buffer.from(jpeg!.bytes).equals(Buffer.from(JPEG_30X20))).toBe(true);
  });

  it("keeps a picture's transparency (PNG with alpha)", async () => {
    const fixture = await paintOrderPdf();
    const deck = await deckOf(fixture);
    const badge = fixture.pages[0]!.images.find((i) => i.alpha)!;
    const want = onSlide(fixture.pages[0]!.displayed, deck, badge.shown);
    const got = deck.slides[0]!.pictures.find(
      (p) => near(p.x, want.x, 1) && near(p.y, want.y, 1),
    );
    expect(got).toBeDefined();
    expect(got!.contentType).toBe("image/png");
    expect(got!.alpha).toBe(true);
  });
});

describe("text: one box per line, at the line, in its size, weight and colour", () => {
  it.each([
    ["imageCaptionPdf", imageCaptionPdf],
    ["vectorShapesPdf", vectorShapesPdf],
    ["paintOrderPdf", paintOrderPdf],
  ] as const)("%s", async (_, build) => {
    const fixture = await build();
    const deck = await deckOf(fixture);
    const page = fixture.pages[0]!;
    const slide = deck.slides[0]!;
    expect(page.texts.length).toBeGreaterThan(0);
    for (const t of page.texts) {
      const box = textBox(slide, t);
      const at = onSlide(page.displayed, deck, {
        x: t.x,
        y: t.baseline,
        width: 0,
        height: 0,
      });
      // Left edge within two points; the baseline inside the box.
      expect(near(box.x, at.x, 2), `${t.text}: x ${box.x} vs ${at.x}`).toBe(
        true,
      );
      expect(
        box.y < at.y && at.y < box.y + box.height,
        `${t.text}: baseline`,
      ).toBe(true);
      const run = box.runs[0]!;
      expect(run.size).toBeCloseTo(t.size * at.scale, 0);
      expect(run.bold).toBe(t.bold);
      if (t.invisible) expect(run.invisible).toBe(true);
      else {
        expect(run.invisible).toBe(false);
        expect(colorClose(run.color, t.color), `${t.text}: ${run.color}`).toBe(
          true,
        );
      }
    }
  });
});

describe("vector art is kept, as pictures, where it was", () => {
  it("every shape of the vector page lies inside a drawn picture", async () => {
    const fixture = await vectorShapesPdf();
    const deck = await deckOf(fixture);
    const page = fixture.pages[0]!;
    const drawn = deck.slides[0]!.pictures;
    expect(drawn.length).toBeGreaterThan(0);
    for (const shape of page.shapes) {
      const want = onSlide(page.displayed, deck, shape.box);
      expect(
        drawn.some((p) => contains(p, want, 3)),
        `no drawing covers ${JSON.stringify(shape.box)}`,
      ).toBe(true);
    }
  });
});

describe("paint order is kept: nothing hidden in the PDF is shown in the deck", () => {
  it("text painted under a picture stays under it", async () => {
    const fixture = await paintOrderPdf();
    const deck = await deckOf(fixture);
    const page = fixture.pages[0]!;
    const slide = deck.slides[0]!;
    const big = onSlide(page.displayed, deck, page.images[0]!.shown);
    const photo = slide.pictures.find(
      (p) => near(p.x, big.x, 1) && near(p.y, big.y, 1),
    );
    expect(photo).toBeDefined();
    const hidden = textBox(slide, page.hiddenTexts[0]!);
    expect(hidden.z).toBeLessThan(photo!.z);
  });

  it("a box and a frame painted over a picture stay over it", async () => {
    const fixture = await paintOrderPdf();
    const deck = await deckOf(fixture);
    const page = fixture.pages[0]!;
    const slide = deck.slides[0]!;
    const big = onSlide(page.displayed, deck, page.images[0]!.shown);
    const photo = slide.pictures.find(
      (p) => near(p.x, big.x, 1) && near(p.y, big.y, 1),
    )!;
    for (const shape of page.shapes.filter((s) => s.overPicture)) {
      const want = onSlide(page.displayed, deck, shape.box);
      const over = slide.pictures.filter(
        (p) => p.z > photo.z && contains(p, want, 3),
      );
      expect(
        over,
        `nothing over the picture covers ${JSON.stringify(shape.box)}`,
      ).not.toEqual([]);
    }
  });
});

describe("a scanned PDF is no longer refused: its pages become picture slides", () => {
  it("a page with no text becomes a slide holding the page as a picture", async () => {
    const fixture = await scannedPdf();
    const run = await exportFixture(fixture);
    const deck = await readDeck(run.output);
    const page = fixture.pages[0]!;
    const slide = deck.slides[0]!;
    expect(slide.texts).toEqual([]);
    const want = onSlide(page.displayed, deck, page.images[0]!.shown);
    expect(
      slide.pictures.some((p) => contains(want, p, 1) && contains(p, want, 1)),
    ).toBe(true);
    // The result says which pages carry no editable text, so the panel can.
    expect(run.coverage).toMatchObject({
      pageCount: 1,
      textPageCount: 0,
      pagesWithoutText: [1],
      picturePageCount: 1,
      pagesAsPictures: [1],
    });
  });
});

describe("pages of other sizes are fitted, centred, aspect kept", () => {
  it("places each page's picture through the fit, rotated pages included", async () => {
    const fixture = await mixedSizesPdf();
    const deck = await deckOf(fixture);
    expect(deck.width).toBeCloseTo(720, 1);
    expect(deck.height).toBeCloseTo(540, 1);
    fixture.pages.forEach((page, i) => {
      const want = onSlide(page.displayed, deck, page.images[0]!.shown);
      // A picture turned a quarter (a /Rotate 90 page turns its pictures)
      // shows its box with width and height swapped about the centre.
      const shown = (p: DeckPicture) => {
        const quarter = Math.round(p.rotation / 90) % 2 === 1;
        const w = quarter ? p.height : p.width;
        const h = quarter ? p.width : p.height;
        return {
          x: p.x + p.width / 2 - w / 2,
          y: p.y + p.height / 2 - h / 2,
          width: w,
          height: h,
        };
      };
      const got = deck.slides[i]!.pictures.map(shown).find(
        (p) =>
          near(p.x, want.x, 1.5) &&
          near(p.y, want.y, 1.5) &&
          near(p.width, want.width, 1.5) &&
          near(p.height, want.height, 1.5),
      );
      expect(
        got,
        `page ${i + 1}: no picture at ${JSON.stringify(want)}; got ${JSON.stringify(deck.slides[i]!.pictures.map(({ x, y, width, height, rotation }) => ({ x, y, width, height, rotation })))}`,
      ).toBeDefined();
    });
  });

  it("keeps the words of every page, the turned page's included", async () => {
    const fixture = await mixedSizesPdf();
    const deck = await deckOf(fixture);
    fixture.pages.forEach((page, i) => {
      for (const t of page.texts) {
        const box = textBox(deck.slides[i]!, t);
        if (t.rotation) expect(box.rotation).toBeCloseTo(t.rotation, 0);
      }
    });
  });
});

describe("an owner-password PDF: encrypted, opens without a password, and converts", () => {
  it("is read through the page reader like any other, its text on its slide", async () => {
    // The population pdf-lib refuses and every viewer opens: an /Encrypt
    // dictionary with an empty user password. pdftotext opens it, so the
    // engine must too — and its streams are encrypted, so nothing may be
    // copied out of them raw (the page reader re-encodes what it decoded).
    const pdf = rc4EncryptedPdf({
      userPassword: "",
      ownerPassword: "owner",
      text: "Owner locked but readable",
    });
    const run = await runPdfOfficeExport("pdf-to-powerpoint", pdf, {
      ...pdfOfficeExportDeps(),
      extract: async () => ({
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            text: "Owner locked but readable",
            characterCount: 25,
          },
        ],
        text: "Owner locked but readable",
        characterCount: 25,
        hasText: true,
      }),
    });
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    const deck = await readDeck(run.output);
    expect(deck.slides[0]!.texts.map((t) => t.text)).toEqual([
      "Owner locked but readable",
    ]);
  });
});

/* ------------------------------------------------------------------ *
 *  2026-10-11: what the review of the faithful export found
 * ------------------------------------------------------------------ */

/**
 * A PICTURE IS NEVER SILENTLY LOST. Until 2026-10-11 pdf.js was opened with
 * a 64-megapixel ceiling per image and REMOVED anything larger without a
 * word: a 124 MP A1 drawing at 400 dpi exported as a blank slide, and the
 * panel said its page had "nothing on it". Pictures pdf.js could not decode
 * were counted by the page reader and read by nobody. Now a picture is on
 * its slide, or the result counts it, page by page.
 */
describe("a picture is on its slide, or the result says it is not", () => {
  it("a 65.6-megapixel scan — over pdf.js's old 64 MP ceiling — is on its slide, with its pixels", async () => {
    const fixture = await oversizeScanPdf();
    const run = await exportFixture(fixture);
    const deck = await readDeck(run.output);
    const page = fixture.pages[0]!;
    const want = onSlide(page.displayed, deck, page.images[0]!.shown);
    const pic = deck.slides[0]!.pictures.find(
      (p) => contains(want, p, 1) && contains(p, want, 1),
    );
    expect(
      pic,
      `no picture covers the page; pictures: ${JSON.stringify(deck.slides[0]!.pictures.map(({ x, y, width, height }) => ({ x, y, width, height })))}`,
    ).toBeDefined();
    // Scaled down to the bilevel ceiling on its long side, aspect kept.
    expect(Math.max(pic!.pixelWidth, pic!.pixelHeight)).toBe(
      MAX_BILEVEL_PICTURE_SIDE,
    );
    expect(pic!.pixelWidth / pic!.pixelHeight).toBeCloseTo(8200 / 8000, 2);
    // Its pixels are the drawing's: as much of it is dark as of the source.
    const png = decodePng(pic!.bytes);
    let dark = 0;
    for (let i = 0; i < png.data.length; i += 4) dark += 255 - png.data[i]!;
    // 8,200 is a whole number of bytes: no padding bits to skip.
    const bits = drawingBits(8200, 8000);
    let black = 0;
    for (let b = 0; b < bits.length; b++)
      for (let k = 0; k < 8; k++) black += (bits[b]! >> k) & 1 ? 0 : 1;
    const share = dark / 255 / (png.width * png.height);
    expect(share).toBeGreaterThan(0.05);
    expect(Math.abs(share - black / (8200 * 8000))).toBeLessThan(0.01);
    expect(run.coverage).toMatchObject({
      picturePageCount: 1,
      pagesAsPictures: [1],
      picturesNotCarried: 0,
      emptySlideCount: 0,
    });
  }, 60_000);

  it("a picture pdf.js cannot decode is counted on its page, and that page is not called empty", async () => {
    const fixture = await undecodablePicturePdf();
    const run = await exportFixture(fixture);
    expect(run.coverage).toMatchObject({
      pageCount: 3,
      picturesNotCarried: 1,
      picturesTooLarge: 0,
      pagesMissingPictures: [2],
      // Page 3 is blank; page 2 is not, whatever its slide now holds.
      emptySlideCount: 1,
    });
  });

  it("pictures past a page's decode budget are left out and counted, the rest kept", async () => {
    // The budget is the production constant in production; here it is set
    // low enough that the 480 × 300 photo (≈ 0.5 MB decoded) is over it and
    // the 30 × 20 JPEG is not.
    const fixture = await imageCaptionPdf();
    const run = await runPdfOfficeExport("pdf-to-powerpoint", fixture.pdf, {
      ...pdfOfficeExportDeps(),
      extract: async () => pdftotextStandIn(fixture),
      scanPages: (bytes, options) =>
        scanPdfPages(bytes, { ...options, pageDecodeBudgetBytes: 100_000 }),
    });
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    const deck = await readDeck(run.output);
    const page = fixture.pages[0]!;
    const jpeg = onSlide(page.displayed, deck, page.images[1]!.shown);
    const photo = onSlide(page.displayed, deck, page.images[0]!.shown);
    const at = (r: { x: number; y: number }) =>
      deck.slides[0]!.pictures.filter(
        (p) => near(p.x, r.x, 1) && near(p.y, r.y, 1),
      );
    expect(at(jpeg), "the small JPEG fits and is kept").toHaveLength(1);
    expect(at(photo), "the photo is over the budget").toEqual([]);
    // The photo is drawn twice (once whole, once clipped): one image, one
    // count — pdf.js decodes an XObject once a page.
    expect(run.coverage).toMatchObject({
      picturesNotCarried: 1,
      picturesTooLarge: 1,
      pagesMissingPictures: [1],
    });
  });
});

/** The colour the clip fixtures' photo has at page point (x, y). */
function photoColour(
  page: ClippedPicturePage,
  x: number,
  y: number,
): [number, number, number] | null {
  const { box, turn } = page.photo;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = (-turn * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const u = (dx * Math.cos(r) - dy * Math.sin(r)) / box.width + 0.5;
  const v = (dx * Math.sin(r) + dy * Math.cos(r)) / box.height + 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  const px = Math.floor(u * CLIP_PHOTO_SIDE);
  const py = Math.floor(v * CLIP_PHOTO_SIDE);
  const i = (py * CLIP_PHOTO_SIDE + px) * 3;
  return [PHOTO[i]!, PHOTO[i + 1]!, PHOTO[i + 2]!];
}
const PHOTO = gradientPixels(CLIP_PHOTO_SIDE, CLIP_PHOTO_SIDE);

function insideClip(page: ClippedPicturePage, x: number, y: number): boolean {
  const c = page.clip;
  if (c.kind === "circle") return Math.hypot(x - c.cx, y - c.cy) < c.r;
  return (
    x > c.box.x &&
    x < c.box.x + c.box.width &&
    y > c.box.y &&
    y < c.box.y + c.box.height
  );
}

/**
 * WHAT A CLIP HIDES STAYS HIDDEN. Until 2026-10-11 every clip was reduced to
 * its bounding box and a picture was cropped only when upright: a profile
 * photo shown through a circle came out square, its corners showing, and a
 * photo turned inside a frame spilled its corners over the page. Asked of
 * the PIXELS the deck shows (`pictureAt`), on a grid over the photo's whole
 * box: outside the clip nothing of the photo may show; inside, the photo's
 * own colours must.
 */
describe("a picture shows through its clip, and only through it", () => {
  it.each([
    ["circleClipPdf", circleClipPdf],
    ["rotatedFramePdf", rotatedFramePdf],
  ] as const)("%s", async (_, build) => {
    const fixture = await build();
    const deck = await deckOf(fixture as unknown as PptxFixture);
    const page = fixture.pages[0]!;
    const slide = deck.slides[0]!;
    // Points over the photo's whole box (turned), clear of the frame's
    // stroke, sorted by whether the clip shows them.
    const { box, turn } = page.photo;
    const shown: [number, number][] = [];
    const hidden: [number, number][] = [];
    for (let i = 1; i < 24; i++)
      for (let j = 1; j < 24; j++) {
        const u = i / 24 - 0.5;
        const v = j / 24 - 0.5;
        const t = (turn * Math.PI) / 180;
        const x =
          box.x +
          box.width / 2 +
          u * box.width * Math.cos(t) -
          v * box.height * Math.sin(t);
        const y =
          box.y +
          box.height / 2 +
          u * box.width * Math.sin(t) +
          v * box.height * Math.cos(t);
        const nearEdge =
          page.clip.kind === "circle"
            ? Math.abs(
                Math.hypot(x - page.clip.cx, y - page.clip.cy) - page.clip.r,
              ) < 4
            : Math.min(
                Math.abs(x - page.clip.box.x),
                Math.abs(x - page.clip.box.x - page.clip.box.width),
                Math.abs(y - page.clip.box.y),
                Math.abs(y - page.clip.box.y - page.clip.box.height),
              ) < 6;
        if (nearEdge) continue;
        (insideClip(page, x, y) ? shown : hidden).push([x, y]);
      }
    // Health: both sets are real — a photo the clip hides nothing of, or
    // everything of, would make one half of this vacuous.
    expect(hidden.length).toBeGreaterThan(30);
    expect(shown.length).toBeGreaterThan(100);
    const leaks = hidden.filter(([x, y]) =>
      pictureAt(slide, x, y).some((h) => !h.rgba || h.rgba[3] > 16),
    );
    expect(
      leaks.map(([x, y]) => `${x.toFixed(0)},${y.toFixed(0)}`),
      "the deck shows the photo where the PDF hides it",
    ).toEqual([]);
    const wrong = shown.filter(([x, y]) => {
      const want = photoColour(page, x, y)!;
      const top = pictureAt(slide, x, y).find((h) => h.rgba && h.rgba[3] > 200);
      return (
        !top ||
        Math.max(...want.map((c, k) => Math.abs(c - top.rgba![k]!))) > 24
      );
    });
    expect(
      wrong.length,
      `${wrong.length} of ${shown.length} points inside the clip do not show the photo`,
    ).toBeLessThan(shown.length * 0.03);
  });
});

/**
 * LAYERS PER PAGE ARE BOUNDED. A page that alternates text and overlapping
 * drawing — a cell's number, then its border — took one full render pass
 * per cell: 1,440 cells were 17 s and 1,441 pictures on one page, and eight
 * such pages ran into the deadline, retryably. Past the cap the page is
 * drawn once, in its own paint order, with its text in invisible boxes.
 */
describe("a page that would need too many layers is drawn once", () => {
  /** MAX_LAYERS_PER_PAGE, written here so the test can fail before it exists. */
  const K = 32;

  it("1,000 cells, each its text then its border: at most K + 1 pictures, quickly, text kept", async () => {
    const fixture = await cellGridPdf(1000);
    const t0 = Date.now();
    const run = await exportFixture(fixture);
    const elapsed = Date.now() - t0;
    const deck = await readDeck(run.output);
    const slide = deck.slides[0]!;
    expect(slide.pictures.length).toBeLessThanOrEqual(K + 1);
    expect(elapsed, `took ${elapsed} ms`).toBeLessThan(8_000);
    // The words are still there, as text a reader can select.
    for (const t of fixture.pages[0]!.texts)
      expect(
        slide.texts.some((b) => b.text.trim() === t.text),
        `no text box reads "${t.text}"`,
      ).toBe(true);
    expect(run.coverage).toMatchObject({
      flattenedPageCount: 1,
      pagesFlattened: [1],
    });
    expect(MAX_LAYERS_PER_PAGE).toBe(K);
  }, 60_000);

  it("CONTROL: 30 such cells stay as layers, in paint order", async () => {
    const fixture = await cellGridPdf(30);
    const run = await exportFixture(fixture);
    const deck = await readDeck(run.output);
    expect(deck.slides[0]!.pictures.length).toBe(30);
    expect(deck.slides[0]!.texts.every((t) => !t.runs[0]!.invisible)).toBe(
      true,
    );
    expect(run.coverage).toMatchObject({ flattenedPageCount: 0 });
  });
});

/**
 * A RE-ENCODED PICTURE CARRIES ITS PIXELS. Every check of the picture path
 * asked where a picture is and what kind of file it is; none decoded it, so
 * an encoder writing transparent black passed them all (the review's
 * mutation, 2026-10-11). The scanned page's grey picture is re-encoded, not
 * copied: decoded here, it must be the scan.
 */
describe("a re-encoded picture is the source's pixels", () => {
  it("the scanned page's picture, decoded, matches the scan pixel for pixel", async () => {
    const fixture = await scannedPdf();
    const deck = await deckOf(fixture);
    const page = fixture.pages[0]!;
    const want = onSlide(page.displayed, deck, page.images[0]!.shown);
    const pic = deck.slides[0]!.pictures.find(
      (p) => contains(want, p, 1) && contains(p, want, 1),
    )!;
    expect(pic.contentType).toBe("image/png");
    const png = decodePng(pic.bytes);
    expect([png.width, png.height]).toEqual([612, 792]);
    const source = scanPixels(612, 792);
    let worst = 0;
    let opaque = 0;
    for (let p = 0; p < source.length; p++) {
      worst = Math.max(worst, Math.abs(png.data[p * 4]! - source[p]!));
      if (png.data[p * 4 + 3] === 255) opaque++;
    }
    expect(opaque).toBe(source.length);
    expect(worst).toBeLessThanOrEqual(1);
  });
});
