// @native-canvas
/**
 * Lane l05 of the hostile-input matrix: page GEOMETRY — the page boxes,
 * `/Rotate` and `/UserUnit` — read the way the viewer reads them.
 *
 * The rule every cell here checks is one relationship, not a number: the
 * engine's idea of "the page" must be the page pdf.js (the product's
 * renderer) shows. pdf.js 6 (`Page` in pdf.worker.mjs) reads a page as:
 *
 *  - `/Rotate`: a multiple of 90, normalised into [0, 360); anything else is
 *    IGNORED (0) — `get rotate()`.
 *  - boxes: normalised (corners sorted); a box with no positive width AND
 *    height is invalid — `getBoundingBox()`; an invalid MediaBox becomes US
 *    Letter [0 0 612 792], an invalid CropBox becomes the MediaBox, and a
 *    CropBox that misses the MediaBox becomes the MediaBox — `get view()`.
 *  - `/UserUnit`: a positive number scales the viewport — `PageViewport`
 *    does `scale *= userUnit`.
 *
 * So every assertion compares the engine against pdf.js reading the SAME
 * bytes (or the engine's output), and each has a control that is not
 * hostile. Finding ids are the matrix's.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import {
  PdfEngineError,
  normalizeAngle,
  organizePages,
  rotatePages,
  setPageRotations,
} from "@/lib/pdf/engine";
import { editPdf, getEditPageSizes } from "@/lib/pdf/edit";
import { getAnnotatePageSizes } from "@/lib/pdf/annotate";
import { DEFAULT_N_UP_OPTIONS, nUpPdf } from "@/lib/pdf/n-up";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import {
  getRedactPageSizes,
  redactPdf,
  wholePageRedactions,
} from "@/lib/pdf/redact";
import { rasterPageScale } from "@/lib/pdf/render-utils";
import { RASTER_MAX_DEVICE_PX } from "@/lib/pdf/pdf-to-image";
import type { RasterizeOptions, RasterPage } from "@/lib/pdf/render";
import { resizePdf } from "@/lib/pdf/resize";
import { watermarkPdf } from "@/lib/pdf/watermark";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import type { Rotation } from "@/lib/pdf/types";
import { PNG_1PX } from "@/tests/pdf-text-fixtures";
import { simplePdf } from "./conversion-out.fixtures";
import { PAGE_STRUCTURE_FIXTURES } from "./page-structure.fixtures";
import { STAMPING_INPUTS } from "./stamping.fixtures";

const T = 30_000;

/* ------------------------------------------------------------------ *
 *  Readers
 * ------------------------------------------------------------------ */

interface Seen {
  rotate: number;
  view: number[];
  userUnit: number;
  /** getViewport({ scale: 1 }) — what the raster and the preview size from. */
  viewport: { width: number; height: number };
  items: { str: string; x: number; y: number; a: number; b: number }[];
}

async function pdfjsRead(bytes: Uint8Array): Promise<Seen> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
    standardFontDataUrl: `${pathToFileURL(join(dir, "standard_fonts")).href}/`,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = (tc.items as { str?: string; transform?: number[] }[])
      .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
      .map((i) => ({
        str: i.str!,
        a: i.transform![0]!,
        b: i.transform![1]!,
        x: i.transform![4]!,
        y: i.transform![5]!,
      }));
    return {
      rotate: page.rotate,
      view: [...page.view],
      userUnit: page.userUnit,
      viewport: { width: vp.width, height: vp.height },
      items,
    };
  } finally {
    await task.destroy();
  }
}

/** Every content stream of a PDF, decoded as latin1. */
async function streamsOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        out.push(
          new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode()),
        );
      } catch {
        // an image or font stream that is not text — not an operand list
      }
    }
  }
  return out;
}

/** A non-finite operand is not a PDF number; no viewer is obliged to read it. */
const NON_FINITE = /Infinity|NaN/;

const stampingInput = async (id: string): Promise<Uint8Array> => {
  const f = STAMPING_INPUTS.find((x) => x.id === id);
  if (!f) throw new Error(`no stamping fixture ${id}`);
  return f.build();
};

const pageStructure = async (id: string): Promise<Uint8Array> => {
  const f = PAGE_STRUCTURE_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`no page-structure fixture ${id}`);
  return f.build();
};

