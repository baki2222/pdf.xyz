/**
 * `pnpm worker:ocr-languages-proof` — every OCR language the product offers,
 * asked of the built worker image's own Tesseract, and a page in each sample
 * script typed by its Chromium, scanned, and read back through the REAL OCR
 * PDF and PDF to Word processors, wired as the daemon's registry wires them.
 * See `src/lib/workers/ocr-languages-proof.ts` for what it proves and why.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched.
 */
import { execFile } from "node:child_process";
import { nativeHtmlRenderDeps } from "@/lib/workers/html-render/native";
import { nativeOcrDeps } from "@/lib/workers/ocr-native";
import { runOcrLanguagesProof } from "@/lib/workers/ocr-languages-proof";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import { readDocxParagraphs } from "@/lib/workers/pdf-office-export/docx-text";
import { resolveNativePdfTextExtractor } from "@/lib/workers/pdf-text/native";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { scanOfFirstPage } from "@/tests/word-ocr-proof-fixtures";

/** `tesseract --list-langs`, both streams (versions differ in which). */
function listLangs(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "tesseract",
      ["--list-langs"],
      { timeout: 30_000, windowsHide: true },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        if (error && typeof code !== "number") return resolve(null);
        resolve(`${String(stdout)}\n${String(stderr)}`);
      },
    );
  });
}

async function main(): Promise<number> {
  // OCR is opt-in at run time (`PDFXYZ_OCR`); the image ships the engines,
  // and this proof turns them on exactly as the deployed worker's env does.
  const env = { ...process.env, PDFXYZ_OCR: "on" };
  const registry = createProcessorRegistry({
    ocr: nativeOcrDeps(env),
    pdfOfficeExport: pdfOfficeExportDeps(env),
  });
  const ocr = registry.resolve("ocr-pdf");
  const pdfToWord = registry.resolve("pdf-to-word");
  if (!ocr || !pdfToWord) {
    console.log(
      "CANNOT CONCLUDE — the registry serves no OCR or PDF to Word processor.",
    );
    return 2;
  }
  const chromium = nativeHtmlRenderDeps(process.env).chromium;
  const extract = resolveNativePdfTextExtractor(process.env);
  return runOcrLanguagesProof({
    listLangs,
    renderHtml: chromium ? (html) => chromium.renderHtml(html) : null,
    // ~200 DPI on a Letter page's long side, as `scannedTextPdf` scans.
    scan: (typed) => scanOfFirstPage(typed, 2200),
    pdfText: extract ? async (pdf) => (await extract(pdf)).text : null,
    ocr,
    pdfToWord,
    docxText: async (docx) => (await readDocxParagraphs(docx)).join("\n"),
  });
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
