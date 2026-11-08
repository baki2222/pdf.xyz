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
  simplePdf,
} from "./conversion-out.fixtures";
import { buildPdf, onePageObjects, TEXT_OPS } from "./stamping.fixtures";
import { reportResult } from "./bounded";

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

const CASES: Record<string, () => Promise<unknown>> = {
  "co06-text": async () => text(await chainedFlateBombPdf()),
  "co06-control-text": async () => text(CONTROL()),
  "stamp14-text": async () => text(unclosedQ(100_000)),
  "stamp14-at-bound-text": async () => text(unclosedQ(4_095)),
  "co08-raster": async () => raster(await imageBombAtCapPdf()),
  "co08-control-raster": async () => raster(await imagePdf(3_000)),
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
