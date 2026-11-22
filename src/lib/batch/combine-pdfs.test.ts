// @vitest-environment node
/**
 * PowerPoint to PDF's "Combine into one PDF" (audit wave 2,
 * powerpoint-to-pdf#1): the rows' PDFs joined in the order given. Page
 * counts differ per input (2, 1, 3) so a wrong order or a dropped file
 * cannot add up to the same document; each segment's first page is read
 * back from the joined file.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { combineBatchPdfs } from "./combine-pdfs";
import { combinedDownloadLabel } from "./worker-copy";

async function deck(label: string, pages: number): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++)
    doc.addPage([300 + pages, 200]).drawText(`${label} ${i + 1}`, { font });
  return new Blob([(await doc.save()) as BlobPart]);
}

describe("combineBatchPdfs", () => {
  it("joins every PDF, in the order given", async () => {
    const plan = [
      ["one", 2],
      ["two", 1],
      ["three", 3],
    ] as const;
    const joined = await PDFDocument.load(
      await combineBatchPdfs(
        await Promise.all(plan.map(([l, n]) => deck(l, n))),
      ),
    );
    expect(joined.getPageCount()).toBe(6);
    // Each source's page width carries its page count: 302, 302, 301, 303 x3.
    expect(joined.getPages().map((p) => p.getWidth())).toEqual([
      302, 302, 301, 303, 303, 303,
    ]);
  });

  it("names how many of the files the single PDF joins", () => {
    expect(combinedDownloadLabel(3, 3)).toBe("Download one PDF (3 files)");
    expect(combinedDownloadLabel(2, 3)).toBe("Download one PDF (2 of 3 files)");
  });
});
