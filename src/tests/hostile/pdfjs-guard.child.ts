// One pdf.js consumer on one hostile (or control) file, in a child process
// with a hard kill (see ./bounded.ts): a page whose text read takes eight
// minutes, or a stream that inflates to a gigabyte, must fail ONE test.
//
//   node --import tsx pdfjs-guard.child.ts <case>
//
// Reports { ok, ... } or { error: { name, message, kind } }, plus the peak
// resident set (maxRssMb) so a memory bound can be asserted.
import { createRequire } from "node:module";
import {
  CONTROL,
  chainedFlateBombPdf,
  deflatedZeros,
  imageBombAtCapPdf,
  rawPdf,
  simplePdf,
} from "./conversion-out.fixtures";
import { buildPdf, onePageObjects, TEXT_OPS } from "./stamping.fixtures";
import { reportResult } from "./report";
import { deflateSync } from "node:zlib";
import {
  chainedFlateStream,
  formRepeatPdf,
  indirectSubtypePdf,
  indirectWidthPdf,
  labelledContentPdf,
  unclosedQContent,
  noEndstreamSoup,
  unmatchedDictSoup,
} from "./pdfjs-work.fixtures";

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

/** STAMP-14's fixture (H24-unclosed-q-scale), at a chosen depth. */
const unclosedQ = (depth: number) =>
  buildPdf({
    objects: onePageObjects(
      "",
      undefined,
      `${TEXT_OPS}\nq 0.1 0 0 0.1 0 0 cm\n${"q\n".repeat(depth)}`,
    ),
  });

/** One page holding one `side` x `side` RGB Flate image of zeros. */
async function imagePdf(side: number): Promise<Uint8Array> {
  return simplePdf({
    content: {
      dict: "",
      stream:
        "BT /F1 14 Tf 20 100 Td (X) Tj ET q 100 0 0 100 50 50 cm /Im1 Do Q",
    },
    resources: "/XObject << /Im1 6 0 R >>",
    extra: [
      {
        dict: `/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode`,
        stream: await deflatedZeros(side * side * 3),
      },
    ],
  });
}

/**
 * One page holding one 1-bit DeviceGray Flate image, W x H: a bilevel scan
 * (600-dpi A3 is 7,016 x 9,921 = 69.6 MP). pdf.js paints 1-bpc gray through
 * its packed GRAYSCALE_1BPP path: measured on base, 69.6 MP in 0.38-0.45 s.
 */
