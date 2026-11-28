/**
 * Every text run a pdf-lib page stores, read back out of its SAVED content
 * stream: the font resource, size, text-matrix origin and the hex string of
 * each `Tj`. Used by tests that bound a layout by the bytes the reader gets,
 * not by the layout the engine meant to draw.
 */
import { PDFArray, PDFName, type PDFDocument, PDFRawStream } from "pdf-lib";
import { inflateSync } from "node:zlib";

export interface DrawnRun {
  font: string;
  size: number;
  x: number;
  y: number;
  text: string;
}

export function drawnRuns(doc: PDFDocument, index: number): DrawnRun[] {
  const page = doc.getPage(index);
  const contents = page.node.Contents();
  if (!contents) return [];
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  const source = streams
    .map((s) => {
      const raw = s as PDFRawStream;
      const data = raw.dict.get(PDFName.of("Filter"))
        ? inflateSync(raw.contents)
        : raw.contents;
      return Buffer.from(data).toString("latin1");
    })
    .join("\n");
  const runs: DrawnRun[] = [];
  const pattern =
    /\/(\S+) ([\d.]+) Tf[\s\S]*?1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g;
  for (const m of source.matchAll(pattern)) {
    runs.push({
      font: m[1]!,
      size: Number(m[2]),
      x: Number(m[3]),
      y: Number(m[4]),
      text: Buffer.from(m[5]!, "hex").toString("latin1"),
    });
  }
  return runs;
}

/** Courier's advance width, from the PDF standard-14 metrics (AFM). */
export const COURIER_ADVANCE_EM = 600 / 1000;