/** A 612x792 page that says "Body", its `/Rotate` set raw (any number). */
async function rotatedLetter(rotate: number | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Body", { x: 72, y: 700, size: 12, font });
  if (rotate !== null) {
    page.node.set(PDFName.of("Rotate"), PDFNumber.of(rotate));
  }
  return doc.save({ useObjectStreams: false });
}

async function threePages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) doc.addPage([300, 400]);
  return doc.save();
}

async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getRotation().angle);
}

/* ------------------------------------------------------------------ *
 *  PS-15 — a non-finite rotation never reaches pdf-lib's degrees()
 * ------------------------------------------------------------------ */

describe("PS-15: non-finite rotations", () => {
  it("PS-15: normalizeAngle never returns a non-finite angle", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(Number.isFinite(normalizeAngle(bad))).toBe(true);
    }
    // control: the snapping a user's chosen angle still gets
    expect([45, 1e9, -90, 450].map(normalizeAngle)).toEqual([90, 270, 270, 90]);
  });

  it(
    "PS-15: rotate, set-rotations and organize refuse NaN with a typed error, and still apply finite plans",
    async () => {
      const bytes = await threePages();
      const cases: [string, () => Promise<Uint8Array>][] = [
        ["rotatePages NaN", () => rotatePages(bytes, [0], NaN)],
        ["rotatePages Infinity", () => rotatePages(bytes, [0], Infinity)],
        [
          "setPageRotations",
          () =>
            setPageRotations(bytes, [NaN, 45, 1e9] as unknown as Rotation[]),
        ],
        [
          "organizePages",
          () =>
            organizePages(bytes, [
              { sourceIndex: 2, rotation: NaN as unknown as Rotation },
              { sourceIndex: 0, rotation: 45 as unknown as Rotation },
            ]),
        ],
      ];
      for (const [name, run] of cases) {
        const err = await run().then(
          () => null,
          (e: unknown) => e,
        );
        expect(err, name).toBeInstanceOf(PdfEngineError);
      }
      // controls: the same calls with finite angles succeed
      expect(await rotationsOf(await rotatePages(bytes, [0], 90))).toEqual([
        90, 0, 0,
      ]);
      expect(
        await rotationsOf(
          await setPageRotations(bytes, [0, 45, 1e9] as unknown as Rotation[]),
        ),
      ).toEqual([0, 90, 270]);
    },
    T,
  );
});

/* ------------------------------------------------------------------ *
 *  STAMP-08 / EDIT-07 — /Rotate that is not a multiple of 90
 * ------------------------------------------------------------------ */

