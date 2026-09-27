import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import {
  deletePages,
  extractPages,
  getPageCount,
  getPageRotations,
  mergePdfs,
  normalizeAngle,
  organizePages,
  PdfEngineError,
  rotatePages,
  splitPdf,
} from "./engine";
import { buildSplitParts, rangesPerPage } from "./ranges";

/**
 * Build a PDF where each page has a unique width — (index + 1) * 10 — so tests
 * can assert page identity and order after any operation by reading widths back.
 */
async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([(i + 1) * 10, 100]);
  }
  return doc.save();
}

/** Read each page's width back as an identity tag. */
async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getSize().width));
}

describe("normalizeAngle", () => {
  it("snaps to the nearest valid PDF rotation and wraps", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(90)).toBe(90);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(-450)).toBe(270);
  });
});

describe("getPageCount / getPageRotations", () => {
  it("reports the page count", async () => {
    expect(await getPageCount(await makePdf(4))).toBe(4);
  });

  it("reports rotations for a fresh document as all zero", async () => {
    expect(await getPageRotations(await makePdf(3))).toEqual([0, 0, 0]);
  });

  it("rejects non-PDF bytes with a friendly error", async () => {
    await expect(
      getPageCount(new Uint8Array([1, 2, 3, 4])),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });
});

describe("mergePdfs", () => {
  it("concatenates documents in order", async () => {
    const a = await makePdf(2); // widths 10, 20
    const b = await makePdf(3); // widths 10, 20, 30
    const merged = await mergePdfs([a, b]);
    expect(await widths(merged)).toEqual([10, 20, 10, 20, 30]);
  });

  it("throws when given no files", async () => {
    await expect(mergePdfs([])).rejects.toBeInstanceOf(PdfEngineError);
  });
});

describe("extractPages", () => {
  it("keeps only the selected pages in ascending order", async () => {
    const pdf = await makePdf(4); // 10, 20, 30, 40
    expect(await widths(await extractPages(pdf, [0, 2]))).toEqual([10, 30]);
  });

  it("de-duplicates and sorts the selection", async () => {
    const pdf = await makePdf(4);
    expect(await widths(await extractPages(pdf, [2, 0, 2]))).toEqual([10, 30]);
  });

  it("throws when nothing is selected", async () => {
    await expect(extractPages(await makePdf(4), [])).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });
});

describe("deletePages", () => {
  it("removes the selected pages", async () => {
    const pdf = await makePdf(3); // 10, 20, 30
    expect(await widths(await deletePages(pdf, [1]))).toEqual([10, 30]);
  });

  it("throws when deleting every page", async () => {
    const pdf = await makePdf(2);
    await expect(deletePages(pdf, [0, 1])).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });

  it("throws when nothing is selected", async () => {
    await expect(deletePages(await makePdf(2), [])).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });
});

describe("rotatePages", () => {
  it("rotates only the selected pages, relative to current rotation", async () => {
    const pdf = await makePdf(3);
    const once = await rotatePages(pdf, [0], 90);
    expect(await getPageRotations(once)).toEqual([90, 0, 0]);
    const twice = await rotatePages(once, [0], 90);
    expect(await getPageRotations(twice)).toEqual([180, 0, 0]);
  });

  it("normalizes negative turns", async () => {
    const pdf = await makePdf(2);
    const rotated = await rotatePages(pdf, [1], -90);
    expect(await getPageRotations(rotated)).toEqual([0, 270]);
  });

  it("throws when nothing is selected", async () => {
    await expect(rotatePages(await makePdf(2), [], 90)).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });
});

describe("splitPdf", () => {
  it("produces one output document per part with correct pages", async () => {
    const pdf = await makePdf(4); // 10, 20, 30, 40
    const parts = buildSplitParts("doc", [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
    const outputs = await splitPdf(pdf, parts);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]!.name).toBe("doc-1-pages-1-2.pdf");
    expect(await widths(outputs[0]!.bytes)).toEqual([10, 20]);
    expect(await widths(outputs[1]!.bytes)).toEqual([30, 40]);
  });

  it("produces one file per page in per-page mode", async () => {
    const pdf = await makePdf(3);
    const outputs = await splitPdf(
      pdf,
      buildSplitParts("doc", rangesPerPage(3)),
    );
    expect(outputs).toHaveLength(3);
    expect(await widths(outputs[2]!.bytes)).toEqual([30]);
  });

  it("throws when there are no parts", async () => {
    await expect(splitPdf(await makePdf(2), [])).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });
});

describe("organizePages", () => {
  it("reorders pages according to the plan", async () => {
    const pdf = await makePdf(3); // 10, 20, 30
    const out = await organizePages(pdf, [
      { sourceIndex: 2, rotation: 0 },
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 0, rotation: 0 },
    ]);
    expect(await widths(out)).toEqual([30, 20, 10]);
  });

  it("applies absolute rotations and supports deletes + duplicates", async () => {
    const pdf = await makePdf(3);
    const out = await organizePages(pdf, [
      { sourceIndex: 0, rotation: 90 },
      { sourceIndex: 0, rotation: 180 },
      { sourceIndex: 2, rotation: 0 },
    ]);
    expect(await widths(out)).toEqual([10, 10, 30]);
    expect(await getPageRotations(out)).toEqual([90, 180, 0]);
  });

  it("throws when the plan is empty", async () => {
    await expect(organizePages(await makePdf(2), [])).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });

  it("ignores out-of-range source indices", async () => {
    const pdf = await makePdf(2);
    const out = await organizePages(pdf, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 99, rotation: 0 },
    ]);
    expect(await widths(out)).toEqual([10]);
  });
});

