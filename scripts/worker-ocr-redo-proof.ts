/**
 * `pnpm worker:ocr-redo-proof` — what “Redo existing OCR” (OCRmyPDF
 * `--redo-ocr`) takes away, through the built worker image's REAL OCRmyPDF,
 * via the registry's OCR processor wired as the daemon wires it, judged by
 * poppler's text of the output. See `src/lib/workers/ocr-redo-proof.ts` for
 * what it proves and why.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched.
 */
import { nativeOcrDeps } from "@/lib/workers/ocr-native";
import { runOcrRedoProof } from "@/lib/workers/ocr-redo-proof";
import { resolveNativePdfTextExtractor } from "@/lib/workers/pdf-text/native";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { SCANNED_LINE, scannedTextPdf } from "@/tests/word-ocr-proof-fixtures";

async function main(): Promise<number> {
  // OCR is opt-in at run time (`PDFXYZ_OCR`); the image ships the engines,
  // and this proof turns them on exactly as the deployed worker's env does.
  const env = { ...process.env, PDFXYZ_OCR: "on" };
  const ocr = createProcessorRegistry({ ocr: nativeOcrDeps(env) }).resolve(
    "ocr-pdf",
  );
  // The same wiring with Redo's pre-pass passed through: OCRmyPDF alone, the
  // negative control that shows which layers the engine keeps by itself.
  const engineAlone = createProcessorRegistry({
    ocr: nativeOcrDeps(env, {
      stripInvisibleText: async (bytes) => ({ bytes }),
    }),
  }).resolve("ocr-pdf");
  if (!ocr || !engineAlone) {
    console.log("CANNOT CONCLUDE — the registry serves no OCR processor.");
    return 2;
  }
  const extract = resolveNativePdfTextExtractor(process.env);
  return runOcrRedoProof({
    ocr,
    engineAlone,
    scan: await scannedTextPdf(),
    line: SCANNED_LINE,
    pdfText: extract ? async (pdf) => (await extract(pdf)).text : null,
  });
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
