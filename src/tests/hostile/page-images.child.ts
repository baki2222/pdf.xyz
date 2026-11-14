// One render path on one per-page image budget case, in a child process with
// a hard kill (./bounded.ts): a page of ten 49 MP images drew for 106 s in
// the editor (PR #306), which no in-process timeout can interrupt.
//
//   node --import tsx page-images.child.ts <case>
//
// Reports { ok, ... } or { error: { name, message } }, with `growthMb`, the
// resident memory the case added after pdf.js and the canvas were warmed on
// a clean file (./memory.ts).
import { createRequire } from "node:module";
import { CONTROL, rawPdf } from "./conversion-out.fixtures";
import { startMemoryMeter } from "./memory";
import { reportResult } from "./report";
import {
  escapedNamesPdf,
  formsBesideHeavyPagePdf,
  imagePagesPdf,
  repeatedPaintPdf,
  withObjectStreams,
} from "./page-images.fixtures";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { deflatedZeros } from "./conversion-out.fixtures";

/** pdf.js's Node canvas behind `document.createElement`, as the render tests do. */
async function withCanvas(): Promise<void> {
  const requireHere = createRequire(import.meta.url);
  const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
    "@napi-rs/canvas",
  ) as { createCanvas(w: number, h: number): unknown };
  await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker: unknown = await import(
    // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  Object.assign(globalThis, {
    pdfjsWorker: worker,
    document: { createElement: () => napi.createCanvas(1, 1) },
  });
}

interface Pixels {
  width: number;
  height: number;
  getContext(kind: "2d"): {
    getImageData(
      x: number,
      y: number,
      w: number,
      h: number,
    ): { data: Uint8ClampedArray };
  };
}

/**
 * What a drawn sheet shows: "note" when it is the page-budget note (its
 * pale fill, 243 + 241 + 236 = 720, at a corner inside the border), "page"
 * when the page was drawn (white there, 765), and whether the page's image
 * cell is inked (an image of zeros draws black).
 */
function sheet(c: Pixels | null): { kind: string; inked: boolean } | null {
  if (!c) return null;
  const at = (x: number, y: number) => {
    const d = c.getContext("2d").getImageData(x, y, 1, 1).data;
    return d[0]! + d[1]! + d[2]!;
  };
  const corner = at(Math.round(c.width * 0.03), Math.round(c.height * 0.03));
  // The fixtures paint their images from x = y = 50 of a 600-point page.
  const cellSum = at(Math.round(c.width * 0.2), Math.round(c.height * 0.8));
  return {
    kind: corner === 720 ? "note" : corner === 765 ? "page" : `?${corner}`,
    inked: cellSum < 100,
  };
}

/** The editor's canvas: open, then draw every page (or `only`) at 100%. */
async function editor(bytes: Uint8Array, only?: number[]) {
  await withCanvas();
  const { openEditorPdf } = await import("@/lib/pdf/editor/page-render");
  const doc = await openEditorPdf(bytes);
  const pages: ({ kind: string; inked: boolean } | null)[] = [];
  const ms: number[] = [];
  for (const i of only ?? Array.from({ length: doc.numPages }, (_, k) => k)) {
    const t0 = Date.now();
    const c = (await doc.render(i, 1, 1)) as unknown as Pixels | null;
    ms.push(Date.now() - t0);
    pages.push(sheet(c));
  }
  await doc.destroy();
  return { ok: true, pages, pageMs: ms };
}

/** The PDF Viewer: open, then draw every page at 100%. */
async function viewer(bytes: Uint8Array) {
  await withCanvas();
  const { openViewerPdf } = await import("@/lib/pdf/viewer");
  const doc = await openViewerPdf(bytes);
  const pages: ({ kind: string; inked: boolean } | null)[] = [];
  for (let i = 0; i < doc.numPages; i += 1) {
    const r = await doc.render(i, 1, 1, 0);
    pages.push(
      r.kind === "drawn" ? sheet(r.canvas as unknown as Pixels) : null,
    );
  }
  await doc.destroy();
  return { ok: true, pages };
}

/** The upload board's thumbnails: each page's tile, and its note if any. */
async function thumbs(bytes: Uint8Array, only?: number[]) {
  await withCanvas();
  const { createThumbnailRenderer } = await import("@/lib/pdf/render");
  const r = await createThumbnailRenderer(bytes, { targetWidth: 120 });
  const tiles: { drawn: boolean; note: string | null }[] = [];
  for (const i of only ?? Array.from({ length: r.numPages }, (_, k) => k)) {
    const t = await r.renderPage(i);
    tiles.push({ drawn: t !== null, note: t?.note ?? null });
  }
  await r.destroy();
  return { ok: true, numPages: r.numPages, tiles };
}