describe("STAMP-08 / EDIT-07: /Rotate not a multiple of 90 reads as 0", () => {
  const ODD = [45, 1e9, 1e20] as const;

  it(
    "STAMP-08: a page number lands where the /Rotate 0 control puts it",
    async () => {
      const ctrlSeen = await pdfjsRead(
        await addPageNumbers(await rotatedLetter(null), {
          position: "top-center",
        }),
      );
      const ctrl = ctrlSeen.items.find((i) => i.str !== "Body");
      expect(ctrl, "positive control drew a number").toBeTruthy();
      for (const r of ODD) {
        const seen = await pdfjsRead(
          await addPageNumbers(await rotatedLetter(r), {
            position: "top-center",
          }),
        );
        // health: pdf.js ignores the value, the page shows upright
        expect(seen.rotate, String(r)).toBe(0);
        expect(seen.items.some((i) => i.str === "Body")).toBe(true);
        const n = seen.items.find((i) => i.str !== "Body");
        expect(n, `rotate ${r} drew a number`).toBeTruthy();
        expect(Math.abs(n!.x - ctrl!.x), `x at ${r}`).toBeLessThan(1);
        expect(Math.abs(n!.y - ctrl!.y), `y at ${r}`).toBeLessThan(1);
        expect(n!.a, `upright at ${r}`).toBeCloseTo(ctrl!.a, 2);
        expect(n!.b, `upright at ${r}`).toBeCloseTo(ctrl!.b, 2);
      }
      // control the other way: a real /Rotate 90 still turns the stamp
      const turned = await pdfjsRead(
        await addPageNumbers(await rotatedLetter(90), {
          position: "top-center",
        }),
      );
      expect(turned.rotate).toBe(90);
    },
    T,
  );

  it(
    "STAMP-08: an image watermark's matrix on /Rotate 45 is the /Rotate 0 one",
    async () => {
      const cmOf = async (bytes: Uint8Array) => {
        const out = await watermarkPdf(bytes, "", {
          image: { bytes: PNG_1PX },
        });
        const cms = (await streamsOf(out.bytes))
          .flatMap((s) => s.match(/[-\d. ]+ cm/g) ?? [])
          .filter((m) => !/^\s*1 0 0 1 /.test(m));
        return cms;
      };
      const ctrl = await cmOf(await rotatedLetter(null));
      expect(ctrl.length, "control drew a scaled image").toBeGreaterThan(0);
      expect(await cmOf(await rotatedLetter(45))).toEqual(ctrl);
    },
    T,
  );

  it(
    "EDIT-07: Edit and Annotate measure the page pdf.js shows, and a placed mark lands where it was put",
    async () => {
      for (const id of ["H22-rotate-45", "H22-rotate-1e9"]) {
        const bytes = await stampingInput(id);
        const seen = await pdfjsRead(bytes);
        expect(seen.rotate, id).toBe(0);
        const want = [seen.viewport];
        expect(await getEditPageSizes(bytes), id).toEqual(want);
        expect(await getAnnotatePageSizes(bytes), id).toEqual(want);

        // through the consumer: text placed near the visible top-left
        const { width, height } = seen.viewport;
        const out = await editPdf(bytes, [
          {
            type: "text",
            page: 1,
            x: 20,
            y: height - 30,
            text: "MARK",
            color: "#000000",
            size: 12,
          },
        ]);
        const mark = (await pdfjsRead(out.bytes)).items.find(
          (i) => i.str === "MARK",
        );
        expect(mark, id).toBeTruthy();
        expect(Math.abs(mark!.x - 20), `${id} x`).toBeLessThan(1);
        expect(Math.abs(mark!.y - (height - 30)), `${id} y`).toBeLessThan(1);
        expect(mark!.b, `${id} upright`).toBeCloseTo(0, 3);
        expect(width).toBeGreaterThan(0);
      }
      // control: a real /Rotate 90 still swaps width and height
      const quarter = await rotatedLetter(90);
      expect(await getEditPageSizes(quarter)).toEqual([
        { width: 792, height: 612 },
      ]);
      expect((await pdfjsRead(quarter)).viewport).toEqual({
        width: 792,
        height: 612,
      });
    },
    T,
  );
});

/* ------------------------------------------------------------------ *
 *  EDIT-06 / CO-05 / PS-10 / STAMP-10 — zero-area and inverted boxes
 * ------------------------------------------------------------------ */

describe("EDIT-06: zero-area boxes measure as the viewer's fallback page", () => {
  it(
    "EDIT-06: sizes equal pdf.js's view and an edit inside it is accepted",
    async () => {
      for (const id of [
        "H10-mediabox-zero",
        "H18-mediabox-neg-zero",
        "H10-mediabox-inverted",
      ]) {
        const bytes = await stampingInput(id);
        const seen = await pdfjsRead(bytes);
        const want = [seen.viewport];
        // health: pdf.js shows a real page with the content on it
        expect(seen.viewport.width * seen.viewport.height, id).toBeGreaterThan(
          0,
        );
        expect(await getEditPageSizes(bytes), id).toEqual(want);
        expect(await getAnnotatePageSizes(bytes), id).toEqual(want);
        const out = await editPdf(bytes, [
          {
            type: "rect",
            page: 1,
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            color: "#000000",
          },
        ]);
        expect(out.bytes.byteLength, id).toBeGreaterThan(0);
      }
    },
    T,
  );
});

/**
 * A rasterizer with pdf.js's REAL geometry, as `rasterizePdf` computes it
 * (render.ts: `getViewport({scale:1})` → `rasterPageScale` → `pageWidth:
 * base.width`), handing the real `onCanvas` paint a canvas that records its
 * fills. Only the pixel render is skipped.
 */
