// @native-canvas
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPageLeaf,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readAsViewer } from "@/tests/pdfjs-viewer";
import { regionMean, renderPdfPages } from "@/tests/pdf-render";
import { addPageNumbers } from "./page-numbers";

/**
 * Audit page-numbers#2 (2026-11-06, re-measured 2026-11-22): the number was
 * drawn straight over the page, so on a full-bleed scan it sat on dark ink
 * and could not be read. The fix is an optional box behind each number, with
 * its own colour and opacity. Every check here reads the SAVED file: the
 * content stream as written, its ExtGState as resolved, the text where pdf.js
 * places it, and the pixels pdf.js paints.
 */

/** A page painted black edge to edge, like a dark full-bleed scan. */
async function darkScan(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 600,
    height: 800,
    color: rgb(0, 0, 0),
  });
  return doc.save();
}

/** The page's content streams, decoded and joined in drawing order. */
async function pageOps(
  bytes: Uint8Array,
): Promise<{ text: string; page: PDFPageLeaf }> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  const text = streams
    .map((s) =>
      new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode()),
    )
    .join("\n");
  return { text, page: page.node };
}

/** The segment that draws the number: from the last `q` before its BT. */
function numberSegment(ops: string): string {
  const bt = ops.lastIndexOf("BT");
  expect(bt, "no text object at all").toBeGreaterThan(-1);
  // The box is drawn in its own q…Q just before the text's q…BT.
  const before = ops.slice(0, bt);
  const textQ = before.lastIndexOf("q");
  const boxQ = before.lastIndexOf("q", textQ - 1);
  return ops.slice(Math.max(0, boxQ), ops.indexOf("ET", bt) + 2);
}

/**
 * The box's path (`x y m`, `x y l`…) after its first `1 0 0 1 tx ty cm`, in
 * page space. pdf-lib draws a rectangle as a closed m/l path, not `re`.
 */
function boxBounds(segment: string): [number, number, number, number] | null {
  const head = segment.slice(0, segment.indexOf("BT"));
  const cm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm/.exec(head);
  const points = [...head.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\b/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as const,
  );
  if (!cm || points.length < 4) return null;
  const tx = Number(cm[1]);
  const ty = Number(cm[2]);
  const xs = points.map(([x]) => tx + x);
  const ys = points.map(([, y]) => ty + y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe("page-numbers background box (audit page-numbers#2)", () => {
  it("draws a filled box BEFORE the number, at the chosen opacity, around the text", async () => {
    const out = await addPageNumbers(await darkScan(), {
      background: { color: { r: 1, g: 1, b: 1 }, opacity: 0.6 },
    });
    const { text: ops, page } = await pageOps(out);
    const segment = numberSegment(ops);

    // Order: the box's fill comes before the text object.
    const fill = segment.search(/\bh\s+f\b/);
    expect(fill, segment).toBeGreaterThan(-1);
    expect(fill).toBeLessThan(segment.indexOf("BT"));

    // Colour: white fill.
    expect(segment).toMatch(/1 1 1 rg/);

    // Opacity: the gs it names resolves to /ca 0.6 in the page's resources.
    const gs = /\/(\S+) gs/.exec(segment.slice(0, segment.indexOf("BT")));
    expect(gs, "the box sets no graphics state").not.toBeNull();
    const ext = page
      .Resources()!
      .lookup(PDFName.of("ExtGState"), PDFDict)
      .lookup(PDFName.of(gs![1]!), PDFDict);
    expect(ext.lookup(PDFName.of("ca"), PDFNumber).asNumber()).toBeCloseTo(0.6);

    // Bounds: the box contains the text where a VIEWER puts it.
    const box = boxBounds(segment);
    expect(box, segment).not.toBeNull();
    const [seen] = await readAsViewer(out);
    const run = seen!.runs.find((r) => r.str.includes("Page 1 of 1"));
    expect(run, JSON.stringify(seen!.runs)).toBeDefined();
    const baseline = seen!.height - run!.y; // back to page space (no rotation)
    const size = 11;
    expect(box![0]).toBeLessThan(run!.x);
    expect(box![2]).toBeGreaterThan(run!.endX);
    expect(box![1]).toBeLessThan(baseline - 0.2 * size);
    expect(box![3]).toBeGreaterThan(baseline + 0.7 * size);
  });

  it("paints the box: the number's area turns light on a black page (render)", async () => {
    const dark = await darkScan();
    const boxed = await addPageNumbers(dark, {
      background: { color: { r: 1, g: 1, b: 1 }, opacity: 1 },
    });
    const plain = await addPageNumbers(dark);
    const [b] = await renderPdfPages(boxed, 600);
    const [p] = await renderPdfPages(plain, 600);
    // Bottom-centre, 36 pt margin: the number sits around y = 800-36-11.
    const area = [0.42, 0.94, 0.58, 0.955] as const;
    const boxedMean = regionMean(b!, ...area);
    const plainMean = regionMean(p!, ...area);
    // Positive control: without the box the area stays dark.
    expect(Math.max(...plainMean)).toBeLessThan(90);
    expect(Math.min(...boxedMean)).toBeGreaterThan(150);
  });

  it("draws no box unless asked (the default stays as it was)", async () => {
    const out = await addPageNumbers(await darkScan());
    const { text: ops } = await pageOps(out);
    const tail = ops.slice(ops.lastIndexOf("Q", ops.lastIndexOf("BT")));
    expect(tail).not.toMatch(/\bh\s+f\b/);
  });

  it("turns the box with a /Rotate page so it still holds the number", async () => {
    const doc = await PDFDocument.load(await darkScan());
    doc.getPage(0).setRotation(degrees(90));
    const rotated = await doc.save();
    const out = await addPageNumbers(rotated, {
      background: { color: { r: 1, g: 1, b: 1 }, opacity: 1 },
    });
    const [r] = await renderPdfPages(out, 600);
    // Viewer frame is landscape now; the number is at the bottom-centre of
    // what the reader sees, and the box must light that area up.
    const mean = regionMean(r!, 0.44, 0.92, 0.56, 0.94);
    expect(Math.min(...mean)).toBeGreaterThan(150);
  });
});
