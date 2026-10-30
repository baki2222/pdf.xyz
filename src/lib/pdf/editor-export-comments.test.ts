// @native-canvas
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { renderPdfPages, regionMean } from "@/tests/pdf-render";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { awaitPdfjsDocument } from "./pdfjs";
import { exportEditedPdf } from "./editor-export";
import { snapHighlightQuads } from "./editor/comments";
import {
  DEFAULT_TEXT_STYLE,
  type EditorObject,
  type Rect,
} from "./editor/model";
import type { TextRun } from "./editor/runs";

/**
 * "Save markups as comments": the editor's highlights, drawings, notes,
 * shapes and lines written as real PDF annotations, read back the way a
 * READER receives them — pdf.js's `getAnnotations()` for what a comment
 * panel lists, its viewport for where each one sits on the page as
 * displayed (`/Rotate` applied), and its renderer for what it paints.
 * Nothing here reads the export's own mapping back to itself.
 */

const TOL = 1; // ±1 pt, the editor's promise

async function blankPage(rotate = 0, text?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  if (text) {
    p.drawText(text, {
      x: 100,
      y: 600,
      size: 20,
      font: await doc.embedFont(StandardFonts.Helvetica),
    });
  }
  p.setRotation(degrees(rotate));
  return doc.save();
}

interface ReadAnnotation {
  subtype: string;
  /** The annotation's /Rect on the DISPLAYED page, viewer points, top-left origin. */
  box: Rect;
  color: [number, number, number] | null;
  contents: string;
  /** Quads on the displayed page, viewer points. */
  quads: Rect[];
  /** Line ends on the displayed page, viewer points. */
  line: { x: number; y: number }[];
  inkPoints: number;
  hasAppearance: boolean;
}

async function readAnnotations(bytes: Uint8Array): Promise<{
  annotations: ReadAnnotation[];
  text: string;
}> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  const doc = await awaitPdfjsDocument(task);
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const toBox = (r: number[]): Rect => {
      const [x0, y0] = vp.convertToViewportPoint(r[0]!, r[1]!);
      const [x1, y1] = vp.convertToViewportPoint(r[2]!, r[3]!);
      return {
        x: Math.min(x0!, x1!),
        y: Math.min(y0!, y1!),
        width: Math.abs(x1! - x0!),
        height: Math.abs(y1! - y0!),
      };
    };
    const raw = (await page.getAnnotations()) as Record<string, unknown>[];
    const annotations = raw.map((a) => {
      const q = a.quadPoints as ArrayLike<number> | undefined;
      const quads: Rect[] = [];
      if (q)
        for (let i = 0; i + 8 <= q.length; i += 8) {
          const xs = [q[i]!, q[i + 2]!, q[i + 4]!, q[i + 6]!];
          const ys = [q[i + 1]!, q[i + 3]!, q[i + 5]!, q[i + 7]!];
          quads.push(
            toBox([
              Math.min(...xs),
              Math.min(...ys),
              Math.max(...xs),
              Math.max(...ys),
            ]),
          );
        }
      const lc = a.lineCoordinates as number[] | undefined;
      const line = lc
        ? [0, 2].map((i) => {
            const [x, y] = vp.convertToViewportPoint(lc[i]!, lc[i + 1]!);
            return { x: x!, y: y! };
          })
        : [];
      const color = a.color as ArrayLike<number> | null;
      return {
        subtype: String(a.subtype),
        box: toBox(a.rect as number[]),
        color: color ? ([color[0]!, color[1]!, color[2]!] as const) : null,
        contents: (a.contentsObj as { str?: string } | undefined)?.str ?? "",
        quads,
        line,
        inkPoints: ((a.inkLists as ArrayLike<number>[] | undefined) ?? [])
          .map((l) => l.length / 2)
          .reduce((n, k) => n + k, 0),
        hasAppearance: a.hasAppearance === true,
      } as ReadAnnotation;
    });
    const content = await page.getTextContent();
    const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    return { annotations, text };
  } finally {
    await task.destroy();
  }
}

const near = (a: Rect, b: Rect, tol = TOL) => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(tol);
};

const NOTE_TEXT = "COMMENT-NOTE-TEXT";

