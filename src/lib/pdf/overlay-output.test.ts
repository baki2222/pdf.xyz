// @native-canvas
import { PDFDocument, PDFName, rgb, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  colourGrid,
  gridDistance,
  regionMean,
  renderPdfPages,
  type RenderedPage,
  type Rgb,
} from "@/tests/pdf-render";
import { cropPdf } from "./crop";
import { setPageRotations } from "./engine";
import { overlayPdf, OVERLAY_LAYERS, type OverlayLayer } from "./overlay";

/**
 * The overlay tool, judged by what a VIEWER paints — the page rendered by
 * pdf.js with its CropBox and `/Rotate` applied — rather than by the `cm`
 * operands the engine wrote.
 *
 * Why pixels: the engine drew every overlay at `1 0 0 1 0 0 cm` over the
 * page's full MediaBox, in unrotated content space, and embedded the overlay's
 * full MediaBox. Every one of those operands was exactly what the code meant,
 * so any test of the operands agreed with it — while a letterhead landed
 * sideways on a `/Rotate 90` page, outside the visible area of a cropped page,
 * and a stamp cropped out of a scan dragged its whole white page with it.
 *
 * The central relationship is DERIVED, not typed: with `fit: "stretch"` the
 * output page must look exactly like the overlay page looks on its own,
 * stretched to the page. No expected coordinates are written down, so no
 * expected coordinate can share the engine's mistake.
 */

/** Four distinct, non-white quadrants: any rotation or mirror is visible. */
const QUADRANTS: { col: 0 | 1; row: 0 | 1; color: [number, number, number] }[] =
  [
    { col: 0, row: 1, color: [0.9, 0.1, 0.1] }, // top-left: red
    { col: 1, row: 1, color: [0.1, 0.2, 0.9] }, // top-right: blue
    { col: 0, row: 0, color: [0.1, 0.6, 0.1] }, // bottom-left: green
    { col: 1, row: 0, color: [1, 0.8, 0] }, // bottom-right: yellow
  ];

function drawQuadrants(
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
) {
  const w = box.width / 2;
  const h = box.height / 2;
  for (const q of QUADRANTS) {
    page.drawRectangle({
      x: box.x + q.col * w,
      y: box.y + q.row * h,
      width: w,
      height: h,
      color: rgb(...q.color),
    });
  }
}

/** A one-page overlay whose visible page is the four quadrants. */
async function quadrantOverlay(
  size: [number, number] = [300, 200],
  origin: [number, number] = [0, 0],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  page.setMediaBox(origin[0], origin[1], size[0], size[1]);
  drawQuadrants(page, {
    x: origin[0],
    y: origin[1],
    width: size[0],
    height: size[1],
  });
  return doc.save();
}

/**
 * A stamp CROPPED out of a larger page with the site's own Crop tool: a grey
 * sheet with the quadrants in one region, then `cropPdf` down to that region.
 */
async function croppedStampOverlay(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 612,
    height: 792,
    color: rgb(0.5, 0.5, 0.5),
  });
  drawQuadrants(page, { x: 100, y: 500, width: 300, height: 150 });
  return cropPdf(await doc.save(), {
    margins: { left: 100, bottom: 500, right: 612 - 400, top: 792 - 650 },
  });
}

async function blankBase(
  size: [number, number] = [612, 792],
  origin?: [number, number],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  if (origin) page.setMediaBox(origin[0], origin[1], size[0], size[1]);
  return doc.save();
}

/**
 * Deliberately LOPSIDED: a crop centred on the page hides an origin mistake
 * from a quadrant fixture (the seams still meet in the middle), and the first
 * run of this file passed the old engine on exactly that case.
 */
const CROP = { top: 150, right: 30, bottom: 60, left: 100 };

/** Base pages a user can realistically bring, several made by our own tools. */
const BASES: { name: string; make: () => Promise<Uint8Array> }[] = [
  { name: "plain Letter", make: () => blankBase() },
  {
    name: "cropped by the Crop tool",
    make: async () => cropPdf(await blankBase(), { margins: CROP }),
  },
  ...([90, 180, 270] as const).map((angle) => ({
    name: `rotated ${angle} by the Rotate tool`,
    make: async () => setPageRotations(await blankBase(), [angle]),
  })),
  {
    name: "cropped, then rotated 90",
    make: async () =>
      setPageRotations(
        await cropPdf(await blankBase(), { margins: CROP }),
        [90],
      ),
  },
  {
    name: "MediaBox with a non-zero origin",
    make: () => blankBase([612, 792], [50, 50]),
  },
];

