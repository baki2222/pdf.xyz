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
import { startMemoryMeter } from "./memory";
import { reportResult } from "./report";
import {
  asciiHex,
  catalogObjStmBombPdf,
  countMinusOnePdf,
  oneContentPdf,
  splitQPdf as splitQOpenPdf,
  zeroWidthXrefPdf,
} from "./pdfjs-open.fixtures";
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

/**
 * The editor's page canvas (Edit, Annotate and Sign PDF): open, draw page 1
 * at 100% and 1 device px per CSS px, and read the pixels where the fixture's
 * image sits (`q 100 0 0 100 50 50 cm /Im1 Do Q`, clear of the text): an
 * image of zeros paints black (0), a skipped one leaves the white sheet (765).
 */
async function editorProbe(bytes: Uint8Array) {
  await withCanvas();
  const { openEditorPdf } = await import("@/lib/pdf/editor/page-render");
  const doc = await openEditorPdf(bytes);
  const t0 = Date.now();
  const canvas = (await doc.render(0, 1, 1)) as unknown as {
    width: number;
    height: number;
    getContext(kind: "2d"): {
      getImageData(
        x: number,
        y: number,
        w: number,
        h: number,
      ): {
        data: Uint8ClampedArray;
      };
    };
  } | null;
  const renderMs = Date.now() - t0;
  const ink = canvas
    ? [
        [140, 60],
        [60, 140],
      ].map(([x, y]) => {
        const d = canvas
          .getContext("2d")
          .getImageData(x!, canvas.height - y!, 1, 1).data;
        return d[0]! + d[1]! + d[2]!;
      })
    : null;
  const notice = (doc as { imageNotice?: string | null }).imageNotice ?? null;
  await doc.destroy();
  return {
    ok: true,
    drawn: canvas !== null,
    size: canvas ? [canvas.width, canvas.height] : null,
    renderMs,
    ink,
    notice,
  };
}

/**
 * The editor's canvas at its deepest zoom on an A0 page (2,384 x 3,370 pt):
 * the device pixels it allocates, against MAX_CANVAS_PIXELS.
 */
