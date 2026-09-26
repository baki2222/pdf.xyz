import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import {
  checkEditTextFit,
  editPdf,
  getEditPageSizes,
  type EditOp,
  type TextEditOp,
} from "./edit";

/**
 * Edit PDF, read back the way a READER receives it.
 *
 * Every assertion here goes through pdfjs — the engine behind our own previews
 * and Firefox's viewer — and its viewport transform, which is where `/Rotate`
 * and the CropBox are applied. Nothing reads edit.ts's own arithmetic back to
 * itself: a hand-derived formula checked against the same hand-derived formula
 * is how the original defect shipped.
 *
 * The defect (audit at 67e8d0f): coordinates were taken in the page's unrotated
 * MediaBox. Our own Rotate PDF writes `/Rotate`, our own Crop PDF writes a
 * CropBox, and on those pages a caption at "x 72, y 100" came out sideways, at
 * another corner, or outside the visible page — while the UI reported the page
 * as its unrotated MediaBox size.
 *
 * And a second one: text was validated at its ANCHOR only. A default-sized line
 * of ~80 characters ran off the right edge, the viewer clipped it silently, and
 * the tool said "Edited PDF ready".
 */

type Box = [number, number, number, number];

interface ViewerRead {
  width: number;
  height: number;
  texts: {
    str: string;
    x: number;
    y: number;
    width: number;
    upright: boolean;
  }[];
  /** Path bounding boxes in the viewer's frame (bottom-left origin, y up). */
  paths: Box[];
  images: Box[];
}

type Matrix = [number, number, number, number, number, number];

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

function bboxOf(points: [number, number][]): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Page 1 as pdfjs presents it: viewer-frame text, path and image positions. */
async function readAsViewer(bytes: Uint8Array): Promise<ViewerRead> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const view = vp.transform as Matrix;
    // pdfjs's viewport is y-down from the top-left; flip to the bottom-left
    // frame the tool's coordinates are expressed in.
    const toViewer = (m: Matrix, x: number, y: number): [number, number] => {
      const [vx, vy] = apply(mul(view, m), x, y);
      return [vx, vp.height - vy];
    };

    const content = await page.getTextContent();
    const texts: ViewerRead["texts"] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const m = mul(view, item.transform as Matrix);
      texts.push({
        str: item.str,
        x: m[4],
        y: vp.height - m[5],
        width: item.width,
        // Upright in the viewport: glyph x-axis along +x, y-axis up the screen.
        upright:
          m[0] > 0 &&
          Math.abs(m[1]) < 1e-6 &&
          Math.abs(m[2]) < 1e-6 &&
          m[3] < 0,
      });
    }

    const { OPS } = pdfjs;
    const list = await page.getOperatorList();
    const paths: Box[] = [];
    const images: Box[] = [];
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    list.fnArray.forEach((fn, i) => {
      const args = list.argsArray[i] as unknown[];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as Matrix);
      else if (fn === OPS.constructPath) {
        // args: [paint op, [path data], minMax]. Path data is a flat list of
        // drawing ops: 0 moveTo(x,y) 1 lineTo(x,y) 2 curveTo(6) 3 quad(4) 4 close.
        const data = Array.from((args[1] as ArrayLike<number>[])[0] ?? []);
        const pts: [number, number][] = [];
        for (let k = 0; k < data.length;) {
          const op = data[k++]!;
          const n = op === 2 ? 6 : op === 3 ? 4 : op === 4 ? 0 : 2;
          for (let j = 0; j < n; j += 2) {
            pts.push(toViewer(ctm, data[k + j]!, data[k + j + 1]!));
          }
          k += n;
        }
        if (pts.length > 0) paths.push(bboxOf(pts));
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject
      ) {
        images.push(
          bboxOf([
            toViewer(ctm, 0, 0),
            toViewer(ctm, 1, 0),
            toViewer(ctm, 0, 1),
            toViewer(ctm, 1, 1),
          ]),
        );
      }
    });
    return { width: vp.width, height: vp.height, texts, paths, images };
  } finally {
    await task.destroy();
  }
}

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);

const TOL = 0.05;
const near = (a: Box, b: Box) => a.every((v, i) => Math.abs(v - b[i]!) < TOL);

