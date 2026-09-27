import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  annotatePdf,
  findNoteOverflows,
  getAnnotatePageSizes,
  type Annotation,
} from "./annotate";
import { cropPdf } from "./crop";
import { PdfEngineError, rotatePages } from "./engine";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * Annotate, read back the way a READER receives it.
 *
 * Every assertion here is made on what pdfjs — the engine behind Firefox's
 * viewer and this site's own page previews — reports after parsing the saved
 * bytes: the page's displayed size (its viewport, which applies `/Rotate` and
 * the CropBox), where each glyph run starts and which way it reads, and the
 * bounding box and blend mode of every painted path. None of it goes through
 * annotate.ts's own coordinate mapping, so the mapping cannot certify itself.
 *
 * WHY THIS FILE EXISTS. Until 2026-09-27 annotate drew every markup at the
 * user's numbers in the page's UNROTATED content space. On a page carrying
 * `/Rotate 90` — which every page run through this site's own Rotate tool
 * carries — a highlight typed at "x 72, y 100 from bottom-left" landed
 * somewhere else on the visible page, notes read sideways, the runner showed a
 * portrait size for a landscape page, and the export said "Annotated PDF
 * ready". The unit tests were green throughout: they checked page counts and
 * sizes, never where anything landed. The only place the defect was written
 * down was a docblock.
 *
 * The rotated pages here are made by `rotatePages` and the cropped one by
 * `cropPdf` — the site's own tools — so the chain under test is the one a user
 * walks: Rotate (or Crop) → Annotate → open the PDF.
 */

interface ViewedText {
  str: string;
  /** Baseline origin, points from the DISPLAYED page's bottom-left. */
  x: number;
  y: number;
  /** Unit reading direction on the displayed page (y up). */
  dirX: number;
  dirY: number;
  /** Advance length along the reading direction. */
  width: number;
}

interface ViewedPath {
  paint: "fill" | "stroke";
  /** Bounding box on the displayed page, points from its bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Canvas composite op pdfjs will render with (`source-over` = Normal). */
  blend: string;
}

interface ViewedPage {
  rotate: number;
  width: number;
  height: number;
  texts: ViewedText[];
  paths: ViewedPath[];
}

type Matrix = [number, number, number, number, number, number];