async function bilevelPdf(w: number, h: number): Promise<Uint8Array> {
  return simplePdf({
    content: {
      dict: "",
      stream:
        "BT /F1 14 Tf 20 100 Td (X) Tj ET q 100 0 0 100 50 50 cm /Im1 Do Q",
    },
    resources: "/XObject << /Im1 6 0 R >>",
    extra: [
      {
        dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /BitsPerComponent 1 /ColorSpace /DeviceGray /Filter /FlateDecode`,
        stream: await deflatedZeros(Math.ceil(w / 8) * h),
      },
    ],
  });
}

/**
 * Two pages: page 1 plain text, page 2 one 10,000 x 10,000 RGB image (CO-08's
 * image, 100 MP). The refusal must land on page 2, not on the file.
 */
async function twoPagesOneHugeImagePdf(): Promise<Uint8Array> {
  const helv = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>",
    helv,
    { dict: "", stream: "BT /F1 14 Tf 20 100 Td (PAGE ONE) Tj ET" },
    { dict: "", stream: "q 100 0 0 100 50 50 cm /Im1 Do Q" },
    {
      dict: "/Type /XObject /Subtype /Image /Width 10000 /Height 10000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
      stream: await deflatedZeros(10000 * 10000 * 3),
    },
  ]);
}

/**
 * The reviewer's split shape: ONE page whose /Contents is `n` streams of `k`
 * unclosed q, text before and after. 32 x 1,020 (32,640 deep) read for 66 s
 * on the first fix, which admitted it.
 */
function splitQPdf(n: number, k: number): Uint8Array {
  const streams = Array.from({ length: n }, (_, i) => ({
    dict: "",
    stream:
      (i === 0 ? "BT /F1 14 Tf 20 100 Td (MARK) Tj ET\n" : "") +
      "q\n".repeat(k) +
      (i === n - 1 ? "BT /F1 14 Tf 20 50 Td (END) Tj ET\n" : ""),
  }));
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents [${streams.map((_, i) => `${i + 5} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...streams,
  ]);
}

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

async function text(bytes: Uint8Array) {
  const { extractPdfText } = await import("@/lib/pdf/text");
  const r = await extractPdfText(bytes, legacy);
  return { ok: true, pageCount: r.pageCount, text: r.text.slice(0, 40) };
}

async function raster(bytes: Uint8Array) {
  await withCanvas();
  const { rasterizePdf } = await import("@/lib/pdf/render");
  const pages = await rasterizePdf(bytes, { format: "jpg", dpi: 72 });
  return { ok: true, pages: pages.length };
}

/** Every page through PDF to JPG's page loop, failures reported per page. */
async function rasterPerPage(bytes: Uint8Array) {
  await withCanvas();
  const { rasterizePdf } = await import("@/lib/pdf/render");
  const failed: { index: number; message: string }[] = [];
  const pages = await rasterizePdf(bytes, {
    format: "jpg",
    dpi: 72,
    onPageFailed: (f) => failed.push(f),
  });
  return { ok: true, rendered: pages.map((p) => p.index), failed };
}

/** Thumbnails: each page's preview, or null for a placeholder. */
async function thumbs(bytes: Uint8Array) {
  await withCanvas();
  const { createThumbnailRenderer } = await import("@/lib/pdf/render");
  const r = await createThumbnailRenderer(bytes, { targetWidth: 120 });
  const out: boolean[] = [];
  for (let i = 0; i < r.numPages; i += 1) {
    out.push((await r.renderPage(i)) !== null);
  }
  await r.destroy();
  return { ok: true, previews: out };
}

/** The preflight alone, as every pdf.js consumer calls it before the open. */
async function preflight(bytes: Uint8Array) {
  const { preflightPdfjsBytes } = await import("@/lib/pdf/pdfjs-guard");
  const t0 = Date.now();
  const r = await preflightPdfjsBytes(bytes);
  return { ok: true, bytes: bytes.length, preflightMs: Date.now() - t0, ...r };
}

const CASES: Record<string, () => Promise<unknown>> = {
  "co06-text": async () => text(await chainedFlateBombPdf()),
  "co06-control-text": async () => text(CONTROL()),
  "stamp14-text": async () => text(unclosedQ(100_000)),
  // The fixture's own `q ... cm` is one more: MAX_GRAPHICS_STATE_DEPTH exactly.
  "stamp14-at-bound-text": async () => text(unclosedQ(16_383)),
  "co08-raster": async () => raster(await imageBombAtCapPdf()),
  "co08-control-raster": async () => raster(await imagePdf(3_000)),
  "co08-bilevel-a3-raster": async () => raster(await bilevelPdf(7_016, 9_921)),
  "co08-per-page-raster": async () =>
    rasterPerPage(await twoPagesOneHugeImagePdf()),
  "co08-per-page-thumbs": async () => thumbs(await twoPagesOneHugeImagePdf()),
  "stamp14-split-text": async () => text(splitQPdf(32, 1_020)),
  "stamp14-5k-text": async () => text(splitQPdf(1, 5_000)),
  "stamp14-form-repeat-text": async () => text(formRepeatPdf(30, 16_000)),
  "stamp14-form-once-text": async () => text(formRepeatPdf(1, 16_000)),
  "co08-indirect-width-raster": async () => raster(await indirectWidthPdf()),
  "label-image-q-text": async () =>
    text(
      labelledContentPdf(
        "/Subtype /Image /Width 1 /Height 1",
        unclosedQContent(100_000),
      ),
    ),
  "label-image-control-text": async () =>
    text(
      labelledContentPdf(
        "/Subtype /Image /Width 1 /Height 1",
        unclosedQContent(10),
      ),
    ),
  "label-length1-q-text": async () =>
    text(labelledContentPdf("/Length1 0", unclosedQContent(100_000))),
  "label-image-bomb-text": async () =>
    text(
      labelledContentPdf(
        "/Subtype /Image /Width 1 /Height 1 /Filter [/FlateDecode /FlateDecode]",
        await chainedFlateStream(),
      ),
    ),
  "dict-string-flate-q-text": async () =>
    text(
      labelledContentPdf(
        "/X (>>stream) /Filter /FlateDecode",
        new Uint8Array(deflateSync(Buffer.from(unclosedQContent(100_000)))),
      ),
    ),
  "dict-string-control-text": async () =>
    text(
      labelledContentPdf(
        "/X (>>stream) /Filter /FlateDecode",
        new Uint8Array(deflateSync(Buffer.from(unclosedQContent(10)))),
      ),
    ),
  "co08-indirect-subtype-raster": async () =>
    raster(await indirectSubtypePdf()),
  "scan-unmatched-dict-preflight": async () =>
    preflight(unmatchedDictSoup(500_000)),
  "scan-no-endstream-preflight": async () =>
    preflight(noEndstreamSoup(200_000)),
};

const run = CASES[process.argv[2] ?? ""];
if (!run) throw new Error(`unknown case ${process.argv[2]}`);
const peak = () => Math.round(process.resourceUsage().maxRSS / 1024);
run().then(
  (value) => reportResult({ ...(value as object), maxRssMb: peak() }),
  (err: { name?: string; message?: string; kind?: string }) =>
    reportResult({
      error: { name: err?.name, message: err?.message, kind: err?.kind },
      maxRssMb: peak(),
    }),
);