const OVERLAYS: { name: string; make: () => Promise<Uint8Array> }[] = [
  { name: "plain", make: () => quadrantOverlay() },
  { name: "cropped out of a scan", make: croppedStampOverlay },
  ...([90, 270] as const).map((angle) => ({
    name: `rotated ${angle}`,
    make: async () => setPageRotations(await quadrantOverlay(), [angle]),
  })),
  {
    name: "MediaBox with a non-zero origin",
    make: () => quadrantOverlay([300, 200], [100, 100]),
  },
];

async function firstPage(bytes: Uint8Array): Promise<RenderedPage> {
  const pages = await renderPdfPages(bytes);
  expect(pages.length).toBeGreaterThan(0);
  return pages[0]!;
}

/** Tolerance for an 8×8 grid of means: covers anti-aliasing at the seams. */
const SAME = 40;
/** A difference this large is a different picture, not a rounding error. */
const DIFFERENT = 100;

function rotateGrid180(grid: Rgb[][]): Rgb[][] {
  return grid.map((row) => [...row].reverse()).reverse();
}

function mirrorGrid(grid: Rgb[][]): Rgb[][] {
  return grid.map((row) => [...row].reverse());
}

const WHITE: Rgb = [255, 255, 255];
function isWhite(c: Rgb) {
  return c.every((v) => v > 240);
}
function isDark(c: Rgb) {
  return c.every((v) => v < 60);
}
function isRed(c: Rgb) {
  return c[0] > 180 && c[1] < 90 && c[2] < 90;
}

describe("overlay placement, as a viewer renders it", () => {
  it("health: the fixture is asymmetric and the comparator can tell pictures apart", async () => {
    const seen = colourGrid(await firstPage(await quadrantOverlay()), 8);
    // A symmetric fixture would pass a rotated or mirrored overlay.
    expect(gridDistance(seen, rotateGrid180(seen))).toBeGreaterThan(DIFFERENT);
    expect(gridDistance(seen, mirrorGrid(seen))).toBeGreaterThan(DIFFERENT);
    // Nothing in it is white, so "not drawn" can never pass for "drawn".
    seen.flat().forEach((cell) => expect(isWhite(cell)).toBe(false));
    // The fixtures really carry what their names claim.
    const cropped = await PDFDocument.load(await croppedStampOverlay());
    expect(cropped.getPage(0).getCropBox()).toMatchObject({
      x: 100,
      y: 500,
      width: 300,
      height: 150,
    });
    for (const base of BASES) {
      expect(await base.make(), base.name).toBeInstanceOf(Uint8Array);
    }
    expect(BASES.length * OVERLAYS.length).toBeGreaterThanOrEqual(30);
  });

  for (const base of BASES) {
    for (const overlay of OVERLAYS) {
      it(`stretch: the ${overlay.name} overlay looks the same on a ${base.name} page`, async () => {
        const overlayBytes = await overlay.make();
        const baseBytes = await base.make();
        const expected = colourGrid(await firstPage(overlayBytes), 8);
        const result = await overlayPdf(baseBytes, overlayBytes, {
          fit: "stretch",
        });
        const got = colourGrid(await firstPage(result.bytes), 8);
        expect(gridDistance(got, expected)).toBeLessThan(SAME);
      });
    }
  }

  it("fit: sized and centred in the frame the viewer shows, on a rotated page", async () => {
    // Portrait Letter, /Rotate 90 → the viewer shows 792 wide × 612 tall. A
    // 396×612 overlay then fits at scale 1, centred: the middle half of the
    // width, the full height, white on either side.
    const base = await setPageRotations(await blankBase(), [90]);
    const overlayBytes = await quadrantOverlay([396, 612]);
    const expected = colourGrid(await firstPage(overlayBytes), 8);
    const result = await overlayPdf(base, overlayBytes, { fit: "fit" });
    const out = await firstPage(result.bytes);
    expect(out.width).toBeGreaterThan(out.height); // the viewer frame
    expect(
      gridDistance(colourGrid(out, 8, [0.25, 0, 0.75, 1]), expected),
    ).toBeLessThan(SAME);
    expect(isWhite(regionMean(out, 0.02, 0.1, 0.22, 0.9))).toBe(true);
    expect(isWhite(regionMean(out, 0.78, 0.1, 0.98, 0.9))).toBe(true);
  });
});

