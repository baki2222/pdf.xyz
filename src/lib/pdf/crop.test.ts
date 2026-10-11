// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { normalizeAngle, PdfEngineError } from "./engine";
import {
  cropPdf,
  croppedOutputName,
  getPageSizes,
  insetBox,
  isEmptyMargins,
  MIN_CROP_DIMENSION,
  NO_CROP,
  type CropMargins,
} from "./crop";

async function blankPdf(
  pages: number,
  size: [number, number] = [600, 800],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage(size);
  return doc.save();
}

describe("insetBox", () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };

  it("insets each edge and shifts the origin by left/bottom", () => {
    expect(insetBox(box, { top: 10, right: 20, bottom: 30, left: 40 })).toEqual(
      {
        x: 40,
        y: 30,
        width: 540,
        height: 760,
      },
    );
  });

  it("clamps negative margins to zero", () => {
    expect(insetBox(box, { top: -5, right: -1, bottom: 0, left: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 800,
    });
  });

  it("returns null when the remaining region would be degenerate", () => {
    expect(
      insetBox(box, { top: 0, right: 590, bottom: 0, left: 20 }),
    ).toBeNull();
  });

  it("allows a box exactly at the minimum dimension", () => {
    const result = insetBox(box, {
      top: 0,
      right: 600 - MIN_CROP_DIMENSION,
      bottom: 0,
      left: 0,
    });
    expect(result?.width).toBe(MIN_CROP_DIMENSION);
  });
});

describe("isEmptyMargins", () => {
  it("is true only when every edge is zero or less", () => {
    expect(isEmptyMargins({ top: 0, right: 0, bottom: 0, left: 0 })).toBe(true);
    expect(isEmptyMargins({ top: 0, right: 1, bottom: 0, left: 0 })).toBe(
      false,
    );
  });
});