/*
 * Left-out pages must not ride along inside the file.
 *
 * Found by the content writers on 2026-09-27 and published on the Extract and
 * Delete Pages pages as a warning: a kept page whose link jumped to a left-out
 * page made `copyPages` copy that page's object — text and images — into the
 * output, outside the page tree, and transitively through that page's own
 * links. The page tree was right the whole time, which is why nothing saw it;
 * these tests count the PAGE OBJECTS in the file instead.
 */
describe("pages left out of an output are not carried inside it", () => {
  /**
   * Five pages, widths 10..50. Page 1 links to page 3 by `/Dest`, page 3 links
   * to page 5 by a GoTo action, and page 2 links back to page 1.
   */
  async function makeLinkedPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const pages = [1, 2, 3, 4, 5].map((n) => doc.addPage([n * 10, 100]));
    const link = (from: number, entries: Record<string, unknown>) => {
      const annot = doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [0, 0, 5, 5],
          ...entries,
        } as never),
      );
      pages[from]!.node.set(PDFName.of("Annots"), doc.context.obj([annot]));
    };
    link(0, { Dest: [pages[2]!.ref, PDFName.of("Fit")] });
    link(2, {
      A: { S: "GoTo", D: [pages[4]!.ref, PDFName.of("Fit")] },
    });
    link(1, { Dest: [pages[0]!.ref, PDFName.of("Fit")] });
    return doc.save();
  }

  /** Widths of every /Type /Page object in the file, tree or not. */
  async function pageObjectWidths(bytes: Uint8Array): Promise<number[]> {
    const doc = await PDFDocument.load(bytes);
    const found: number[] = [];
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue;
      if (object.get(PDFName.of("Type")) !== PDFName.of("Page")) continue;
      const box = object.lookup(PDFName.of("MediaBox"), PDFArray);
      found.push(Math.round(box.lookup(2, PDFNumber).asNumber()));
    }
    return found.sort((a, b) => a - b);
  }

  /**
   * Where each tree page's first link lands: the target's width when it is a
   * page IN THE TREE, "orphan" when it is a page object the reader cannot
   * reach, null when the link opens nothing.
   */
  async function linkTargets(
    bytes: Uint8Array,
  ): Promise<(number | "orphan" | null)[]> {
    const doc = await PDFDocument.load(bytes);
    const tree = new Set(doc.getPages().map((page) => page.ref.toString()));
    return doc.getPages().map((page) => {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      const annot = annots?.lookup(0, PDFDict);
      const action = annot?.lookupMaybe(PDFName.of("A"), PDFDict);
      const dest =
        annot?.lookupMaybe(PDFName.of("Dest"), PDFArray) ??
        action?.lookupMaybe(PDFName.of("D"), PDFArray);
      if (!dest) return null;
      if (!tree.has(String(dest.get(0)))) return "orphan";
      const box = dest
        .lookup(0, PDFDict)
        .lookup(PDFName.of("MediaBox"), PDFArray);
      return Math.round(box.lookup(2, PDFNumber).asNumber());
    });
  }

  it("positive control: the counter sees the leak a raw copy makes", async () => {
    // Without this, a counter that saw only the tree would pass everything.
    const src = await PDFDocument.load(await makeLinkedPdf());
    const out = await PDFDocument.create();
    for (const page of await out.copyPages(src, [0, 1])) out.addPage(page);
    const bytes = await out.save();
    // The left-out 3 and 5 ride along, AND page 2's link to kept page 1 made
    // a second, orphan copy of page 1 — which is what that link opens.
    expect(await pageObjectWidths(bytes)).toEqual([10, 10, 20, 30, 50]);
    expect(await linkTargets(bytes)).toEqual(["orphan", "orphan"]);
  });

  it("extractPages carries only the selection", async () => {
    const out = await extractPages(await makeLinkedPdf(), [0, 1]);
    expect(await widths(out)).toEqual([10, 20]);
    expect(await pageObjectWidths(out)).toEqual([10, 20]);
    // A link to a KEPT page opens that page; one to a left-out page is inert.
    expect(await linkTargets(out)).toEqual([null, 10]);
  });

  it("deletePages leaves the deleted pages out of the bytes", async () => {
    const out = await deletePages(await makeLinkedPdf(), [2, 3, 4]);
    expect(await pageObjectWidths(out)).toEqual([10, 20]);
    expect(await linkTargets(out)).toEqual([null, 10]);
  });

  it("organizePages drops a deleted page a kept one linked to", async () => {
    const out = await organizePages(await makeLinkedPdf(), [
      { sourceIndex: 1, rotation: 0 },
      { sourceIndex: 0, rotation: 0 },
    ]);
    expect(await pageObjectWidths(out)).toEqual([10, 20]);
    expect(await linkTargets(out)).toEqual([10, null]);
  });

  it("splitPdf restores the source between parts, so a later part keeps its links", async () => {
    const [first, second] = await splitPdf(await makeLinkedPdf(), [
      { name: "a.pdf", indices: [0] },
      { name: "b.pdf", indices: [0, 2] },
    ]);
    expect(await pageObjectWidths(first!.bytes)).toEqual([10]);
    expect(await pageObjectWidths(second!.bytes)).toEqual([10, 30]);
    // In the second part page 3 WAS kept, so page 1's link survives the
    // first part's detaching; page 3's GoTo to the left-out page 5 is inert.
    expect(await linkTargets(second!.bytes)).toEqual([30, null]);
    expect(await linkTargets(first!.bytes)).toEqual([null]);
  });
});

describe("mergePdfs keeps a file's internal links pointing into the tree", () => {
  it("re-aims a link at the merged copy of its page, not an orphan", async () => {
    const doc = await PDFDocument.create();
    const [first, second] = [doc.addPage([10, 100]), doc.addPage([20, 100])];
    const annot = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [0, 0, 5, 5],
        Dest: [second.ref, PDFName.of("Fit")],
      } as never),
    );
    first.node.set(PDFName.of("Annots"), doc.context.obj([annot]));
    const merged = await PDFDocument.load(
      await mergePdfs([await makePdf(1), await doc.save()]),
    );
    const tree = merged.getPages().map((page) => page.ref.toString());
    const link = merged
      .getPage(1)
      .node.lookup(PDFName.of("Annots"), PDFArray)
      .lookup(0, PDFDict)
      .lookup(PDFName.of("Dest"), PDFArray);
    expect(String(link.get(0))).toBe(tree[2]);
    let pageObjects = 0;
    for (const [, object] of merged.context.enumerateIndirectObjects())
      if (
        object instanceof PDFDict &&
        object.get(PDFName.of("Type")) === PDFName.of("Page")
      )
        pageObjects++;
    expect(pageObjects).toBe(3);
  });
});