async function editorZoomProbe() {
  await withCanvas();
  const { openEditorPdf } = await import("@/lib/pdf/editor/page-render");
  const { MAX_ZOOM, scaleForZoom } = await import("@/lib/pdf/editor/geometry");
  const doc = await openEditorPdf(simplePdf({ mediaBox: "[0 0 2384 3370]" }));
  const out: { ratio: number; pixels: number | null }[] = [];
  for (const ratio of [1, 2, 3]) {
    const canvas = (await doc.render(0, scaleForZoom(MAX_ZOOM), ratio)) as {
      width: number;
      height: number;
    } | null;
    out.push({ ratio, pixels: canvas ? canvas.width * canvas.height : null });
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  await doc.destroy();
  return { ok: true, renders: out };
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
  "co08-editor-render": async () => editorProbe(await imageBombAtCapPdf()),
  "co08-control-editor-render": async () => editorProbe(await imagePdf(3_000)),
  "editor-zoom-a0": editorZoomProbe,
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

// Lane res1: every pdf.js open goes through the preflight. Each reader that
// opened pdf.js with no check, on each file that open could not survive.
//   open:<file>:<reader>
const OPEN_FILES: Record<string, () => Promise<Uint8Array> | Uint8Array> = {
  // 20 object streams x 100 MiB behind two Flate stages; the catalog in one.
  "objstm-bomb": () => catalogObjStmBombPdf(20, 100),
  "zero-width-xref": zeroWidthXrefPdf,
  "q-split": () => splitQOpenPdf(32, 1_020),
  "count-minus-one": countMinusOnePdf,
  control: CONTROL,
};

const OPEN_READERS: Record<string, (bytes: Uint8Array) => Promise<object>> = {
  /** The upload board of every reader:'pdfjs' tool. */
  "read-pages": async (bytes) => {
    const { readPagesWithPdfjs } = await import("@/lib/pdf/pdfjs");
    return { ok: true, pageCount: (await readPagesWithPdfjs(bytes)).pageCount };
  },
  /** Compare PDF's file cards. */
  "count-pages": async (bytes) => {
    const { countPagesWithPdfjs } = await import("@/lib/pdf/pdfjs-page-count");
    return { ok: true, pageCount: await countPagesWithPdfjs(bytes) };
  },
  /** Crop PDF's Auto-crop. */
  "auto-crop": async (bytes) => {
    await withCanvas();
    const { detectAutoCrop } = await import("@/lib/pdf/auto-crop-render");
    const plan = await detectAutoCrop(bytes);
    return {
      ok: true,
      analysed: plan.perPage.length,
      unread: plan.unread.length,
    };
  },
  /**
   * The access probe (`classifyPdfAccess`): it runs on file arrival, ahead of
   * every reader, on the batch runners, Compress, Protect/Unlock and Request
   * Signatures. It never throws; its verdict is the value.
   */
  access: async (bytes) => {
    const { classifyPdfAccess } = await import("@/lib/pdf/encryption");
    const pdfjs =
      (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as import("@/lib/pdf/encryption").PdfjsForAccess;
    const access = await classifyPdfAccess(bytes, pdfjs);
    return { ok: true, access: access.kind };
  },
  /** The editor's page canvas: open, then draw page 1. */
  "editor-render": async (bytes) => {
    await withCanvas();
    const { openEditorPdf } = await import("@/lib/pdf/editor/page-render");
    const doc = await openEditorPdf(bytes);
    const canvas = await doc.render(0, 1, 1);
    await doc.destroy();
    return { ok: true, numPages: doc.numPages, drawn: canvas !== null };
  },
};

/** Item 3: a one-page file whose content is AHx over Flate over `total` zeros. */
async function ahxContentPdf(total: number): Promise<Uint8Array> {
  return oneContentPdf(
    "/Filter [/ASCIIHexDecode /FlateDecode]",
    asciiHex(await deflatedZeros(total)),
  );
}
CASES["ahx-bomb-thumbs"] = async () => thumbs(await ahxContentPdf(2 ** 30));
CASES["ahx-bomb-raster"] = async () => raster(await ahxContentPdf(2 ** 30));
CASES["ahx-control-raster"] = async () =>
  raster(
    oneContentPdf(
      "/Filter [/ASCIIHexDecode /FlateDecode]",
      asciiHex(
        deflateSync(
          Buffer.from("BT /F1 14 Tf 20 100 Td (AHX MARK) Tj ET\n0 0 m q Q\n"),
        ),
      ),
    ),
  );

const [kind, file, reader] = (process.argv[2] ?? "").split(":");
if (kind === "open") {
  const make = OPEN_FILES[file ?? ""];
  const read = OPEN_READERS[reader ?? ""];
  if (!make || !read) throw new Error(`unknown case ${process.argv[2]}`);
  CASES[process.argv[2]!] = async () => {
    const bytes = await make();
    // Measured from here: the fixture's own build is not the reader's cost.
    const meter = startMemoryMeter();
    const t0 = Date.now();
    try {
      return await read(bytes);
    } finally {
      // Read on settle: reported beside the value or the error.
      growth = {
        mb: Math.round(meter.growthMb()),
        method: meter.method,
        ms: Date.now() - t0,
      };
    }
  };
}
let growth: { mb: number; method: string; ms: number } | null = null;

const run = CASES[process.argv[2] ?? ""];
if (!run) throw new Error(`unknown case ${process.argv[2]}`);
const peak = () => Math.round(process.resourceUsage().maxRSS / 1024);

/**
 * pdf.js, its in-thread worker and the native canvas load lazily, on the
 * first read and the first render. That is several hundred MB on Linux /
 * Node 22 and not the hostile file's cost (an absolute 900 MB cap went 933
 * on CI for PR #299). Both paths run once on a clean file first, so the
 * meter below reads only what THIS file costs (./memory.ts).
 */
async function warm(): Promise<void> {
  await text(CONTROL()).catch(() => {});
  await raster(CONTROL()).catch(() => {});
}

void (async () => {
  await warm();
  const meter = startMemoryMeter();
  // An `open:` case runs its own meter after its fixture is built, which
  // resets the same high-water mark (memory.ts), so this outer reading
  // would be short for it: it reports `growth` instead, never both.
  const measure = () => ({
    maxRssMb: peak(),
    ...(growth
      ? { growth }
      : { growthMb: Math.round(meter.growthMb()), meter: meter.method }),
  });
  try {
    const value = await run();
    reportResult({ ...(value as object), ...measure() });
  } catch (e) {
    const err = e as { name?: string; message?: string; kind?: string };
    reportResult({
      error: { name: err?.name, message: err?.message, kind: err?.kind },
      ...measure(),
    });
  }
})();