/** PDF to JPG's page loop: what it writes, or its refusal. */
async function raster(bytes: Uint8Array, pages?: number[]) {
  await withCanvas();
  const { rasterizePdf } = await import("@/lib/pdf/render");
  const out = await rasterizePdf(bytes, { format: "jpg", dpi: 36, pages });
  return { ok: true, rendered: out.map((p) => p.index) };
}

/** Crop PDF's auto-detect: the plan. */
async function autoCrop(bytes: Uint8Array) {
  await withCanvas();
  const { detectAutoCrop } = await import("@/lib/pdf/auto-crop-render");
  const plan = await detectAutoCrop(bytes);
  return { ok: true, plan };
}

/** The preflight alone: how long, and what it says of the pages. */
async function preflight(bytes: Uint8Array) {
  const { preflightPdfjsBytes } = await import("@/lib/pdf/pdfjs-guard");
  const t0 = Date.now();
  const r = await preflightPdfjsBytes(bytes);
  const weights = r.pages ? [...r.pages.weights.values()] : null;
  return {
    ok: true,
    bytes: bytes.length,
    preflightMs: Date.now() - t0,
    mapped: weights?.length ?? null,
    heaviest: weights ? Math.max(...weights) : null,
    weights:
      weights && weights.length <= 8 ? weights.sort((a, b) => a - b) : null,
    incomplete: r.pages?.incomplete ?? null,
  };
}

const TEN_BY_49 = () => imagePagesPdf([Array<number>(10).fill(7000)]);
const MIXED = () => imagePagesPdf([[], Array<number>(10).fill(7000), [3000]]);
/**
 * 120 pages, one 1,000 x 1,000 image each (120 MP in all, past the 100 MP
 * page budget, so the map is built), shared resources, object streams.
 * (700 x 700, 59 MP in all, until the budget was 100 MP: D2, round 4.)
 */
const LONG_SCAN = async () =>
  withObjectStreams(
    await imagePagesPdf(
      Array.from({ length: 120 }, () => [1000]),
      { shared: true },
    ),
  );

/**
 * CO-08 through Auto-crop: a 10,000 x 10,000 RGB image (100 MP, past its
 * raster budget) filling [50, 550] x [50, 550] of a 600-point page, with
 * the page's label below it.
 */
const CO08_PAGE = () => imagePagesPdf([[10_000]]);

