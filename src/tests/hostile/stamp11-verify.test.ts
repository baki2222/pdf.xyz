// @native-canvas
// STAMP-11 adversarial verification: /Count -1 over one real page, through
// addPageNumbers, read back by pdfjs (the app's preview engine) and pdf-lib.
import { describe, expect, it } from "vitest";
import { countNegativePdf } from "./conversion-out.fixtures";

async function pdfjsPages(bytes: Uint8Array): Promise<number | string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
  });
  try {
    const doc = await Promise.race([
      task.promise,
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 10_000),
      ),
    ]);
    const n = doc.numPages;
    let firstPage = "n/a";
    try {
      const p = await doc.getPage(1);
      firstPage = `ok ${p.view.join(",")}`;
    } catch (e) {
      firstPage = `getPage(1) threw: ${(e as Error).message}`;
    }
    return `${n} | ${firstPage}`;
  } catch (e) {
    return `load threw: ${(e as Error).message}`;
  } finally {
    await task.destroy();
  }
}

const countOf = (bytes: Uint8Array) => {
  const s = Buffer.from(bytes).toString("latin1");
  return [...s.matchAll(/\/Count\s+(-?[\d.]+)/g)].map((m) => m[1]);
};

describe("STAMP-11 /Count -1", () => {
  it("input vs addPageNumbers output", { timeout: 30_000 }, async () => {
    const input = countNegativePdf();
    const { addPageNumbers } = await import("@/lib/pdf/page-numbers");
    const { loadPdf } = await import("@/lib/pdf/engine");
    const inPdfjs = await pdfjsPages(input);
    const inLib = (await loadPdf(input)).getPageCount();
    const out = await addPageNumbers(input);
    const outPdfjs = await pdfjsPages(out);
    const outLib = (await loadPdf(out)).getPageCount();
    const report = {
      input: { pdfjs: inPdfjs, pdfLib: inLib, count: countOf(input) },
      output: {
        pdfjs: outPdfjs,
        pdfLib: outLib,
        count: countOf(out),
        bytes: out.length,
      },
    };
    console.log(JSON.stringify(report, null, 2));
    expect(outLib).toBe(1);
    const { PDFName } = await import("pdf-lib");
    const outDoc = await loadPdf(out);
    const pagesCount = outDoc.catalog
      .Pages()
      .get(PDFName.of("Count"))
      ?.toString();
    console.log("output /Pages /Count via pdf-lib:", pagesCount);
    expect(pagesCount).toBe("-1");
    expect(String(outPdfjs)).toMatch(/^-1 \| getPage\(1\) threw/);
  });
});