function mul(m: Matrix, n: Matrix): Matrix {
  // pdfjs Util.transform order: apply n, then m.
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

async function readAsViewed(bytes: Uint8Array): Promise<ViewedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    useWorkerFetch: false,
    disableFontFace: true,
    standardFontDataUrl: `${pathToFileURL(join(dir, "standard_fonts")).href}/`,
  });
  const opName = new Map<number, string>(
    Object.entries(pdfjs.OPS).map(([name, code]) => [code as number, name]),
  );
  try {
    const doc = await task.promise;
    const pages: ViewedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const vt = viewport.transform as Matrix;
      const H = viewport.height;
      // Viewport space is y-down from the displayed top-left; flip to the
      // bottom-left frame the tool's copy promises.
      const toViewer = (x: number, y: number): [number, number] => {
        const [px, py] = apply(vt, x, y);
        return [px, H - py];
      };

      const texts: ViewedText[] = [];
      const content = await page.getTextContent({
        includeMarkedContent: false,
      });
      for (const raw of content.items) {
        if (!("str" in raw) || raw.str.trim().length === 0) continue;
        const m = raw.transform as Matrix;
        const [x, y] = toViewer(m[4], m[5]);
        const [ox, oy] = toViewer(0, 0);
        const [ax, ay] = toViewer(m[0], m[1]);
        const len = Math.hypot(ax - ox, ay - oy) || 1;
        texts.push({
          str: raw.str,
          x,
          y,
          dirX: (ax - ox) / len,
          dirY: (ay - oy) / len,
          width: raw.width,
        });
      }

      const paths: ViewedPath[] = [];
      const ops = await page.getOperatorList();
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      let blend = "source-over";
      const stack: { ctm: Matrix; blend: string }[] = [];
      ops.fnArray.forEach((fn, i) => {
        const name = opName.get(fn);
        const args = ops.argsArray[i] as unknown[];
        if (name === "save") stack.push({ ctm, blend });
        else if (name === "restore") {
          const top = stack.pop();
          if (top) ({ ctm, blend } = top);
        } else if (name === "transform") ctm = mul(ctm, args as Matrix);
        else if (name === "setGState") {
          for (const [key, value] of args[0] as [string, unknown][]) {
            if (key === "BM") blend = String(value);
          }
        } else if (name === "constructPath") {
          const paint = opName.get(args[0] as number) ?? "";
          const mm = Array.from(args[2] as ArrayLike<number>);
          const corners = [
            [mm[0]!, mm[1]!],
            [mm[2]!, mm[1]!],
            [mm[0]!, mm[3]!],
            [mm[2]!, mm[3]!],
          ].map(([cx, cy]) => {
            const [ux, uy] = apply(ctm, cx!, cy!);
            return toViewer(ux, uy);
          });
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          paths.push({
            paint: paint.toLowerCase().includes("fill") ? "fill" : "stroke",
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            blend,
          });
        }
      });

      pages.push({
        rotate: page.rotate,
        width: viewport.width,
        height: viewport.height,
        texts,
        paths,
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function letterPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

/** A Letter page run through the site's own Rotate tool. */
async function rotatedLetter(turn: number): Promise<Uint8Array> {
  const base = await letterPage();
  return turn === 0 ? base : rotatePages(base, [0], turn);
}

/**
 * Every value `/Rotate` can take, derived from the property that defines it —
 * a whole number of quarter turns — rather than typed as a list.
 */
const QUARTER_TURNS = Array.from({ length: 4 }, (_, q) => q * 90);

/** The markups every rotation is exercised with, in the DISPLAYED frame. */
function markups(): Annotation[] {
  return [
    {
      type: "highlight",
      page: 1,
      x: 72,
      y: 100,
      width: 200,
      height: 16,
      color: "#facc15",
    },
    {
      type: "rect",
      page: 1,
      x: 300,
      y: 200,
      width: 120,
      height: 40,
      color: "#3b82f6",
      borderWidth: 2,
    },
    {
      type: "line",
      page: 1,
      x1: 100,
      y1: 400,
      x2: 250,
      y2: 450,
      color: "#ef4444",
      thickness: 2,
    },
    {
      type: "note",
      page: 1,
      x: 72,
      y: 300,
      text: "NOTE-FIRST\nNOTE-SECOND",
      color: "#111111",
      size: 12,
    },
  ];
}

describe("annotate places markups where the reader sees them", () => {
  it("HEALTH CHECK: the fixture really is rotated, and pdfjs sees it", async () => {
    // A blind reader returns `rotate: 0` for everything, and every assertion
    // below would then pass on the defect. Require each quarter turn to arrive.
    expect(QUARTER_TURNS).toEqual([0, 90, 180, 270]);
    for (const turn of QUARTER_TURNS) {
      const [page] = await readAsViewed(await rotatedLetter(turn));
      expect(page!.rotate).toBe(turn);
      const swap = turn % 180 !== 0;
      expect([page!.width, page!.height]).toEqual(
        swap ? [792, 612] : [612, 792],
      );
    }
  });

  for (const turn of QUARTER_TURNS) {
    it(`/Rotate ${turn}: the runner's page size is the size the reader sees`, async () => {
      const bytes = await rotatedLetter(turn);
      const [viewed] = await readAsViewed(bytes);
      const [size] = await getAnnotatePageSizes(bytes);
      expect(size).toEqual({ width: viewed!.width, height: viewed!.height });
    });

    it(`/Rotate ${turn}: every markup lands at its typed coordinates, notes read left to right`, async () => {
      const result = await annotatePdf(await rotatedLetter(turn), markups());
      const [page] = await readAsViewed(result.bytes);

      // Exactly what was drawn, no more — a reader that found nothing would
      // otherwise let `find` below fail for the wrong reason, or pass.
      expect(page!.paths.filter((p) => p.paint === "fill")).toHaveLength(1);
      expect(page!.texts.map((t) => t.str)).toEqual([
        "NOTE-FIRST",
        "NOTE-SECOND",
      ]);

      const highlight = page!.paths.find((p) => p.paint === "fill")!;
      expect(highlight.x).toBeCloseTo(72, 1);
      expect(highlight.y).toBeCloseTo(100, 1);
      expect(highlight.width).toBeCloseTo(200, 1);
      expect(highlight.height).toBeCloseTo(16, 1);

      const box = page!.paths.find(
        (p) => p.paint === "stroke" && Math.abs(p.width - 120) < 1,
      );
      expect(
        box,
        "the outlined box, 120 x 40 on the displayed page",
      ).toBeTruthy();
      expect(box!.x).toBeCloseTo(300, 1);
      expect(box!.y).toBeCloseTo(200, 1);
      expect(box!.height).toBeCloseTo(40, 1);

      const line = page!.paths.find(
        (p) => p.paint === "stroke" && Math.abs(p.width - 150) < 1,
      );
      expect(
        line,
        "the line, spanning 150 x 50 on the displayed page",
      ).toBeTruthy();
      expect(line!.x).toBeCloseTo(100, 1);
      expect(line!.y).toBeCloseTo(400, 1);
      expect(line!.height).toBeCloseTo(50, 1);

      // Each wrapped line is placed in the DISPLAYED frame: the second
      // baseline sits one line-height BELOW the first on the visible page,
      // not beside it.
      const [first, second] = page!.texts;
      for (const text of [first!, second!]) {
        expect(text.dirX).toBeCloseTo(1, 5);
        expect(text.dirY).toBeCloseTo(0, 5);
        expect(text.x).toBeCloseTo(72, 1);
      }
      expect(first!.y).toBeCloseTo(300, 1);
      expect(second!.y).toBeCloseTo(300 - 12 * 1.18, 1);
    });
  }

  it("a page cropped with the site's Crop tool measures from the crop's corner", async () => {
    const cropped = await cropPdf(await letterPage(), {
      margins: { top: 30, right: 40, bottom: 50, left: 60 },
    });
    const [viewed] = await readAsViewed(cropped);
    const [size] = await getAnnotatePageSizes(cropped);
    expect(size).toEqual({ width: viewed!.width, height: viewed!.height });
    expect(size).toEqual({ width: 612 - 100, height: 792 - 80 });

    const result = await annotatePdf(cropped, [
      {
        type: "highlight",
        page: 1,
        x: 10,
        y: 10,
        width: 50,
        height: 20,
        color: "#facc15",
      },
    ]);
    const [page] = await readAsViewed(result.bytes);
    const fill = page!.paths.find((p) => p.paint === "fill")!;
    expect(fill.x).toBeCloseTo(10, 1);
    expect(fill.y).toBeCloseTo(10, 1);
  });
});

describe("a highlight marks the text under it instead of painting over it", () => {
  it("the highlight is composited with Multiply; nothing else is", async () => {
    const result = await annotatePdf(await letterPage(), [
      ...markups(),
      {
        type: "highlight",
        page: 1,
        x: 72,
        y: 600,
        width: 100,
        height: 16,
        color: "#34d399",
        opacity: 1,
      },
    ]);
    const [page] = await readAsViewed(result.bytes);
    const fills = page!.paths.filter((p) => p.paint === "fill");
    const strokes = page!.paths.filter((p) => p.paint === "stroke");
    // Health: both highlights and the three stroked shapes arrived.
    expect(fills).toHaveLength(2);
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    for (const fill of fills) expect(fill.blend).toBe("multiply");
    // Positive control: the box and the line are ordinary strokes. A reader
    // that reported "multiply" for everything would fail here.
    for (const stroke of strokes) expect(stroke.blend).toBe("source-over");
  });
});

describe("a note that would leave the page is refused, not clipped", () => {
  const LONG =
    "This sentence is deliberately long enough that no reasonable wrap keeps it narrow";

  async function attempt(note: Partial<Annotation>, bytes?: Uint8Array) {
    return annotatePdf(bytes ?? (await letterPage()), [
      {
        type: "note",
        page: 1,
        x: 72,
        y: 700,
        text: "fits",
        color: "#111111",
        size: 14,
        ...note,
      } as Annotation,
    ]);
  }

  it("POSITIVE CONTROL: a three-line note that fits exports, and every glyph is on the page", async () => {
    const result = await attempt({
      x: 72,
      y: 700,
      text: "one\ntwo\nthree",
    });
    const [page] = await readAsViewed(result.bytes);
    expect(page!.texts.map((t) => t.str)).toEqual(["one", "two", "three"]);
    for (const text of page!.texts) {
      expect(text.x).toBeGreaterThanOrEqual(0);
      expect(text.x + text.width).toBeLessThanOrEqual(page!.width);
      expect(text.y).toBeGreaterThan(0);
      expect(text.y).toBeLessThan(page!.height);
    }
  });

  it("refuses a note whose line runs past the right edge", async () => {
    await expect(
      attempt({ x: 450, text: LONG, maxWidth: 220 }),
    ).rejects.toThrow(/Markup 1: .*right edge/);
  });

  it("refuses a note whose later lines fall below the bottom edge", async () => {
    await expect(
      attempt({ x: 72, y: 20, text: "one\ntwo\nthree" }),
    ).rejects.toThrow(/Markup 1: .*bottom edge/);
  });

  it("refuses a note whose first line rises above the top edge", async () => {
    await expect(attempt({ x: 72, y: 790, text: "top" })).rejects.toThrow(
      /Markup 1: .*top edge/,
    );
  });

  it("measures against the DISPLAYED page on a rotated page", async () => {
    // Displayed 792 wide: x 600 + a ~150 pt line fits here and would not on
    // the unrotated 612 pt width.
    const rotated = await rotatedLetter(90);
    const result = await attempt(
      { x: 600, y: 300, text: "fits on landscape" },
      rotated,
    );
    const [page] = await readAsViewed(result.bytes);
    const [text] = page!.texts;
    expect(text!.x + text!.width).toBeLessThanOrEqual(page!.width);
    // And the displayed height is 612: a first line at y 605 rises past it.
    await expect(
      attempt({ x: 72, y: 605, text: "top" }, rotated),
    ).rejects.toThrow(/top edge/);
  });

  it("the runner's add-time check reports exactly what Apply would refuse", async () => {
    // The two surfaces must agree: a check the runner runs when a markup is
    // added, and the one the engine runs on Apply. Each case is run through
    // BOTH and compared, so neither can drift into refusing what the other
    // allows.
    const bytes = await letterPage();
    const sizes = await getAnnotatePageSizes(bytes);
    const cases: Partial<Annotation>[] = [
      { x: 72, y: 700, text: "one\ntwo\nthree" },
      { x: 450, text: LONG, maxWidth: 220 },
      { x: 72, y: 20, text: "one\ntwo\nthree" },
      { x: 72, y: 790, text: "top" },
    ];
    let refused = 0;
    for (const over of cases) {
      const note = {
        type: "note",
        page: 1,
        x: 72,
        y: 700,
        text: "fits",
        color: "#111111",
        size: 14,
        ...over,
      } as Annotation;
      const early = await findNoteOverflows([note], sizes);
      const outcome = await annotatePdf(bytes, [note]).then(
        () => null,
        (error: unknown) => error,
      );
      if (early.length === 0) {
        expect(outcome).toBeNull();
      } else {
        refused += 1;
        expect(outcome).toBeInstanceOf(PdfEngineError);
        expect((outcome as Error).message).toBe(early[0]!.message);
      }
    }
    // Health: the corpus exercises both branches.
    expect(refused).toBe(3);
  });
});