/** One of each comment kind, plus a whiteout that must stay page content. */
function markups(): EditorObject[] {
  return [
    {
      id: "h",
      kind: "highlight",
      page: 0,
      x: 300,
      y: 250,
      width: 70,
      height: 14,
      color: "#facc15",
      opacity: 0.4,
    },
    {
      id: "i",
      kind: "ink",
      page: 0,
      points: [
        { x: 60, y: 400 },
        { x: 120, y: 430 },
        { x: 180, y: 410 },
      ],
      stroke: "#1d4ed8",
      strokeWidth: 4,
      opacity: 1,
    },
    {
      id: "n",
      kind: "note",
      page: 0,
      x: 60,
      y: 60,
      width: 160,
      text: NOTE_TEXT,
      fill: "#fef08a",
      ...DEFAULT_TEXT_STYLE,
      size: 11,
      color: "#111827",
    },
    {
      id: "r",
      kind: "shape",
      shape: "rect",
      page: 0,
      x: 100,
      y: 160,
      width: 80,
      height: 30,
      stroke: "#ff0000",
      strokeWidth: 2,
      fill: null,
      opacity: 1,
    },
    {
      id: "e",
      kind: "shape",
      shape: "ellipse",
      page: 0,
      x: 220,
      y: 160,
      width: 60,
      height: 40,
      stroke: null,
      strokeWidth: 1,
      fill: "#00ff00",
      opacity: 0.5,
    },
    {
      id: "l",
      kind: "line",
      page: 0,
      x1: 20,
      y1: 330,
      x2: 140,
      y2: 330,
      arrow: true,
      stroke: "#000000",
      strokeWidth: 2,
      opacity: 1,
    },
    {
      id: "w",
      kind: "whiteout",
      page: 0,
      x: 400,
      y: 400,
      width: 50,
      height: 20,
    },
  ];
}

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

describe.each([0, 90])(
  "markups saved as comments on a /Rotate %i page",
  (rotate) => {
    it("pdf.js lists each as its own annotation, where it was placed, in its colour", async () => {
      const out = await exportEditedPdf(
        await blankPage(rotate),
        markups(),
        undefined,
        { markups: "comments" },
      );
      expect(out.comments).toBe(6);
      const { annotations, text } = await readAnnotations(out.bytes);
      const bySubtype = (s: string) =>
        annotations.filter((a) => a.subtype === s);
      expect(annotations.map((a) => a.subtype).sort()).toEqual(
        ["Circle", "FreeText", "Highlight", "Ink", "Line", "Square"].sort(),
      );
      for (const a of annotations) expect(a.hasAppearance).toBe(true);

      const [h] = bySubtype("Highlight");
      near(h!.box, { x: 300, y: 250, width: 70, height: 14 });
      expect(h!.quads).toHaveLength(1);
      near(h!.quads[0]!, { x: 300, y: 250, width: 70, height: 14 });
      expect(h!.color).toEqual(hexRgb("#facc15"));

      const [n] = bySubtype("FreeText");
      expect(n!.contents).toBe(NOTE_TEXT);
      expect(n!.box.x).toBeCloseTo(60, 0);
      expect(n!.box.y).toBeCloseTo(60, 0);
      expect(Math.abs(n!.box.width - 160)).toBeLessThanOrEqual(TOL + 1);
      // The note is a comment, not page text.
      expect(text).not.toContain(NOTE_TEXT);

      const [sq] = bySubtype("Square");
      // The border is drawn inside the annotation's rectangle: the box
      // grown by half the stroke on every side.
      near(sq!.box, { x: 99, y: 159, width: 82, height: 32 });
      expect(sq!.color).toEqual(hexRgb("#ff0000"));
      const [ci] = bySubtype("Circle");
      near(ci!.box, { x: 220, y: 160, width: 60, height: 40 });

      const [ln] = bySubtype("Line");
      expect(ln!.line).toHaveLength(2);
      expect(Math.abs(ln!.line[0]!.x - 20)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(ln!.line[0]!.y - 330)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(ln!.line[1]!.x - 140)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(ln!.line[1]!.y - 330)).toBeLessThanOrEqual(TOL);

      const [ink] = bySubtype("Ink");
      expect(ink!.inkPoints).toBe(3);
      // The points' box, grown by half the stroke (the round caps) and a
      // point of margin.
      near(ink!.box, { x: 57, y: 397, width: 126, height: 36 });
      expect(ink!.color).toEqual(hexRgb("#1d4ed8"));
    });

    it("pdf.js paints them: the highlight's colour at its quad, the note's paper, the ink", async () => {
      const out = await exportEditedPdf(
        await blankPage(rotate),
        markups(),
        undefined,
        { markups: "comments" },
      );
      const [page] = await renderPdfPages(out.bytes, 612);
      // Viewer points → the normalised frame regionMean reads.
      const W = rotate === 90 ? 792 : 612;
      const H = rotate === 90 ? 612 : 792;
      const at = (x: number, y: number, w: number, h: number) =>
        regionMean(page!, x / W, y / H, (x + w) / W, (y + h) / H);
      // #facc15 at 0.4, multiplied over white: red and green stay high,
      // blue drops well below white.
      const [hr, hg, hb] = at(305, 253, 60, 8);
      expect(hr).toBeGreaterThan(230);
      expect(hg).toBeGreaterThan(200);
      expect(hb).toBeLessThan(200);
      // The note's paper (#fef08a) inside its box, right of its one line
      // of words (x 66 to about 176).
      const [nr, , nb] = at(196, 66, 16, 8);
      expect(nr).toBeGreaterThan(240);
      expect(nb).toBeLessThan(180);
      // The ink stroke's middle point: blue.
      const [ir, , ib] = at(118, 428, 4, 4);
      expect(ib).toBeGreaterThan(ir + 60);
      // Paper elsewhere stays white.
      const [wr, wg, wb] = at(500, 600, 20, 20);
      expect(Math.min(wr, wg, wb)).toBeGreaterThan(250);
    });
  },
);