/** The same image painted inside a tiling pattern: its placement is not followed. */
async function co08PatternPdf(): Promise<Uint8Array> {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /Pattern << /P1 5 0 R >> /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    {
      dict: "",
      stream:
        "BT /F1 14 Tf 60 20 Td (PAGE 1) Tj ET /Pattern cs /P1 scn 50 50 500 500 re f",
    },
    {
      dict: "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 500 500] /XStep 500 /YStep 500 /Matrix [1 0 0 1 50 50] /Resources << /XObject << /Im 6 0 R >> >>",
      stream: "q 500 0 0 500 0 0 cm /Im Do Q",
    },
    {
      dict: "/Type /XObject /Subtype /Image /Width 10000 /Height 10000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
      stream: await deflatedZeros(10_000 * 10_000 * 3),
    },
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

const CASES: Record<string, () => Promise<unknown>> = {
  "editor-10x49": async () => editor(await TEN_BY_49()),
  "editor-1x49": async () => editor(await imagePagesPdf([[7000]])),
  "viewer-10x49": async () => viewer(await TEN_BY_49()),
  "raster-10x49": async () => raster(await TEN_BY_49()),
  "raster-1x49": async () => raster(await imagePagesPdf([[7000]])),
  "editor-mixed": async () => editor(await MIXED()),
  "thumbs-mixed": async () => thumbs(await MIXED()),
  "raster-mixed": async () => raster(await MIXED()),
  "raster-mixed-others": async () => raster(await MIXED(), [0, 2]),
  "autocrop-mixed": async () => autoCrop(await MIXED()),
  "thumbs-long-scan": async () => thumbs(await LONG_SCAN()),
  "raster-long-scan": async () => raster(await LONG_SCAN(), [0, 59, 119]),
  "preflight-long-scan": async () => preflight(await LONG_SCAN()),
  // A 36 MP image painted four times through forms (144 MP: every paint
  // counts), beside a 36 MP page. Page 1 is a note. (A 16 MP image, 64 MP,
  // until the page budget was 100 MP: D2, round 4.)
  "editor-forms-twice": async () =>
    editor(await formsBesideHeavyPagePdf(6000, 6000), [0]),
  "preflight-forms-twice": async () =>
    preflight(await formsBesideHeavyPagePdf(6000, 6000)),
  "autocrop-co08": async () => autoCrop(await CO08_PAGE()),
  "autocrop-co08-pattern": async () => autoCrop(await co08PatternPdf()),
  // Hostile review r1/r2 (2026-11-14), at the point of consumption.
  "editor-paint20": async () => editor(await repeatedPaintPdf(4000, 20)),
  "editor-paint3": async () => editor(await repeatedPaintPdf(4000, 3)),
  "editor-escaped": async () => editor(await escapedNamesPdf(6000)),
  "raster-restricted": async () => raster(await RESTRICTED()),
  "viewer-restricted": async () => viewer(await RESTRICTED()),
  // Owner ruling D1 (round 4): an encrypted file is never mapped. One 9 MP
  // image painted 12 times (108 MP, past the page budget): plain, refused
  // and noted; restricted (no open password), written and drawn, as main.
  "raster-paint12": async () => raster(await repeatedPaintPdf(3000, 12)),
  "viewer-paint12": async () => viewer(await repeatedPaintPdf(3000, 12)),
  "raster-paint12-restricted": async () =>
    raster(await restricted(await repeatedPaintPdf(3000, 12))),
  "viewer-paint12-restricted": async () =>
    viewer(await restricted(await repeatedPaintPdf(3000, 12))),
  // A 7,100 x 7,100 image (50.4 MP, just past its raster budget),
  // restricted: Auto-crop's pdf-lib load refuses an encrypted file before
  // any render, so no placement is ever asked of one.
  "autocrop-over-restricted": async () =>
    autoCrop(await restricted(await imagePagesPdf([[7100]]))),
};

/** `bytes` restricted: opens with no password, AES-256, object streams. */
function restricted(bytes: Uint8Array): Promise<Uint8Array> {
  return encryptPdf(bytes, {
    userPassword: "",
    ownerPassword: "o",
    objectStreams: true,
    cipher: "aes-256",
  });
}

/**
 * A restricted scan: opens with no password, AES-256, object streams (the
 * shape Acrobat and Word write), six pages of one 9 MP image. (Written when
 * the map decrypted such files and 54 MP in all built it; an encrypted file
 * is now never mapped, D1.)
 */
async function RESTRICTED(): Promise<Uint8Array> {
  return restricted(
    await imagePagesPdf(Array.from({ length: 6 }, () => [3000])),
  );
}

// `editor-grid:<n>:<side>`: one page of n distinct side x side images, the
// editor drawing it. The measurements behind RASTER_MAX_PAGE_IMAGE_PIXELS.
const grid = /^editor-grid:(\d+):(\d+)$/.exec(process.argv[2] ?? "");
if (grid) {
  CASES[process.argv[2]!] = async () =>
    editor(
      await imagePagesPdf([
        Array<number>(Number(grid[1])).fill(Number(grid[2])),
      ]),
    );
}

const run = CASES[process.argv[2] ?? ""];
if (!run) throw new Error(`unknown case ${process.argv[2]}`);

/** pdf.js, its worker and the native canvas, loaded on a clean file first (see ./memory.ts). */
async function warm(): Promise<void> {
  await withCanvas();
  const { rasterizePdf } = await import("@/lib/pdf/render");
  await rasterizePdf(CONTROL(), { format: "jpg", dpi: 72 }).catch(() => {});
  const { openEditorPdf } = await import("@/lib/pdf/editor/page-render");
  const doc = await openEditorPdf(CONTROL());
  await doc.render(0, 1, 1);
  await doc.destroy();
}

void (async () => {
  await warm();
  const meter = startMemoryMeter();
  const t0 = Date.now();
  const measure = () => ({
    growthMb: Math.round(meter.growthMb()),
    meter: meter.method,
    ms: Date.now() - t0,
  });
  try {
    const value = await run();
    reportResult({ ...(value as object), ...measure() });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    reportResult({
      error: { name: err?.name, message: err?.message },
      ...measure(),
    });
  }
})();
