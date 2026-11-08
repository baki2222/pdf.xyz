// Fixtures for the second review of the pdf.js preflight (lane l07): files
// whose cost is in the WORK pdf.js does, not the depth or size a byte scan
// sees once, and files that misled the scan by changing one token.
//
// Each is the reviewer's reproduction, rebuilt from its description:
//  - a Form XObject holding a balanced 16,000-deep q nest, painted N times
//    (30 paints read for 157 s on the first repair, which admitted it);
//  - the same nest repeated N times inline in one content stream (15: 52 s);
//  - Form XObjects that paint each other, each balanced 12,000 deep: pdf.js
//    carries the caller's state into a form, so k nested forms reach k x
//    12,000 (measured on base: 1 form 1.6 s, 2 5.5 s, 3 11.9 s), while each
//    stream on its own reaches 12,000;
//  - an image whose /DecodeParms says /BitsPerComponent 1 ahead of the real
//    /BitsPerComponent 8, and one whose /Width is an indirect reference;
//  - byte soups that made the scan's dictionary and endstream searches
//    quadratic.
import { deflateSync } from "node:zlib";
import { deflatedZeros, rawPdf } from "./conversion-out.fixtures";

const HELV = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
const TEXT = "BT /F1 9 Tf 10 10 Td (x) Tj ET\n";
const FORM_DICT =
  "/Type /XObject /Subtype /Form /BBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >>";

/** A balanced nest `depth` deep around one text op. */
export const qCycle = (depth: number): string =>
  "q\n".repeat(depth) + TEXT + "Q\n".repeat(depth);

/**
 * One page: 1 catalog, 2 pages, 3 page, 4 Helvetica, 5 content, 6.. extra.
 * `xobject` names object 6 in the page's resources (/Fm1 or /Im1), once:
 * the scan counts how often a stream is named.
 */
function onePage(
  content: string,
  extra: Parameters<typeof rawPdf>[0] = [],
  xobject = "/Fm1",
) {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> /XObject << ${xobject} 6 0 R >> >> /Contents 5 0 R >>`,
    HELV,
    { dict: "", stream: "BT /F1 9 Tf 10 100 Td (MARK) Tj ET\n" + content },
    ...extra,
  ]);
}

/** One Form XObject holding a `depth`-deep balanced nest, painted `paints` times. */
export function formRepeatPdf(paints: number, depth: number): Uint8Array {
  return onePage("/Fm1 Do\n".repeat(paints), [
    { dict: FORM_DICT, stream: qCycle(depth) },
  ]);
}

/** A `depth`-deep balanced nest, `times` times inline in one content stream. */
export function inlineCyclesPdf(times: number, depth: number): Uint8Array {
  return onePage(qCycle(depth).repeat(times));
}

/** `k` Form XObjects, form i painting form i+1, each balanced `depth` deep. */
export function nestedFormsPdf(k: number, depth: number): Uint8Array {
  const forms = Array.from({ length: k }, (_, i) => ({
    dict:
      "/Type /XObject /Subtype /Form /BBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >>" +
      (i < k - 1 ? ` /XObject << /Fm1 ${7 + i} 0 R >>` : "") +
      " >>",
    stream:
      "q\n".repeat(depth) +
      TEXT +
      (i < k - 1 ? "/Fm1 Do\n" : "") +
      "Q\n".repeat(depth),
  }));
  return onePage("/Fm1 Do\n", forms);
}

/**
 * One page whose /Contents lists one stream of `leak` unclosed q `reps`
 * times, between two text streams. pdf.js reads the stream each time it is
 * listed, so the page reaches reps x leak (measured on base: 24 x 1,000 read
 * in 4.6 s; the first repair counted the stream once).
 */
export function repeatedContentsPdf(reps: number, leak: number): Uint8Array {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents [6 0 R ${"5 0 R ".repeat(reps)}6 0 R] >>`,
    HELV,
    { dict: "", stream: "q\n".repeat(leak) },
    { dict: "", stream: "BT /F1 9 Tf 10 10 Td (MARK) Tj ET" },
  ]);
}

const PAINT = "q 100 0 0 100 50 50 cm /Im1 Do Q\n";

/**
 * A 12,000 x 12,000 8-bit DeviceGray image (144 MP) whose /DecodeParms holds
 * /BitsPerComponent 1 ahead of the real entry. pdf.js ignores that
 * DecodeParms entry (no /Predictor); the first repair read it as bilevel.
 */
export async function decodeParmsBpcPdf(side = 12_000): Promise<Uint8Array> {
  return onePage(
    PAINT,
    [
      {
        dict: `/Type /XObject /Subtype /Image /DecodeParms << /BitsPerComponent 1 >> /Width ${side} /Height ${side} /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode`,
        stream: await deflatedZeros(side * side),
      },
    ],
    "/Im1",
  );
}

/** A `side`-square RGB image whose /Width is `7 0 R` (object 7 holds it). */
export async function indirectWidthPdf(side = 10_000): Promise<Uint8Array> {
  return onePage(
    PAINT,
    [
      {
        dict: `/Type /XObject /Subtype /Image /Width 7 0 R /Height ${side} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode`,
        stream: await deflatedZeros(side * side * 3),
      },
      String(side),
    ],
    "/Im1",
  );
}

/** `>>stream` n times and no `<<`: every keyword's dictionary search fails. */
export const unmatchedDictSoup = (n: number): Uint8Array =>
  new Uint8Array(
    Buffer.from("%PDF-1.7\n" + ">>stream\n".repeat(n) + "%%EOF\n", "latin1"),
  );

/** `<</Length 0>>stream` n times and no `endstream` anywhere after them. */
export const noEndstreamSoup = (n: number): Uint8Array =>
  new Uint8Array(
    Buffer.from(
      "%PDF-1.7\n" + "<</Length 0>>stream\n".repeat(n) + "%%EOF\n",
      "latin1",
    ),
  );

// Third review: the scan trusted a stream's dictionary LABELS to decide what
// could be page content, and read the dictionary byte by byte. pdf.js reads a
// page's /Contents whatever its dictionary says, and parses strings.

/** Text, `n` unclosed q, text: STAMP-14's page, readable by its markers. */
export const unclosedQContent = (n: number): string =>
  "BT /F1 9 Tf 10 100 Td (MARK) Tj ET\n" +
  "q\n".repeat(n) +
  "BT /F1 9 Tf 10 50 Td (END) Tj ET\n";

/**
 * One page whose /Contents is object 5, a stream whose dictionary carries
 * `dict` (labels pdf.js ignores for page content). `extra` objects are 6...
 */
export function labelledContentPdf(
  dict: string,
  stream: string | Uint8Array,
  extra: Parameters<typeof rawPdf>[0] = [],
): Uint8Array {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    HELV,
    { dict, stream },
    ...extra,
  ]);
}

/** `total` zero bytes behind two Flate stages: ~2 KB on disk for 1 GiB. */
export async function chainedFlateStream(total = 2 ** 30): Promise<Uint8Array> {
  return new Uint8Array(deflateSync(await deflatedZeros(total), { level: 9 }));
}

/** A `side`-square RGB image whose /Subtype is `7 0 R` (object 7 is /Image). */
export async function indirectSubtypePdf(side = 10_000): Promise<Uint8Array> {
  return onePage(
    PAINT,
    [
      {
        dict: `/Type /XObject /Subtype 7 0 R /Width ${side} /Height ${side} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode`,
        stream: await deflatedZeros(side * side * 3),
      },
      "/Image",
    ],
    "/Im1",
  );
}