/**
 * A letterhead: a full-page OPAQUE white sheet (what a scan or a design-tool
 * export is) with a red band across the top.
 */
async function opaqueLetterhead(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 612,
    height: 792,
    color: rgb(1, 1, 1),
  });
  page.drawRectangle({
    x: 0,
    y: 712,
    width: 612,
    height: 80,
    color: rgb(0.9, 0.1, 0.1),
  });
  return doc.save();
}

/** A letter body: a solid dark block in the middle of the page. */
async function letterBody(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({
    x: 150,
    y: 250,
    width: 312,
    height: 292,
    color: rgb(0, 0, 0),
  });
  return doc.save();
}

/** Normalized viewer regions: the letter body, and the letterhead band. */
const BODY = [0.35, 0.4, 0.65, 0.6] as const;
const BAND = [0.1, 0.01, 0.9, 0.08] as const;

describe("overlay layer: an opaque letterhead and the letter under it", () => {
  async function render(layer?: OverlayLayer) {
    const result = await overlayPdf(
      await letterBody(),
      await opaqueLetterhead(),
      {
        ...(layer ? { layer } : {}),
      },
    );
    return { result, page: await firstPage(result.bytes) };
  }

  it("control: the base body is dark and the letterhead is opaque", async () => {
    const body = await firstPage(await letterBody());
    expect(isDark(regionMean(body, ...BODY))).toBe(true);
    const sheet = await firstPage(await opaqueLetterhead());
    expect(isWhite(regionMean(sheet, ...BODY))).toBe(true);
    expect(isRed(regionMean(sheet, ...BAND))).toBe(true);
  });

  it("defaults to on top, which hides the letter — the positive control for 'behind'", async () => {
    const { result, page } = await render();
    expect(result.layer).toBe("front");
    expect(regionMean(page, ...BODY)).toEqual(WHITE);
    expect(isRed(regionMean(page, ...BAND))).toBe(true);
  });

  it("behind content: the letter stays readable and the letterhead still shows", async () => {
    const { result, page } = await render("back");
    expect(result.layer).toBe("back");
    expect(isDark(regionMean(page, ...BODY))).toBe(true);
    expect(isRed(regionMean(page, ...BAND))).toBe(true);
  });

  it("multiply: drawn on top, but its white drops out so the letter shows through", async () => {
    // A SCANNED letter paints its own opaque sheet, so "behind" would hide the
    // letterhead instead. Multiply is the mode for that input.
    const { result, page } = await render("multiply");
    expect(result.layer).toBe("multiply");
    expect(isDark(regionMean(page, ...BODY))).toBe(true);
    expect(isRed(regionMean(page, ...BAND))).toBe(true);
  });

  it("offers every layer the engine implements, and each changes the picture", async () => {
    // Derived from the option list, so a mode added without a render proof
    // lands here rather than nowhere.
    const ids = OVERLAY_LAYERS.map((l) => l.id);
    expect(ids).toContain("front");
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const front = colourGrid((await render("front")).page, 8);
    for (const id of ids.filter((i) => i !== "front")) {
      const other = colourGrid((await render(id)).page, 8);
      expect(gridDistance(front, other), id).toBeGreaterThan(DIFFERENT);
    }
  });

  it("behind content on a rotated, cropped page still lands where the viewer looks", async () => {
    const base = await setPageRotations(
      await cropPdf(await letterBody(), { margins: CROP }),
      [90],
    );
    const overlayBytes = await quadrantOverlay();
    const alone = colourGrid(await firstPage(base), 8);
    const expected = colourGrid(await firstPage(overlayBytes), 8);
    const result = await overlayPdf(base, overlayBytes, {
      fit: "stretch",
      layer: "back",
    });
    const got = colourGrid(await firstPage(result.bytes), 8);
    // Derived cell by cell from the two inputs as a viewer shows them: where
    // the letter is dark it stays dark (the overlay is behind it); everywhere
    // else the overlay shows exactly as it looks on its own.
    let dark = 0;
    let open = 0;
    alone.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (isDark(cell)) {
          dark++;
          expect(isDark(got[r]![c]!), `cell ${r},${c}`).toBe(true);
        } else if (isWhite(cell)) {
          open++;
          expect(
            gridDistance([[got[r]![c]!]], [[expected[r]![c]!]]),
            `cell ${r},${c}`,
          ).toBeLessThan(SAME);
        }
      }),
    );
    // Both kinds of cell must exist, or this proved nothing about either.
    expect(dark).toBeGreaterThan(4);
    expect(open).toBeGreaterThan(4);
  });
});