describe("markups as comments: what stays page content, and what is written", () => {
  it("whiteout stays page content — a comment can be deleted, a cover must not be", async () => {
    const out = await exportEditedPdf(await blankPage(), markups(), undefined, {
      markups: "comments",
    });
    const { annotations } = await readAnnotations(out.bytes);
    // Six comments, and no seventh for the whiteout.
    expect(annotations).toHaveLength(6);
    expect(out.counts.whiteout).toBe(1);
  });

  it("flatten (the default) writes no annotation at all — unchanged", async () => {
    const out = await exportEditedPdf(await blankPage(), markups());
    expect(out.comments).toBe(0);
    const { annotations } = await readAnnotations(out.bytes);
    expect(annotations).toEqual([]);
  });

  it("each comment has a unique /NM, a /M date, an appearance stream, and no /T author", async () => {
    const out = await exportEditedPdf(await blankPage(), markups(), undefined, {
      markups: "comments",
    });
    const doc = await PDFDocument.load(out.bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const names = new Set<string>();
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i, PDFDict);
      names.add(String(a.get(PDFName.of("NM"))));
      expect(a.get(PDFName.of("M"))).toBeDefined();
      expect(a.get(PDFName.of("T"))).toBeUndefined();
      const ap = a.lookup(PDFName.of("AP"), PDFDict);
      expect(ap.lookup(PDFName.of("N"))).toBeInstanceOf(PDFStream);
      // Printed with the page (/F 4), as a viewer's own markups are.
      expect(String(a.get(PDFName.of("F")))).toBe("4");
    }
    expect(names.size).toBe(annots.size());
  });

  it("a highlight over a line of text snaps its quad to the line, inside the box drawn", async () => {
    // "SNAP THIS LINE" at y = 600 from the bottom, size 20: on the displayed
    // page its run spans about y 172..197 (top-left origin).
    const bytes = await blankPage(0, "SNAP THIS LINE");
    const box = { x: 90, y: 160, width: 120, height: 50 };
    const out = await exportEditedPdf(
      bytes,
      [
        {
          id: "h",
          kind: "highlight",
          page: 0,
          ...box,
          color: "#facc15",
          opacity: 0.4,
        },
      ],
      undefined,
      { markups: "comments" },
    );
    const { annotations } = await readAnnotations(out.bytes);
    const [h] = annotations;
    expect(h!.quads).toHaveLength(1);
    const q = h!.quads[0]!;
    // Horizontally: the run's start (x 100) to the box's right edge.
    expect(Math.abs(q.x - 100)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(q.x + q.width - 210)).toBeLessThanOrEqual(TOL);
    // Vertically: the line's height, not the 50 pt box.
    expect(q.height).toBeLessThan(30);
    expect(q.height).toBeGreaterThan(18);
    expect(q.y).toBeGreaterThan(165);
    expect(q.y + q.height).toBeLessThan(205);
  });
});

describe("snapHighlightQuads", () => {
  const run = (rect: Rect, angle = 0): TextRun => ({
    key: "k",
    page: 0,
    index: 0,
    str: "x",
    transform: [1, 0, 0, 1, 0, 0],
    width: rect.width,
    rect,
    baseX: rect.x,
    baseY: rect.y + rect.height,
    size: rect.height,
    angle,
  });

  it("keeps the drawn box when no run is under it (health check: [] is not a pass)", () => {
    const box = { x: 10, y: 10, width: 50, height: 20 };
    expect(snapHighlightQuads(box, [])).toEqual([box]);
    expect(
      snapHighlightQuads(box, [run({ x: 200, y: 200, width: 50, height: 10 })]),
    ).toEqual([box]);
  });

  it("one quad per line, clipped to the box, two runs on a line merged", () => {
    const box = { x: 0, y: 0, width: 100, height: 40 };
    const quads = snapHighlightQuads(box, [
      run({ x: 10, y: 2, width: 30, height: 12 }),
      run({ x: 45, y: 2, width: 80, height: 12 }),
      run({ x: 5, y: 22, width: 20, height: 12 }),
    ]);
    expect(quads).toEqual([
      { x: 10, y: 2, width: 90, height: 12 },
      { x: 5, y: 22, width: 20, height: 12 },
    ]);
  });

  it("ignores a run the box barely grazes, and a turned run", () => {
    const box = { x: 0, y: 0, width: 100, height: 20 };
    expect(
      snapHighlightQuads(box, [
        run({ x: 10, y: 17, width: 30, height: 12 }),
        run({ x: 10, y: 2, width: 30, height: 12 }, 90),
      ]),
    ).toEqual([box]);
  });
});
