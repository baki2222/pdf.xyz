/**
 * `pnpm worker:ocr-deskew-proof` — OCR PDF's "Straighten crooked pages"
 * (OCRmyPDF `--deskew`) through the built worker image's REAL OCRmyPDF, via
 * the registry's OCR processor wired as the daemon wires it, judged by
 * measuring the rendered output page. See `src/lib/workers/ocr-deskew-proof.ts`
 * for what it proves and why.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nativeOcrDeps, resolveOnPath } from "@/lib/workers/ocr-native";
import {
  greyOf,
  runOcrDeskewProof,
  type EngineRun,
} from "@/lib/workers/ocr-deskew-proof";
import { resolveNativePdfTextExtractor } from "@/lib/workers/pdf-text/native";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { renderPdfPages } from "@/tests/pdf-render";
import { scanOfFirstPage } from "@/tests/word-ocr-proof-fixtures";

/**
 * The image's `ocrmypdf` run directly on `pdf` with `flags`, in a temp dir
 * removed afterwards. Resolved with the exit status and stderr, never
 * rejected on them: the proof asks what the engine SAYS to a flag pair.
 */
async function ocrmypdf(pdf: Uint8Array, flags: string[]): Promise<EngineRun> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-deskew-proof-"));
  try {
    const input = path.join(dir, "in.pdf");
    await writeFile(input, pdf);
    return await new Promise<EngineRun>((resolve) => {
      execFile(
        "ocrmypdf",
        [...flags, input, path.join(dir, "out.pdf")],
        { timeout: 120_000, windowsHide: true },
        (error: (Error & { code?: unknown }) | null, _out, stderr) =>
          resolve({
            code:
              error === null
                ? 0
                : typeof error.code === "number"
                  ? error.code
                  : -1,
            stderr: String(stderr),
          }),
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
  return runOcrDeskewProof({
    ocr,
    // ~180 DPI on a Letter page's long side: a desk scanner's range.
    scan: (typed) => scanOfFirstPage(typed, 2000),
    // What a viewer paints (pdf.js), page 1 only.
    render: async (pdf) => {
      const [page] = await renderPdfPages(pdf, 1100);
      if (!page) throw new Error("the output PDF rendered no page");
      return greyOf(page);
    },
    pdfText: extract ? async (pdf) => (await extract(pdf)).text : null,
    ocrmypdf: resolveOnPath("ocrmypdf") ? ocrmypdf : null,
  });
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