describe("cropPdf", () => {
  it("shrinks every page's crop box and keeps the page count", async () => {
    const input = await blankPdf(3);
    const output = await cropPdf(input, {
      margins: { top: 50, right: 40, bottom: 30, left: 20 },
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
    const crop = doc.getPage(0).getCropBox();
    expect(crop.width).toBeCloseTo(600 - 20 - 40);
    expect(crop.height).toBeCloseTo(800 - 50 - 30);
    expect(crop.x).toBeCloseTo(20);
    expect(crop.y).toBeCloseTo(30);
  });

  it("crops only the selected pages", async () => {
    const input = await blankPdf(2);
    const output = await cropPdf(input, {
      margins: { top: 0, right: 0, bottom: 0, left: 100 },
      pages: [1],
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPage(0).getCropBox().width).toBeCloseTo(600);
    expect(doc.getPage(1).getCropBox().width).toBeCloseTo(500);
  });

  it("throws when every margin is zero", async () => {
    await expect(
      cropPdf(await blankPdf(1), {
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).rejects.toThrow(PdfEngineError);
  });

  it("throws when the margins exceed the page", async () => {
    await expect(
      cropPdf(await blankPdf(1), {
        margins: { top: 0, right: 0, bottom: 0, left: 599 },
      }),
    ).rejects.toThrow(/larger than page 1/i);
  });

  it("stamps our creator metadata", async () => {
    const output = await cropPdf(await blankPdf(1), {
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("reads page sizes", async () => {
    const sizes = await getPageSizes(await blankPdf(2, [420, 640]));
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toEqual({ width: 420, height: 640 });
  });

  it("names the download from the source", () => {
    expect(croppedOutputName("report.pdf")).toBe("report-cropped.pdf");
  });
});

/* ------------------------------------------------------------------ *
 * Crop, as a READER sees it.
 *
 * Until 2026-09-27 every test above ran on an unrotated page, and so did the
 * e2e proof — which is why nobody saw that per-side margins were applied in
 * pdf-lib's unrotated content space. On a `/Rotate 90` page (a landscape scan
 * stored portrait, or any file that went through our own Rotate PDF) "Top
 * 100 pt" cut 100 pt off the edge the reader sees on the RIGHT, and the preview
 * drew a portrait page for a page the reader sees as landscape.
 *
 * So the oracle here is not our geometry: it is pdfjs — the renderer our own
 * previews use — reading the SAVED file. Its viewport applies `/Rotate` and the
 * effective crop itself. The question is only "did each edge the reader sees
 * lose exactly what was asked of it?".
 * ------------------------------------------------------------------ */

const require = createRequire(import.meta.url);

type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
function pdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<Pdfjs>;
  return pdfjsPromise;
}

/** Every `/Rotate` the spec allows — the whole domain, derived, not typed. */
const ROTATIONS = [
  ...new Set(Array.from({ length: 4 }, (_, k) => normalizeAngle(k * 90))),
];

/** The edges a user can set, derived from the type's own zero value. */
const EDGES = Object.keys(NO_CROP) as (keyof CropMargins)[];

/** Page-box shapes a real upload carries, as `[x0, y0, x1, y1]`. */
const BOX_SHAPES: {
  label: string;
  media: [number, number, number, number];
  crop?: [number, number, number, number];
}[] = [
  { label: "portrait at origin", media: [0, 0, 400, 600] },
  { label: "offset MediaBox", media: [100, 200, 500, 800] },
  { label: "inset CropBox", media: [0, 0, 400, 600], crop: [36, 48, 364, 552] },
  {
    // A CropBox wider than the MediaBox: the reader sees only the overlap, so
    // a margin must come off the overlap, not off the part nobody can see.
    label: "CropBox overhanging the MediaBox",
    media: [0, 0, 400, 600],
    crop: [-50, 0, 450, 600],
  },
];

async function shapedPage(
  rotation: number,
  shape: (typeof BOX_SHAPES)[number],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [x0, y0, x1, y1] = shape.media;
  const page = doc.addPage([x1 - x0, y1 - y0]);
  page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
  if (shape.crop) {
    const [cx0, cy0, cx1, cy1] = shape.crop;
    page.setCropBox(cx0, cy0, cx1 - cx0, cy1 - cy0);
  }
  page.setRotation(degrees(rotation));
  return doc.save();
}

interface Displayed {
  /** Displayed size of the page, in points. */
  width: number;
  height: number;
  /** The page's visible region (pdfjs `view`), in content space. */
  view: [number, number, number, number];
  /** Content point → displayed point, exactly as pdfjs maps it. */
  toView: (x: number, y: number) => [number, number];
  rotate: number;
}

/** Open page 1 of `bytes` the way a viewer does. */
async function asDisplayed(bytes: Uint8Array): Promise<Displayed> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const [a, b, c, d, e, f] = viewport.transform as number[];
  const shown: Displayed = {
    width: viewport.width,
    height: viewport.height,
    view: [...page.view] as Displayed["view"],
    toView: (x, y) => [a! * x + c! * y + e!, b! * x + d! * y + f!],
    rotate: page.rotate,
  };
  await task.destroy();
  return shown;
}

/**
 * How far the BEFORE page's visible region sticks out past each displayed edge
 * of the AFTER page — i.e. what the reader lost on each side.
 */
function lostPerEdge(before: Displayed, after: Displayed): CropMargins {
  const [x0, y0, x1, y1] = before.view;
  const pts = [
    after.toView(x0, y0),
    after.toView(x1, y0),
    after.toView(x0, y1),
    after.toView(x1, y1),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    left: -Math.min(...xs),
    top: -Math.min(...ys),
    right: Math.max(...xs) - after.width,
    bottom: Math.max(...ys) - after.height,
  };
}

function expectLost(got: CropMargins, want: CropMargins, where: string) {
  for (const edge of EDGES) {
    expect(
      Math.abs(got[edge] - want[edge]),
      `${where}: the reader lost ${got[edge].toFixed(2)} pt on the ${edge}, asked for ${want[edge]}`,
    ).toBeLessThan(0.01);
  }
}

describe("cropPdf as a viewer displays the result", () => {
  it("the instrument sees nothing lost on an uncropped page, and sees a real rotation", async () => {
    expect(ROTATIONS).toHaveLength(4);
    expect(EDGES).toHaveLength(4);
    for (const rotation of ROTATIONS) {
      const shown = await asDisplayed(
        await shapedPage(rotation, BOX_SHAPES[0]!),
      );
      // Health check: a page compared with itself lost nothing on any edge…
      expectLost(lostPerEdge(shown, shown), NO_CROP, `rotate ${rotation}`);
      // …and pdfjs applied the flag, so this is not an unrotated run in disguise.
      expect(shown.rotate).toBe(rotation);
      const quarter = rotation === 90 || rotation === 270;
      expect([shown.width, shown.height]).toEqual(
        quarter ? [600, 400] : [400, 600],
      );
    }
  });

  it("the instrument sees a crop on the edge where it happened (positive control)", async () => {
    // Trim the content's top by hand, with no cropPdf involved. At /Rotate 0
    // that is the displayed top; at /Rotate 90 the content top is displayed
    // on the RIGHT — the instrument must tell those apart.
    for (const [rotation, edge] of [
      [0, "top"],
      [90, "right"],
    ] as const) {
      const input = await shapedPage(rotation, BOX_SHAPES[0]!);
      const doc = await PDFDocument.load(input);
      doc.getPage(0).setCropBox(0, 0, 400, 500);
      expectLost(
        lostPerEdge(
          await asDisplayed(input),
          await asDisplayed(await doc.save()),
        ),
        { ...NO_CROP, [edge]: 100 },
        `hand-cropped control at rotate ${rotation}`,
      );
    }
  });

  it("every edge loses exactly its own margin, on every rotation and box shape", async () => {
    // Distinct values per edge, so any permutation of edges shows up.
    const margins: CropMargins = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(new Set(EDGES.map((e) => margins[e])).size).toBe(EDGES.length);
    let checked = 0;
    for (const rotation of ROTATIONS) {
      for (const shape of BOX_SHAPES) {
        const where = `rotate ${rotation}, ${shape.label}`;
        const input = await shapedPage(rotation, shape);
        const before = await asDisplayed(input);
        const after = await asDisplayed(await cropPdf(input, { margins }));
        expect(after.rotate, where).toBe(rotation);
        expectLost(lostPerEdge(before, after), margins, where);
        checked += 1;
      }
    }
    expect(checked).toBe(ROTATIONS.length * BOX_SHAPES.length);
  });

  it("a single edge crops that edge only — the Per side case a reader sets", async () => {
    let checked = 0;
    for (const rotation of ROTATIONS) {
      for (const edge of EDGES) {
        const where = `rotate ${rotation}, ${edge} only`;
        const margins = { ...NO_CROP, [edge]: 100 };
        const input = await shapedPage(rotation, BOX_SHAPES[0]!);
        const before = await asDisplayed(input);
        const after = await asDisplayed(await cropPdf(input, { margins }));
        expectLost(lostPerEdge(before, after), margins, where);
        checked += 1;
      }
    }
    expect(checked).toBe(ROTATIONS.length * EDGES.length);
  });

  it("writes the CropBox a 90° page needs: the displayed top is the content's left", async () => {
    // pdfjs above is the oracle; this pins the literal box so a reader of the
    // test can see the mapping. /Rotate 90 turns the page clockwise, which
    // carries the content's LEFT edge to the displayed TOP.
    const output = await cropPdf(await shapedPage(90, BOX_SHAPES[0]!), {
      margins: { ...NO_CROP, top: 100 },
    });
    const box = (await PDFDocument.load(output)).getPage(0).getCropBox();
    expect(box).toEqual({ x: 100, y: 0, width: 300, height: 600 });
  });

  it("measures the too-large check on the displayed axis", async () => {
    // 400x600 content at /Rotate 90 displays 600 wide and 400 tall: 500 pt off
    // the left leaves a 100 pt wide page, which is valid…
    const rotated = await shapedPage(90, BOX_SHAPES[0]!);
    await expect(
      cropPdf(rotated, { margins: { ...NO_CROP, left: 500 } }),
    ).resolves.toBeInstanceOf(Uint8Array);
    // …while 390 pt off the top of a page displayed 400 tall is not.
    await expect(
      cropPdf(rotated, { margins: { ...NO_CROP, top: 390 } }),
    ).rejects.toThrow(/larger than page 1/i);
  });

  it("reports each page's size as displayed, so the preview has the reader's shape", async () => {
    let checked = 0;
    for (const rotation of ROTATIONS) {
      for (const shape of BOX_SHAPES) {
        const input = await shapedPage(rotation, shape);
        const shown = await asDisplayed(input);
        const [size] = await getPageSizes(input);
        const where = `rotate ${rotation}, ${shape.label}`;
        expect(size?.width, where).toBeCloseTo(shown.width, 6);
        expect(size?.height, where).toBeCloseTo(shown.height, 6);
        checked += 1;
      }
    }
    expect(checked).toBe(ROTATIONS.length * BOX_SHAPES.length);
  });
});
