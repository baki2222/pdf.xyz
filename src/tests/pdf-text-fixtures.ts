/**
 * Real PDFs for tests that need the BROWSER extractor to read them.
 *
 * The point is to stop describing a scan by hand. `{ pages: [{ text: "" }] }`
 * is the author's idea of what an image-only PDF extracts to; these are PDFs,
 * and what they extract to is whatever `extractPdfText` actually returns.
 *
 * `extractPdfText` imports the browser build of pdfjs, which cannot run in
 * Node (no `DOMMatrix`, and its worker URL resolves against the source tree).
 * A test that uses these substitutes the LEGACY build — same API, same text
 * layer code, shipped by the same package for exactly this environment:
 *
 * ```ts
 * vi.mock("pdfjs-dist", async () => ({
 *   ...(await import("pdfjs-dist/legacy/build/pdf.mjs")),
 *   // text.ts assigns a worker URL relative to itself; the legacy build's
 *   // in-process fake worker needs none, so the assignment goes nowhere.
 *   GlobalWorkerOptions: { workerSrc: "" },
 * }));
 * ```
 *
 * The image and the font go through the product's own boundaries
 * (`embedRasterImage`, `embedDrawingFont`) rather than pdf-lib directly: the
 * raster-embedder and text-drawing guards scan every non-test module, this one
 * included, and a fixture is no reason to open a second way in.
 */
import { PDFDocument } from "pdf-lib";
import { embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";

/** A 1×1 opaque PNG — enough for a page that is all image and no text. */
const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** What a scanner produces: every page one full-bleed image, no text operators. */
export async function imageOnlyPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await embedRasterImage(doc, PNG_1PX, "png");
  for (let i = 0; i < pageCount; i += 1) {
    doc
      .addPage([612, 792])
      .drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  }
  return doc.save();
}

const WORDS = [
  "the",
  "quarterly",
  "report",
  "shows",
  "revenue",
  "growth",
  "across",
  "every",
  "region",
  "and",
  "segment",
];

/** About `chars` characters of ordinary words, varied by `seed`. */
function prose(chars: number, seed: number): string {
  let body = "";
  let w = seed;
  while (body.length < chars) {
    body += (body.length > 0 ? " " : "") + WORDS[w % WORDS.length];
    w += 1;
  }
  return body;
}

/** Break `body` into lines of at most `width` characters, at spaces. */
function wrap(body: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of body.split(" ").filter(Boolean)) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length > 0 ? `${line} ${word}` : word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * One page per entry, each drawn with roughly `chars` characters of ordinary
 * words. ROUGHLY, on purpose: the extractor decides the real count, and a test
 * must read that count back rather than trust this number.
 */
export async function textPdf(
  charsPerPage: readonly number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const size = 3;
  const bodies = charsPerPage.map((chars, p) => prose(chars, p));
  const font = await embedDrawingFont(doc, bodies);
  for (const body of bodies) {
    const page = doc.addPage([612, 792]);
    wrap(body, 150).forEach((line, i) => {
      page.drawText(line, { x: 20, y: 770 - i * (size + 1), size, font });
    });
  }
  return doc.save();
}