/** A one-page Letter PDF with the page geometry our own tools write. */
async function letterPage(opts: {
  rotate: number;
  crop?: Box;
  media?: Box;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (opts.media) page.setMediaBox(...opts.media);
  if (opts.crop) page.setCropBox(...opts.crop);
  page.setRotation(degrees(opts.rotate));
  return doc.save();
}

/**
 * The geometries under test. "uncropped" is the positive control: a plain
 * page, where the fix must change nothing. The others are what Rotate PDF and
 * Crop PDF produce, plus a MediaBox whose origin is not 0,0.
 */
const BOXES: { name: string; crop?: Box; media?: Box }[] = [
  { name: "uncropped" },
  { name: "cropped (Crop PDF)", crop: [40, 55, 520, 690] },
  { name: "offset MediaBox", media: [100, 50, 500, 700] },
];
const ROTATIONS = [0, 90, 180, 270];

// Every op sits inside 480 × 480 so it fits the smallest displayed page above.
const OPS_IN_VIEWER_FRAME: EditOp[] = [
  {
    type: "text",
    page: 1,
    x: 72,
    y: 100,
    text: "PLACED",
    color: "#111111",
    size: 16,
  },
  {
    type: "text",
    page: 1,
    x: 250,
    y: 400,
    text: "LINEONE\nLINETWO",
    color: "#111111",
    size: 12,
  },
  {
    type: "rect",
    page: 1,
    x: 100,
    y: 200,
    width: 80,
    height: 30,
    color: "#ff0000",
  },
  {
    type: "rect",
    page: 1,
    x: 300,
    y: 250,
    width: 60,
    height: 40,
    color: "#0000ff",
    filled: false,
  },
  {
    type: "line",
    page: 1,
    x1: 300,
    y1: 50,
    x2: 350,
    y2: 120,
    color: "#000000",
  },
  {
    type: "line",
    page: 1,
    x1: 20,
    y1: 300,
    x2: 120,
    y2: 300,
    color: "#000000",
    arrow: true,
    thickness: 2,
  },
  {
    type: "image",
    page: 1,
    x: 200,
    y: 300,
    width: 40,
    height: 20,
    format: "png",
    bytes: PNG_1X1,
  },
];

describe("Edit PDF places content where the reader sees it", () => {
  for (const box of BOXES) {
    for (const rotate of ROTATIONS) {
      it(`${box.name}, /Rotate ${rotate}`, async () => {
        const base = await letterPage({
          rotate,
          crop: box.crop,
          media: box.media,
        });
        const out = await editPdf(base, OPS_IN_VIEWER_FRAME);
        const read = await readAsViewer(out.bytes);

        // The UI's page size IS the size the reader sees — the composed chain,
        // not edit.ts's opinion of itself.
        expect(await getEditPageSizes(base)).toEqual([
          { width: read.width, height: read.height },
        ]);

        // Health: the reader found what was drawn. A blind reader would pass
        // every "is inside" assertion below vacuously.
        expect(read.texts.map((t) => t.str).sort()).toEqual([
          "LINEONE",
          "LINETWO",
          "PLACED",
        ]);
        expect(read.paths.length).toBe(6); // 2 rects, 2 lines, 2 arrowhead strokes
        expect(read.images.length).toBe(1);

        const text = (s: string) => read.texts.find((t) => t.str === s)!;
        for (const t of read.texts) expect(t.upright, t.str).toBe(true);
        expect(text("PLACED").x).toBeCloseTo(72, 1);
        expect(text("PLACED").y).toBeCloseTo(100, 1);
        // Wrapped lines flow DOWN the viewer's page, at the same x.
        expect(text("LINEONE").x).toBeCloseTo(250, 1);
        expect(text("LINEONE").y).toBeCloseTo(400, 1);
        expect(text("LINETWO").x).toBeCloseTo(250, 1);
        expect(text("LINETWO").y).toBeCloseTo(400 - 12 * 1.18, 1);

        const hasPath = (b: Box) => read.paths.some((p) => near(p, b));
        expect(hasPath([100, 200, 180, 230]), "filled box").toBe(true);
        expect(hasPath([300, 250, 360, 290]), "outlined box").toBe(true);
        expect(hasPath([300, 50, 350, 120]), "line").toBe(true);
        expect(hasPath([20, 300, 120, 300]), "arrow shaft").toBe(true);
        // The two arrowhead strokes sit BEHIND the tip (120, 300) in the
        // viewer's frame — the head points the way the user drew the arrow.
        const heads = read.paths.filter(
          (p) => Math.abs(p[2] - 120) < TOL && p[0] < 120 - 1 && p[0] > 100,
        );
        expect(heads.length).toBe(2);
        expect(near(read.images[0]!, [200, 300, 240, 320]), "image").toBe(true);

        // And nothing lands outside the visible page.
        for (const b of [...read.paths, ...read.images]) {
          expect(b[0]).toBeGreaterThanOrEqual(-TOL);
          expect(b[1]).toBeGreaterThanOrEqual(-TOL);
          expect(b[2]).toBeLessThanOrEqual(read.width + TOL);
          expect(b[3]).toBeLessThanOrEqual(read.height + TOL);
        }
      });
    }
  }

  it("draws a plain page exactly as it always did (positive control)", async () => {
    // On an unrotated page whose box starts at 0,0 the mapping is the
    // identity, so the operators a reader receives must be the ones pdf-lib
    // produced from the raw coordinates before the fix.
    const base = await letterPage({ rotate: 0 });
    const ops = OPS_IN_VIEWER_FRAME.filter((op) => op.type !== "image");
    const viaTool = await editPdf(base, ops);

    const doc = await PDFDocument.load(base);
    const page = doc.getPage(0);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const hex = (c: string) => {
      const n = parseInt(c.slice(1), 16);
      return rgb(
        ((n >> 16) & 255) / 255,
        ((n >> 8) & 255) / 255,
        (n & 255) / 255,
      );
    };
    page.drawText("PLACED", {
      x: 72,
      y: 100,
      size: 16,
      font,
      color: hex("#111111"),
      opacity: 1,
    });
    page.drawText("LINEONE", {
      x: 250,
      y: 400,
      size: 12,
      font,
      color: hex("#111111"),
      opacity: 1,
    });
    page.drawText("LINETWO", {
      x: 250,
      y: 400 - 12 * 1.18,
      size: 12,
      font,
      color: hex("#111111"),
      opacity: 1,
    });
    page.drawRectangle({
      x: 100,
      y: 200,
      width: 80,
      height: 30,
      color: hex("#ff0000"),
      opacity: 1,
    });
    page.drawRectangle({
      x: 300,
      y: 250,
      width: 60,
      height: 40,
      borderColor: hex("#0000ff"),
      borderWidth: 1.5,
      borderOpacity: 1,
    });
    page.drawLine({
      start: { x: 300, y: 50 },
      end: { x: 350, y: 120 },
      thickness: 1.5,
      color: hex("#000000"),
      opacity: 1,
    });
    const direct = await doc.save();

    const [a, b] = await Promise.all([
      readAsViewer(viaTool.bytes),
      readAsViewer(direct),
    ]);
    expect(a.texts).toEqual(b.texts);
    // The tool also draws the arrow; the direct draw does not.
    expect(a.paths.slice(0, b.paths.length)).toEqual(b.paths);
  });
});

/* ------------------------------------------------------------------ *
 *  Text must fit the page it is drawn on
 * ------------------------------------------------------------------ */

async function helvetica() {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

/** A sentence, not a repeated letter: real word breaks for the wrap control. */
const SENTENCE =
  "Please review the attached figures before Friday and return any corrections to the finance team.";

const text = (over: Partial<TextEditOp>): TextEditOp => ({
  type: "text",
  page: 1,
  // The runner's defaults: x 72, 16 pt, no wrap.
  x: 72,
  y: 690,
  size: 16,
  color: "#111111",
  text: SENTENCE,
  ...over,
});

describe("Edit PDF refuses text that would be clipped at a page edge", () => {
  it("the example really overflows at the runner's defaults (health check)", async () => {
    const width = (await helvetica()).widthOfTextAtSize(SENTENCE, 16);
    expect(72 + width).toBeGreaterThan(612);
  });

  it("refuses an unwrapped line that runs past the right edge", async () => {
    const base = await letterPage({ rotate: 0 });
    await expect(editPdf(base, [text({})])).rejects.toThrow(
      /Edit 1: the text runs past the right edge of the 612×792 pt page.*Wrap width of 540 pt/,
    );
  });

  it("draws the same sentence once wrapped, every line inside the page (positive control)", async () => {
    const base = await letterPage({ rotate: 0 });
    const out = await editPdf(base, [text({ maxWidth: 540 })]);
    const read = await readAsViewer(out.bytes);
    expect(read.texts.length).toBeGreaterThan(1);
    expect(read.texts.map((t) => t.str).join(" ")).toBe(SENTENCE);
    for (const t of read.texts) {
      expect(t.x + t.width).toBeLessThanOrEqual(612 + 0.5);
    }
  });

  it("refuses a wrap width wider than the room left of the anchor", async () => {
    const base = await letterPage({ rotate: 0 });
    await expect(editPdf(base, [text({ maxWidth: 1000 })])).rejects.toThrow(
      /right edge/,
    );
  });

  it("refuses many lines that run below the bottom", async () => {
    const base = await letterPage({ rotate: 0 });
    await expect(
      editPdf(base, [text({ y: 40, text: "one\ntwo\nthree\nfour\nfive" })]),
    ).rejects.toThrow(/Edit 1: the text runs below the bottom/);
    // Control: one line with its baseline ON the bottom edge is not refused
    // for its descenders.
    await expect(
      editPdf(base, [text({ y: 0, text: "bottom line" })]),
    ).resolves.toBeTruthy();
  });

  it("refuses a first line whose ascent runs above the top", async () => {
    const base = await letterPage({ rotate: 0 });
    await expect(
      editPdf(base, [text({ y: 790, text: "top line" })]),
    ).rejects.toThrow(/above the top/);
    const ascent = (await helvetica()).heightAtSize(16, { descender: false });
    await expect(
      editPdf(base, [text({ y: 792 - ascent, text: "top line" })]),
    ).resolves.toBeTruthy();
  });

  it("measures against the DISPLAYED width: a line too wide for portrait fits landscape", async () => {
    const font = await helvetica();
    // Derive the example from the font rather than typing one.
    let line = "";
    for (const word of `${SENTENCE} ${SENTENCE}`.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (72 + font.widthOfTextAtSize(next, 16) > 792 - 10) break;
      line = next;
    }
    const w = font.widthOfTextAtSize(line, 16);
    expect(72 + w).toBeGreaterThan(612);
    expect(72 + w).toBeLessThan(792);

    await expect(
      editPdf(await letterPage({ rotate: 0 }), [text({ text: line, y: 500 })]),
    ).rejects.toThrow(/right edge/);
    const out = await editPdf(await letterPage({ rotate: 90 }), [
      text({ text: line, y: 500 }),
    ]);
    const read = await readAsViewer(out.bytes);
    expect(read.width).toBe(792);
    expect(read.texts.length).toBe(1);
    expect(read.texts[0]!.upright).toBe(true);
    expect(read.texts[0]!.x + read.texts[0]!.width).toBeLessThanOrEqual(792);
  });

  it("the runner's add-time check gives the export's answer", async () => {
    // Every text case above, asked of both. A check that disagreed with the
    // export would either block good edits or wave clipped ones through.
    const sizes = [{ width: 612, height: 792 }];
    const cases: TextEditOp[] = [
      text({}),
      text({ maxWidth: 540 }),
      text({ maxWidth: 1000 }),
      text({ y: 40, text: "one\ntwo\nthree\nfour\nfive" }),
      text({ y: 0, text: "bottom line" }),
      text({ y: 790, text: "top line" }),
      text({ y: 700, text: "fits" }),
    ];
    const base = await letterPage({ rotate: 0 });
    let refused = 0;
    for (const op of cases) {
      const issues = await checkEditTextFit([op], sizes);
      const exported = await editPdf(base, [op]).then(
        () => null,
        (e: Error) => e.message,
      );
      expect(issues.length > 0, JSON.stringify(op)).toBe(exported !== null);
      if (exported !== null) {
        refused++;
        expect(exported).toBe(issues[0]!.message);
      }
    }
    // Both directions exercised.
    expect(refused).toBe(4);
    expect(cases.length - refused).toBe(3);
  });
});
