/**
 * `pnpm worker:docx-pictures-proof` — PDF to Word's pictures, inside the
 * built worker image: each generated fixture through the real engine
 * (poppler's pdftotext for the text, pdf.js for the pictures), judged by the
 * picture instrument, and each .docx laid out by the real LibreOffice runner
 * Word to PDF uses, which must paint every picture. The text-only .docx the
 * tool shipped until 2026-10-17, and a .docx missing one picture, must FAIL.
 * A damaged fixture (pdf-lib cannot load it) must be rebuilt by the image's
 * own qpdf, through the Repair PDF engine, and converted with its pictures.
 * See `src/lib/workers/pdf-office-export/docx-pictures-proof.ts`.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched, and nothing it prints is document text.
 */
import { runDocxPicturesProof } from "@/lib/workers/pdf-office-export/docx-pictures-proof";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import { nativeOfficeConversionDeps } from "@/lib/workers/office-conversion/native";
import { DOCX_PICTURE_FIXTURES } from "@/tests/docx-picture-fixtures";
import { dropPicture } from "@/tests/docx-hand-built";
import { docxTextOnly20261017 } from "@/tests/docx-text-only-2026-10-17";
import { junkAfterEofPdf } from "@/tests/pptx-fidelity-fixtures";

async function main(): Promise<number> {
  const exportDeps = pdfOfficeExportDeps(process.env);
  const libreoffice = nativeOfficeConversionDeps(process.env).libreoffice;
  if (
    !exportDeps.extractFlow ||
    !exportDeps.scanPages ||
    !libreoffice ||
    !exportDeps.repairPdf
  ) {
    console.log(
      `CANNOT CONCLUDE — ${!exportDeps.extractFlow ? "pdftotext" : !exportDeps.scanPages ? "the page reader (pdf.js and its canvas)" : !libreoffice ? "LibreOffice" : "qpdf (the repair engine)"} is not available in this image.`,
    );
    return 2;
  }
  const fixtures = await Promise.all(
    DOCX_PICTURE_FIXTURES.map(async (build) => {
      const f = await build();
      return { name: f.name, pdf: f.pdf, pictures: f.pictures.length };
    }),
  );
  const result = await runDocxPicturesProof({
    exportDeps,
    toPdf: (docx) => libreoffice.convertToPdf(docx, "docx-pictures-proof.docx"),
    fixtures,
    // A committed fixture that pdf-lib cannot load: 25 bytes after %%EOF.
    damaged: {
      name: `${fixtures[0]!.name} (junk after %%EOF)`,
      pdf: junkAfterEofPdf(fixtures[0]!.pdf),
      source: fixtures[0]!,
    },
    textOnlyDocx: (pages) => docxTextOnly20261017(pages),
    dropOnePicture: (docx) => dropPicture(docx, 0),
  });
  for (const line of result.lines) console.log(line);
  console.log(result.ok ? "PROVEN" : "FAIL");
  return result.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`FAIL — ${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  },
);
