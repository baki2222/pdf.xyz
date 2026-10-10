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
  imageCaptionPdf,
  mixedSizesPdf,
  paintOrderPdf,
  pdftotextStandIn,
  PPTX_FIDELITY_FIXTURES,
  scannedPdf,
  vectorShapesPdf,
  type FixtureText,
  type PptxFixture,
} from "@/tests/pptx-fidelity-fixtures";
import { JPEG_30X20 } from "@/tests/jpeg-fixtures";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import {
  contains,
  onSlide,
  readDeck,
  type Deck,
  type DeckPicture,
  type DeckSlide,
  type DeckText,
} from "@/tests/pptx-deck-read";
import { runPdfOfficeExport, type PdfOfficeExportRun } from "./engine";
import { pdfOfficeExportDeps } from "./native";
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