describe("overlay pages whose content is not in a content stream", () => {
  /** A page with NO /Contents at all. */
  function addBlankPage(doc: PDFDocument) {
    return doc.addPage([300, 200]);
  }

  async function threePageOverlay(middle: "blank" | "content") {
    const doc = await PDFDocument.create();
    drawQuadrants(doc.addPage([300, 200]), {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    if (middle === "blank") addBlankPage(doc);
    else
      drawQuadrants(doc.addPage([300, 200]), {
        x: 0,
        y: 0,
        width: 300,
        height: 200,
      });
    drawQuadrants(doc.addPage([300, 200]), {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    return doc.save();
  }

  it("health: the blank fixture page really has no /Contents", async () => {
    const doc = await PDFDocument.load(await threePageOverlay("blank"));
    expect(doc.getPage(1).node.Contents()).toBeUndefined();
    expect(doc.getPage(0).node.Contents()).toBeDefined();
  });

  it("cycle skips a blank overlay page, says so, and leaves that base page as it was", async () => {
    const threeBase = await (async () => {
      const doc = await PDFDocument.create();
      for (let i = 0; i < 3; i++) doc.addPage([300, 200]);
      return doc.save();
    })();
    const result = await overlayPdf(
      threeBase,
      await threePageOverlay("blank"),
      {
        paging: "cycle",
        fit: "stretch",
      },
    );
    expect(result.skippedBlankOverlayPages).toEqual([2]);
    const pages = await renderPdfPages(result.bytes);
    expect(pages).toHaveLength(3);
    expect(isWhite(regionMean(pages[1]!, 0, 0, 1, 1))).toBe(true);
    expect(isWhite(regionMean(pages[0]!, 0, 0, 1, 1))).toBe(false);
    expect(isWhite(regionMean(pages[2]!, 0, 0, 1, 1))).toBe(false);
  });

  it("positive control: with content on overlay page 2, base page 2 carries it and nothing is skipped", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage([300, 200]);
    const result = await overlayPdf(
      await doc.save(),
      await threePageOverlay("content"),
      { paging: "cycle", fit: "stretch" },
    );
    expect(result.skippedBlankOverlayPages).toEqual([]);
    const pages = await renderPdfPages(result.bytes);
    expect(isWhite(regionMean(pages[1]!, 0, 0, 1, 1))).toBe(false);
  });

  it("an overlay whose only content is a filled form field is applied, not refused", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const field = doc.getForm().createTextField("approved");
    field.setText("OK");
    field.addToPage(page, {
      x: 0,
      y: 100,
      width: 150,
      height: 100,
      backgroundColor: rgb(0.1, 0.2, 0.9),
      borderWidth: 0,
    });
    const overlayBytes = await doc.save();
    // The fixture is what it claims: no content stream, only a widget.
    const reloaded = await PDFDocument.load(overlayBytes);
    expect(reloaded.getPage(0).node.Contents()).toBeUndefined();

    const result = await overlayPdf(await blankBase([300, 200]), overlayBytes, {
      fit: "stretch",
    });
    expect(result.skippedBlankOverlayPages).toEqual([]);
    const out = await firstPage(result.bytes);
    // Top-left quarter: the field's blue background (rgb 0.1, 0.2, 0.9).
    // Bottom: nothing. The region also holds the field's "OK", drawn at a size
    // each renderer picks — Linux CI measured blue at 177.8 where Windows
    // passed an absolute "> 180" — so the property is asserted as BLUE
    // DOMINATING RED, which a white (unapplied) or grey region cannot meet.
    const tl = regionMean(out, 0.05, 0.05, 0.45, 0.45);
    expect(tl[2] - tl[0]).toBeGreaterThan(100);
    expect(tl[0]).toBeLessThan(90);
    expect(isWhite(regionMean(out, 0.05, 0.6, 0.95, 0.95))).toBe(true);
  });

  /** An Acrobat-style stamp: a /Stamp annotation whose appearance is scaled into its /Rect. */
  async function stampAnnotationOverlay(withContent: boolean) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    if (withContent) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: 60,
        height: 40,
        color: rgb(0.1, 0.2, 0.9),
      });
    }
    const ctx = doc.context;
    // Appearance drawn in a 50×20 box, placed into a 150×100 /Rect: pdf.js
    // and Acrobat scale it (PDF 32000 §12.5.5); so must we.
    const ap = ctx.register(
      ctx.stream("0.1 0.6 0.1 rg 0 0 50 20 re f", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 50, 20],
      }),
    );
    const annot = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Stamp",
        Rect: [150, 100, 300, 200],
        F: 4,
        AP: { N: ap },
      }),
    );
    page.node.addAnnot(annot);
    return doc.save();
  }

  for (const withContent of [false, true]) {
    it(`an Acrobat-style stamp annotation is applied (${withContent ? "page also has content" : "page has no content stream"})`, async () => {
      const overlayBytes = await stampAnnotationOverlay(withContent);
      const reloaded = await PDFDocument.load(overlayBytes);
      expect(reloaded.getPage(0).node.Contents() === undefined).toBe(
        !withContent,
      );
      // Control: a viewer shows the stamp in the top-right quarter.
      const alone = await firstPage(overlayBytes);
      const green = (c: Rgb) => c[1] > 120 && c[0] < 90 && c[2] < 90;
      expect(green(regionMean(alone, 0.55, 0.05, 0.95, 0.45))).toBe(true);

      const result = await overlayPdf(
        await blankBase([300, 200]),
        overlayBytes,
        { fit: "stretch" },
      );
      const out = await firstPage(result.bytes);
      expect(green(regionMean(out, 0.55, 0.05, 0.95, 0.45))).toBe(true);
      expect(
        gridDistance(colourGrid(out, 8), colourGrid(alone, 8)),
      ).toBeLessThan(SAME);
    });
  }

  /** A page whose only content is one full-page black stamp annotation. */
  async function soleAnnotationOverlay(flags: number) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const ctx = doc.context;
    const ap = ctx.register(
      ctx.stream("0 0 0 rg 0 0 10 10 re f", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 10, 10],
      }),
    );
    page.node.addAnnot(
      ctx.register(
        ctx.obj({
          Type: "Annot",
          Subtype: "Stamp",
          Rect: [0, 0, 300, 200],
          F: flags,
          AP: { N: ap },
        }),
      ),
    );
    return doc.save();
  }

  it("a hidden annotation stays hidden: the page is blank, and a wholly blank overlay is refused by name", async () => {
    // Control: the same annotation, visible (Print flag only), is applied.
    const shown = await overlayPdf(
      await blankBase([300, 200]),
      await soleAnnotationOverlay(4),
    );
    expect(isDark(regionMean(await firstPage(shown.bytes), 0, 0, 1, 1))).toBe(
      true,
    );
    for (const hidden of [2 /* Hidden */, 32 /* NoView */]) {
      await expect(
        overlayPdf(
          await blankBase([300, 200]),
          await soleAnnotationOverlay(hidden),
        ),
      ).rejects.toThrow(/overlay page 1 is blank/i);
    }
  });

  it("names the overlay page that genuinely can't be applied, and what to try", async () => {
    const doc = await PDFDocument.create();
    drawQuadrants(doc.addPage([300, 200]), {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    const broken = doc.addPage([300, 200]);
    const ctx = doc.context;
    broken.node.set(
      PDFName.of("Contents"),
      ctx.register(ctx.stream("not decodable", { Filter: "CCITTFaxDecode" })),
    );
    const overlayBytes = await doc.save();
    const twoBase = await (async () => {
      const b = await PDFDocument.create();
      b.addPage([300, 200]);
      b.addPage([300, 200]);
      return b.save();
    })();

    await expect(
      overlayPdf(twoBase, overlayBytes, { paging: "cycle" }),
    ).rejects.toThrow(/overlay page 2\b[\s\S]*first page on all/i);
    // Only page 1 is needed when repeating, so the same file works there.
    const ok = await overlayPdf(twoBase, overlayBytes, { paging: "repeat" });
    expect(ok.pageCount).toBe(2);
  });
});
