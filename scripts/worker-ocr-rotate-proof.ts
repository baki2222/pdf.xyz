/**
 * `pnpm worker:ocr-rotate-proof` — OCR PDF's "Turn pages upright" (OCRmyPDF
 * `--rotate-pages`) through the built worker image's REAL OCRmyPDF, via the
 * registry's OCR processor wired as the daemon wires it, judged by what a
 * reader receives: page 1's `/Rotate`, the way pdf.js paints it, and the
 * sentinel in poppler's text. See `src/lib/workers/ocr-rotate-proof.ts` for
 * what it proves and why.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched.
 */
import { nativeOcrDeps } from "@/lib/workers/ocr-native";
import { greyOf } from "@/lib/workers/ocr-deskew-proof";
import { runOcrRotateProof } from "@/lib/workers/ocr-rotate-proof";
import { resolveNativePdfTextExtractor } from "@/lib/workers/pdf-text/native";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { renderPdfPages } from "@/tests/pdf-render";
import { scanOfFirstPage } from "@/tests/word-ocr-proof-fixtures";

async function main(): Promise<number> {
  // OCR is opt-in at run time (`PDFXYZ_OCR`); the image ships the engines,
  // and this proof turns them on exactly as the deployed worker's env does.
  const env = { ...process.env, PDFXYZ_OCR: "on" };
  const ocr = createProcessorRegistry({ ocr: nativeOcrDeps(env) }).resolve(
    "ocr-pdf",
  );
  if (!ocr) {
    console.log("CANNOT CONCLUDE — the registry serves no OCR processor.");
    return 2;
  }
  const extract = resolveNativePdfTextExtractor(process.env);
  return runOcrRotateProof({
    ocr,
    // ~180 DPI on a Letter page's long side: a desk scanner's range.
    scan: (typed) => scanOfFirstPage(typed, 2000),
    // What a viewer paints (pdf.js, `/Rotate` applied), page 1 only.
    render: async (pdf) => {
      const [page] = await renderPdfPages(pdf, 1100);
      if (!page) throw new Error("the output PDF rendered no page");
      return greyOf(page);
    },
    pdfText: extract ? async (pdf) => (await extract(pdf)).text : null,
  });
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