async function paintWithPdfjsGeometry(
  bytes: Uint8Array,
  rects: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[],
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fills: { x: number; y: number; w: number; h: number }[] = [];
  let canvas = { width: 0, height: 0 };
  const rasterize = async (
    pdf: Uint8Array,
    opts: RasterizeOptions,
  ): Promise<RasterPage[]> => {
    const task = pdfjs.getDocument({ data: pdf.slice(), verbosity: 0 });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const fit = rasterPageScale(
      base.width,
      base.height,
      opts.dpi ?? 150,
      RASTER_MAX_DEVICE_PX,
    );
    const vp = page.getViewport({ scale: fit.scale });
    const width = Math.max(1, Math.floor(vp.width));
    const height = Math.max(1, Math.floor(vp.height));
    canvas = { width, height };
    const ctx = {
      fillStyle: "#000000",
      fillRect: (x: number, y: number, w: number, h: number) =>
        fills.push({ x, y, w, h }),
    };
    opts.onCanvas?.({ width, height, getContext: () => ctx } as never, {
      index: 0,
      width,
      height,
      pageWidth: base.width,
      pageHeight: base.height,
    });
    await task.destroy();
    return [];
  };
  const err = await redactPdf(bytes, { rects, dpi: 72 }, rasterize).then(
    () => null,
    (e: unknown) => e as Error,
  );
  // The stub returns no pages, so a run that got as far as painting ends on
  // this refusal; any other error is the one under test.
  if (err && !/No pages could be rendered/.test(err.message)) throw err;
  return { fills, canvas };
}

describe("CO-05: Redact reads inverted and zero boxes as pdf.js does", () => {
  it(
    "CO-05: sizes equal pdf.js's view, and a box inside the page is painted",
    async () => {
      for (const mediaBox of ["[300 200 0 0]", "[0 0 0 0]", "[0 0 -0 300]"]) {
        const bytes = simplePdf({ mediaBox });
        const seen = await pdfjsRead(bytes);
        expect(await getRedactPageSizes(bytes), mediaBox).toEqual([
          seen.viewport,
        ]);
        const { fills } = await paintWithPdfjsGeometry(bytes, [
          { page: 1, x: 0, y: 0, width: 1, height: 1 },
        ]);
        expect(fills.length, mediaBox).toBe(1);
      }
      // control: a normal page is unchanged
      const ctrl = simplePdf();
      expect(await getRedactPageSizes(ctrl)).toEqual([
        { width: 300, height: 200 },
      ]);
    },
    T,
  );
});

describe("CO-04: Redact boxes and the raster agree under /UserUnit", () => {
  for (const [name, mediaBox, uu] of [
    ["UserUnit 2 on a 1000 pt page", "[0 0 1000 1000]", 2],
    ["UserUnit 1000 on a 14400 pt page", "[0 0 14400 14400]", 1000],
    ["control: no UserUnit", "[0 0 14400 14400]", null],
  ] as const) {
    it(
      `CO-04: a whole-page redaction covers the whole raster — ${name}`,
      async () => {
        const bytes = simplePdf({
          mediaBox,
          pageExtra: uu === null ? "" : `/UserUnit ${uu}`,
        });
        const seen = await pdfjsRead(bytes);
        expect(seen.userUnit).toBe(uu ?? 1);
        const sizes = await getRedactPageSizes(bytes);
        // the box space IS pdf.js's scale-1 viewport
        expect(sizes).toEqual([seen.viewport]);
        const { fills, canvas } = await paintWithPdfjsGeometry(
          bytes,
          wholePageRedactions("1", sizes),
        );
        expect(fills).toEqual([
          { x: 0, y: 0, w: canvas.width, h: canvas.height },
        ]);
      },
      T,
    );
  }
});

describe("PS-10: N-up never divides by a zero-size page", () => {
  for (const borders of [false, true]) {
    it(
      `PS-10: a [0 0 0 0] page lays out as pdf.js shows it (borders ${borders})`,
      async () => {
        const bytes = await pageStructure("H10.zero");
        const src = await pdfjsRead(bytes);
        const r = await nUpPdf(bytes, {
          ...DEFAULT_N_UP_OPTIONS,
          perSheet: 4,
          borders,
        });
        const bad = (await streamsOf(r.bytes)).filter((s) =>
          NON_FINITE.test(s),
        );
        expect(bad).toEqual([]);
        // the content pdf.js shows on the source page reaches the sheet
        const sheet = await pdfjsRead(r.bytes);
        for (const item of src.items) {
          expect(sheet.items.map((i) => i.str)).toContain(item.str);
        }
      },
      T,
    );
  }
});

