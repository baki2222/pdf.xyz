// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { organizePages, PdfEngineError } from "./engine";
import { loadPdfjs } from "./pdfjs";
import { makeStructuredPdf } from "@/tests/fixtures-structured-pdf";

/**
 * Organize Pages' "Insert blank page", judged on the saved file as a viewer
 * opens it: how many pages, which sits where, the blank's size, that it is
 * empty, and the page labels around it.
 */

/** Three pages of three sizes, each carrying one line of text naming it. */
async function sizedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const sizes: [number, number][] = [
    [200, 300],
    [400, 250],
    [300, 300],
  ];
  sizes.forEach(([w, h], i) => {
    const page = doc.addPage([w, h]);
    page.drawText(`SOURCE-${i + 1}`, { x: 20, y: 40, size: 14 });
    page.drawRectangle({
      x: 20,
      y: 80,
      width: 40,
      height: 40,
      color: rgb(0, 0, 0),
    });
  });
  return doc.save();
}

interface ViewerPage {
  width: number;
  height: number;
  rotation: number;
  text: string;
  /** Operators that paint anything: a blank page must have none. */
  paintOps: number;
}

async function readAsViewer(
  bytes: Uint8Array,
): Promise<{ pages: ViewerPage[]; labels: string[] | null }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const paint = new Set(
      Object.entries(pdfjs.OPS)
        .filter(([name]) =>
          /^(fill|stroke|eoFill|paint|showText|showSpacedText|nextLineShowText|shadingFill)/.test(
            name,
          ),
        )
        .map(([, code]) => code),
    );
    // Health check on the predicate: an empty set would call every page blank.
    expect(paint.size).toBeGreaterThan(8);
    const pages: ViewerPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const text = (await page.getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join("");
      const ops = await page.getOperatorList();
      pages.push({
        width: Math.round(view.width),
        height: Math.round(view.height),
        rotation: page.rotate,
        text,
        paintOps: ops.fnArray.filter((fn) => paint.has(fn)).length,
      });
    }
    return { pages, labels: await pdf.getPageLabels() };
  } finally {
    await task.destroy();
  }
}

describe("organizePages with blank pages", () => {
  it("puts an empty page of the given size at the planned position", async () => {
    const out = await organizePages(await sizedPdf(), [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: -1, rotation: 0, blank: { width: 200, height: 300 } },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 2, rotation: 0 },
    ]);
    const { pages } = await readAsViewer(out);
    expect(pages.map((p) => p.text)).toEqual([
      "SOURCE-1",
      "",
      "SOURCE-2",
      "SOURCE-3",
    ]);
    expect(pages[1]).toMatchObject({ width: 200, height: 300, paintOps: 0 });
    // Positive control for the emptiness check: the source pages paint.
    expect(pages[0]!.paintOps).toBeGreaterThan(0);
    expect(pages.map((p) => [p.width, p.height])).toEqual([
      [200, 300],
      [200, 300],
      [400, 250],
      [300, 300],
    ]);
  });

  it("several blanks, at the start and the end, and a turned one", async () => {
    const out = await organizePages(await sizedPdf(), [
      { sourceIndex: -1, rotation: 0, blank: { width: 200, height: 300 } },
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: -1, rotation: 90, blank: { width: 300, height: 300 } },
    ]);
    const { pages } = await readAsViewer(out);
    expect(pages.map((p) => p.text)).toEqual(["", "SOURCE-3", ""]);
    expect(pages.map((p) => p.rotation)).toEqual([0, 0, 90]);
    expect(pages[0]!.paintOps + pages[2]!.paintOps).toBe(0);
  });

  it("the pages around a blank keep their own labels; the blank has none", async () => {
    // Labels i, 1, 2 (a lower-roman range, then decimal from page 2).
    const input = await makeStructuredPdf(3);
    expect((await readAsViewer(input)).labels).toEqual(["i", "1", "2"]);
    const out = await organizePages(input, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: -1, rotation: 0, blank: { width: 300, height: 200 } },
      { sourceIndex: 2, rotation: 0 },
    ]);
    // Without its own range the blank would read "2" and push the last page
    // to "3", which is not the label it had.
    expect((await readAsViewer(out)).labels).toEqual(["i", "1", "", "2"]);
  });

  it("refuses a plan with no page of the document left", async () => {
    await expect(
      organizePages(await sizedPdf(), [
        { sourceIndex: -1, rotation: 0, blank: { width: 200, height: 300 } },
      ]),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });
});
