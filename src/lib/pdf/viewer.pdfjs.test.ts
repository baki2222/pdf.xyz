// @vitest-environment node
// @native-canvas
import { describe, expect, it, vi } from "vitest";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { UNREADABLE_PDF_MESSAGE } from "./engine-errors";
import { PDF_NESTED_TOO_DEEPLY_MESSAGE } from "./pdfjs-guard";
import { VIEWER_MAX_TEXT_ITEMS } from "./viewer-geometry";
import { findInItems, viewerSearchPattern } from "./viewer-search";
import { openViewerPdf, viewerPdfjs } from "./viewer";
import { imageHugeDimsPdf } from "@/tests/hostile/conversion-out.fixtures";
import {
  splitQPdf,
  zeroWidthXrefPdf,
} from "@/tests/hostile/pdfjs-open.fixtures";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";
import {
  VIEWER_PROOF_PAGES,
  VIEWER_PROOF_URL,
  VIEWER_PROOF_WORD,
  countZeroPdf,
  manyTextItemsPdf,
  viewerProofPdf,
} from "@/tests/viewer-fixtures";

/**
 * The PDF Viewer's pdf.js open, on the legacy build (no canvas needed for
 * the questions asked here: page sizes, text, links, bookmarks, refusals).
 * Drawing — CO-08's skipped image, the canvas cap — is proved in a child
 * process by src/tests/hostile/pdfjs-guard-bounds.test.ts ("viewer").
 *
 * The spy goes through `viewerPdfjs`, the module's own seam, not `vi.mock`
 * (src/tests/mock-isolation.test.ts).
 */
async function withSpy<T>(
  run: (spy: ReturnType<typeof vi.fn>) => Promise<T>,
): Promise<T> {
  const real = viewerPdfjs.loadPdfjs;
  const spy = vi.fn();
  viewerPdfjs.loadPdfjs = (async () => {
    const pdfjs = await real();
    return {
      ...pdfjs,
      getDocument: (opts: Parameters<typeof pdfjs.getDocument>[0]) => {
        spy(opts);
        return pdfjs.getDocument(opts);
      },
    };
  }) as typeof real;
  try {
    return await run(spy);
  } finally {
    viewerPdfjs.loadPdfjs = real;
  }
}

describe("openViewerPdf reads what the viewer shows", () => {
  it("a multi-page PDF: count, sizes, text, links (the script link dropped) and bookmarks", async () => {
    const doc = await openViewerPdf(viewerProofPdf());
    try {
      expect(doc.numPages).toBe(VIEWER_PROOF_PAGES);
      expect(doc.imageTooLarge).toBe(false);
      expect(await doc.pageSize(0)).toEqual({ width: 612, height: 792 });

      const pattern = viewerSearchPattern(VIEWER_PROOF_WORD, {
        matchCase: false,
      })!;
      const hits: number[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        const t = await doc.text(i);
        expect(t.capped).toBe(false);
        hits.push(findInItems(t.items, pattern).length);
      }
      // The word is on page 3 only, mid-line.
      expect(hits).toEqual([0, 0, 1]);
      const page3 = await doc.text(2);
      const [match] = findInItems(page3.items, pattern);
      expect(match![0]!.start).toBeGreaterThan(0);

      const links = await doc.links(0);
      expect(links.map((l) => l.kind)).toEqual(["page", "url"]);
      expect(links[0]).toMatchObject({ kind: "page", page: 2 });
      expect(links[1]).toMatchObject({ kind: "url", href: VIEWER_PROOF_URL });
      // The link's box, in fractions of the page, sits where it was drawn:
      // x 72..260 of 612, y (from the top) 86..107 of 792.
      expect(links[0]!.rect.left).toBeCloseTo(72 / 612, 3);
      expect(links[0]!.rect.top).toBeCloseTo((792 - 706) / 792, 3);

      const outline = await doc.outline();
      expect(outline).toEqual({
        truncated: false,
        entries: [
          { title: "Second page", depth: 0, page: 1, href: null },
          { title: "Third page", depth: 0, page: 2, href: null },
        ],
      });
    } finally {
      await doc.destroy();
    }
  });

  it("an owner-restricted PDF opens (pdf.js reads it as every viewer does)", async () => {
    const doc = await openViewerPdf(ownerOnlyEncryptedPdf());
    expect(doc.numPages).toBeGreaterThanOrEqual(1);
    await doc.destroy();
  });

  it("a PDF that needs a password to open is the typed needs-password refusal", async () => {
    await expect(
      openViewerPdf(userPasswordEncryptedPdf()),
    ).rejects.toMatchObject({ kind: "encrypted" });
  });

  it("/Count 0 is the unreadable refusal, never a viewer of no pages", async () => {
    await expect(openViewerPdf(countZeroPdf())).rejects.toMatchObject({
      message: UNREADABLE_PDF_MESSAGE,
      kind: "unreadable",
    });
  });

  it(`a ${(30_000).toLocaleString("en-US")}-item page is read to the cap and says it was capped`, async () => {
    const doc = await openViewerPdf(manyTextItemsPdf(30_000));
    try {
      const t = await doc.text(0);
      expect(t.capped).toBe(true);
      expect(t.items).toHaveLength(VIEWER_MAX_TEXT_ITEMS);
    } finally {
      await doc.destroy();
    }
  }, 60_000);

  it("positive control: a page under the cap is read whole, not capped", async () => {
    const doc = await openViewerPdf(manyTextItemsPdf(500));
    try {
      const t = await doc.text(0);
      expect(t).toMatchObject({ capped: false });
      // pdf.js adds an empty item at each move; the 500 drawn ones are all here.
      expect(t.items.filter((i) => i.str === "w")).toHaveLength(500);
    } finally {
      await doc.destroy();
    }
  });
});

describe("openViewerPdf refuses before pdf.js parses (loader spy)", () => {
  it("a zero-width xref and a q-split page are refused, typed, and getDocument is never called", async () => {
    await withSpy(async (spy) => {
      await expect(openViewerPdf(zeroWidthXrefPdf())).rejects.toMatchObject({
        kind: "unreadable",
      });
      await expect(openViewerPdf(splitQPdf(32, 1_020))).rejects.toMatchObject({
        message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("an over-budget image: getDocument gets the defaults and maxImageSize, and the viewer knows to say so", async () => {
    await withSpy(async (spy) => {
      const doc = await openViewerPdf(imageHugeDimsPdf());
      try {
        expect(doc.imageTooLarge).toBe(true);
      } finally {
        await doc.destroy();
      }
      expect(spy).toHaveBeenCalledTimes(1);
      const [opts] = spy.mock.calls[0] as [Record<string, unknown>];
      expect(opts).toMatchObject(PDFJS_DOCUMENT_DEFAULTS);
      expect(opts.maxImageSize).toBe(100_000 * 100_000 - 1);
    });
  });

  it("positive control: a plain file reaches getDocument with no maxImageSize", async () => {
    await withSpy(async (spy) => {
      const doc = await openViewerPdf(viewerProofPdf());
      await doc.destroy();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(doc.imageTooLarge).toBe(false);
      const [opts] = spy.mock.calls[0] as [Record<string, unknown>];
      expect(opts).not.toHaveProperty("maxImageSize");
    });
  });
});