describe("STAMP-10: stamps on a [0 0 0 0] page land where they do on Letter", () => {
  it(
    "STAMP-10: page numbers sit where the 612x792 control puts them, and the image watermark draws",
    async () => {
      const zero = await stampingInput("H10-mediabox-zero");
      // the same page builder with a real 612x792 MediaBox
      const ctrlBytes = await stampingInput("CONTROL-valid");
      const seenZero = await pdfjsRead(zero);
      expect(seenZero.view).toEqual([0, 0, 612, 792]);

      const numberOf = async (b: Uint8Array) =>
        (await pdfjsRead(await addPageNumbers(b))).items.find((i) =>
          /of 1/.test(i.str),
        );
      const n = await numberOf(zero);
      const c = await numberOf(ctrlBytes);
      expect(c, "control drew a number").toBeTruthy();
      expect(n, "zero-box page drew a number").toBeTruthy();
      expect(n!.x).toBeGreaterThanOrEqual(0);
      expect(Math.abs(n!.x - c!.x)).toBeLessThan(1);
      expect(Math.abs(n!.y - c!.y)).toBeLessThan(1);

      const img = await watermarkPdf(zero, "", { image: { bytes: PNG_1PX } });
      expect(img.placements).toBe(1);
      const bad = (await streamsOf(img.bytes)).filter((s) =>
        NON_FINITE.test(s),
      );
      expect(bad).toEqual([]);
    },
    T,
  );
});

/* ------------------------------------------------------------------ *
 *  EDIT-10 — a canvas box no double can hold
 * ------------------------------------------------------------------ */

describe("EDIT-10: Resize canvas mode on a 20-digit page box", () => {
  it(
    "EDIT-10: refuses with a typed error instead of writing a 0-wide page; Fit still works",
    async () => {
      const bytes = await stampingInput("H18-mediabox-20-digits");
      const target = {
        width: 612,
        height: 792,
        orientation: "portrait" as const,
      };
      const err = await resizePdf(bytes, { ...target, mode: "canvas" }).then(
        async (r) => {
          // Not refused: then it must be the requested page.
          const seen = await pdfjsRead(r.bytes);
          return seen.viewport.width === 612 ? null : seen.viewport;
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(PdfEngineError);
      expect((err as Error).message).toMatch(/Scale content to fit/);
      // control: Fit mode on the same file makes the requested page
      const fit = await resizePdf(bytes, { ...target, mode: "fit" });
      expect((await pdfjsRead(fit.bytes)).viewport).toEqual({
        width: 612,
        height: 792,
      });
      // control: canvas mode on a normal page still works
      const normal = await resizePdf(await rotatedLetter(null), {
        width: 300,
        height: 300,
        orientation: "portrait",
        mode: "canvas",
      });
      expect((await pdfjsRead(normal.bytes)).viewport).toEqual({
        width: 300,
        height: 300,
      });
    },
    T,
  );
});

describe("EDIT-10: the canvas refusal's threshold, from both sides", () => {
  it(
    "EDIT-10: a 6e13-wide page box still resizes (headroom), a 1e17-wide one is refused",
    async () => {
      const canvasOf = (mediaBox: string) =>
        resizePdf(simplePdf({ mediaBox }), {
          width: 612,
          height: 792,
          orientation: "portrait",
          mode: "canvas",
        });
      // 6e13 puts the corner at 3e13: below the ~7e13 where a double's step
      // passes the 0.01 pt tolerance. The page is the size asked for.
      const ok = await canvasOf("[0 0 60000000000000 792]");
      const page = (await PDFDocument.load(ok.bytes)).getPage(0);
      expect(Math.abs(page.getMediaBox().width - 612)).toBeLessThanOrEqual(
        0.01,
      );
      // A real fractional box whose corner arithmetic is off by 5.7e-14 pt —
      // the reason the tolerance is not 0 (strict equality refused it).
      const fractional = await resizePdf(
        simplePdf({ mediaBox: "[65.843 0 751.408 792]" }),
        {
          width: 479.33,
          height: 792,
          orientation: "portrait",
          mode: "canvas",
        },
      );
      expect(fractional.resizedPages).toBe(1);
      // 1e17: the corner's step is 8 pt, so 612 cannot be held exactly.
      await expect(
        canvasOf("[0 0 100000000000000000 792]"),
      ).rejects.toBeInstanceOf(PdfEngineError);
    },
    T,
  );
});
