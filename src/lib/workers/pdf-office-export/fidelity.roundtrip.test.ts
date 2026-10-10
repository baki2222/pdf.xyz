// @vitest-environment node
// @native-canvas
/**
 * ROUND TRIP: does the deck LOOK like the PDF? Every fixture through the real
 * engine, the deck back to PDF through LibreOffice (the importer PowerPoint to
 * PDF runs), and the pages compared with `./fidelity` against
 * {@link FIDELITY_BOUND} — which the text-only deck this tool shipped until
 * 2026-10-10, and a blank deck, must both FAIL.
 *
 * Skips VISIBLY where LibreOffice is not installed (the suite's name says so;
 * `PDFXYZ_TEST_SOFFICE` names a binary). CI's unit job has none, and no vitest
 * suite runs inside the worker image, so the run that counts in CI is
 * `pnpm worker:pptx-fidelity-proof` in `container.yml`, which executes the
 * same proof inside the image (`./fidelity-proof`). This suite is that proof
 * on a developer's machine.
 */
import { describe, expect, it } from "vitest";
import {
  pdftotextStandIn,
  PPTX_FIDELITY_FIXTURES,
} from "@/tests/pptx-fidelity-fixtures";
import { pptxTextOnly20261010 } from "@/tests/pptx-text-only-2026-10-10";
import { nativeOfficeConversionDeps } from "../office-conversion/native";
import { FIDELITY_BOUND } from "./fidelity";
import { runPptxFidelityProof } from "./fidelity-proof";
import { pdfOfficeExportDeps } from "./native";

const env = {
  ...process.env,
  ...(process.env.PDFXYZ_TEST_SOFFICE
    ? { PDFXYZ_OFFICE_CONVERSION_BIN: process.env.PDFXYZ_TEST_SOFFICE }
    : {}),
};
const LIBREOFFICE = nativeOfficeConversionDeps(env).libreoffice;
const suite = describe.skipIf(!LIBREOFFICE);
const label = LIBREOFFICE
  ? "PDF to PowerPoint round trip through LibreOffice"
  : "PDF to PowerPoint round trip through LibreOffice (SKIPPED: no soffice on PATH; set PDFXYZ_TEST_SOFFICE)";

suite(label, () => {
  it(`every fixture passes the bound (page ≤ ${FIDELITY_BOUND.page}, mean ≤ ${FIDELITY_BOUND.mean}); the text-only and blank decks fail it`, async () => {
    const fixtures = await Promise.all(
      PPTX_FIDELITY_FIXTURES.map((build) => build()),
    );
    const standIn = new Map(fixtures.map((f) => [f.name, pdftotextStandIn(f)]));
    const byPdf = new Map(fixtures.map((f) => [f.pdf, f.name]));
    const result = await runPptxFidelityProof({
      exportDeps: {
        ...pdfOfficeExportDeps(),
        // pdftotext stood in for where poppler is absent; the page reader
        // and the presentation engine are the real ones.
        extract: async (pdf) => standIn.get(byPdf.get(pdf)!)!,
      },
      toPdf: (pptx) => LIBREOFFICE!.convertToPdf(pptx, "round-trip.pptx"),
      fixtures: fixtures.map((f) => ({ name: f.name, pdf: f.pdf })),
      textOnlyDeck: (pages) => pptxTextOnly20261010(pages),
      blankDeck: (n) =>
        pptxTextOnly20261010(
          Array.from({ length: n }, (_, i) => ({
            pageNumber: i + 1,
            text: "",
            characterCount: 0,
          })),
        ),
    });
    console.log(result.lines.join("\n"));
    expect(
      result.lines.filter((l) =>
        /faithful deck FAIL|export FAILED|PASSED/.test(l),
      ),
    ).toEqual([]);
    expect(result.ok).toBe(true);
  }, 600_000);
});
