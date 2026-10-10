/**
 * `pnpm worker:pptx-fidelity-proof` — PDF to PowerPoint's round trip, inside
 * the built worker image: each generated fixture through the real engine
 * (poppler's pdftotext, pdf.js), the deck back to PDF through the real
 * LibreOffice runner PowerPoint to PDF uses, and the pages compared. The
 * text-only deck the tool shipped until 2026-10-10 and a blank deck must both
 * FAIL the same bound. See `src/lib/workers/pdf-office-export/fidelity-proof.ts`.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is not available
 * in this image. Run by `.github/workflows/container.yml`; no secret, queue,
 * store, or user document is touched, and nothing it prints is document text.
 */
import { runPptxFidelityProof } from "@/lib/workers/pdf-office-export/fidelity-proof";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import { nativeOfficeConversionDeps } from "@/lib/workers/office-conversion/native";
import { PPTX_FIDELITY_FIXTURES } from "@/tests/pptx-fidelity-fixtures";
import { pptxTextOnly20261010 } from "@/tests/pptx-text-only-2026-10-10";

async function main(): Promise<number> {
  const exportDeps = pdfOfficeExportDeps(process.env);
  const libreoffice = nativeOfficeConversionDeps(process.env).libreoffice;
  if (!exportDeps.extract || !libreoffice) {
    console.log(
      `CANNOT CONCLUDE — ${!exportDeps.extract ? "pdftotext" : "LibreOffice"} is not available in this image.`,
    );
    return 2;
  }
  const fixtures = await Promise.all(
    PPTX_FIDELITY_FIXTURES.map(async (build) => {
      const f = await build();
      return { name: f.name, pdf: f.pdf };
    }),
  );
  const result = await runPptxFidelityProof({
    exportDeps,
    toPdf: (pptx) => libreoffice.convertToPdf(pptx, "fidelity-proof.pptx"),
    fixtures,
    textOnlyDeck: (pages) => pptxTextOnly20261010(pages),
    blankDeck: (pageCount) =>
      pptxTextOnly20261010(
        Array.from({ length: pageCount }, (_, i) => ({
          pageNumber: i + 1,
          text: "",
          characterCount: 0,
        })),
      ),
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
