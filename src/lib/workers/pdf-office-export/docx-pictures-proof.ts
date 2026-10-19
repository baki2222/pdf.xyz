/**
 * PDF to Word's pictures, proven inside the worker image
 * (`pnpm worker:docx-pictures-proof`): every committed fixture through the
 * REAL engine — poppler's `-bbox-layout` for the text, pdf.js for the
 * pictures, qpdf to rebuild the damaged one — judged by the picture
 * instrument (`./docx-fidelity`), and each .docx laid out by the worker's
 * own LibreOffice (the runner Word to PDF uses), which must paint every
 * picture the .docx holds.
 *
 * ── WHY IN THE IMAGE ────────────────────────────────────────────────────────
 *
 * CI's unit job has no poppler, and no vitest suite runs in the image, so
 * the tests stand poppler in (`@/tests/poppler-flow-standin`). Where a
 * picture lands among the paragraphs depends on poppler's frame and pdf.js's
 * agreeing; the stand-in agrees by construction, read from poppler's source.
 * This is the one place before production where the two meet — the cropped
 * fixture is the one that would see them disagree.
 *
 * ── ITS CONTROLS ────────────────────────────────────────────────────────────
 *
 * For every fixture, the text-only .docx shipped until 2026-10-17 (from the
 * same poppler reading) must FAIL the instrument with no picture found, and
 * the engine's own .docx with one picture removed must FAIL it too; and the
 * text-only .docx, laid out by LibreOffice, must paint no picture. A proof
 * whose controls pass is not evidence.
 */
import type { PdfFlowTextPage } from "../pdf-text/flow";
import { compareDocxPictures } from "./docx-fidelity";
import { readDocxBody } from "./docx-read";
import { runPdfOfficeExport, type PdfOfficeExportDeps } from "./engine";
import { inventoryPages } from "./page-inventory";

export interface DocxPicturesProofInput {
  /** The worker's own deps (`pdfOfficeExportDeps`). */
  exportDeps: PdfOfficeExportDeps;
  /** A .docx laid out by a word processor, as a PDF (LibreOffice). */
  toPdf: (docx: Uint8Array) => Promise<Uint8Array>;
  /** Each fixture, and how many pictures it paints (its own record). */
  fixtures: { name: string; pdf: Uint8Array; pictures: number }[];
  /** A fixture the page reader cannot read ahead, and its undamaged source. */
  damaged: { name: string; pdf: Uint8Array; source: { pdf: Uint8Array } };
  /** The text-only .docx shipped until 2026-10-17, from reading-order pages. */
  textOnlyDocx: (pages: readonly PdfFlowTextPage[]) => Promise<Uint8Array>;
  /** The engine's .docx with one picture removed: a partial control. */
  dropOnePicture: (docx: Uint8Array) => Promise<Uint8Array>;
}

/**
 * How many fixtures the proof may be handed. A corpus that quietly shrank
 * reports the strongest pass there is (`[] ⊆ X`, CLAUDE.md rule 4), so one
 * under `min` FAILS the proof, however well each fixture fared; one over
 * `max` is not the committed corpus either. Raise `min` with the corpus
 * (12 on 2026-10-17); `docx-pictures-proof.test.ts` holds the committed one
 * inside both.
 */
export const PROOF_CORPUS = { min: 12, max: 64 } as const;

/** How many pictures a PDF paints (not stencils), read from the file. */
async function paintedPictures(pdf: Uint8Array): Promise<number | null> {
  const pages = await inventoryPages(pdf);
  if (!pages) return null;
  return pages.reduce(
    (n, p) => n + p.placements.filter((pl) => !p.images[pl.image]?.mask).length,
    0,
  );
}

/** Run the proof; every line it returns is content-free. */
export async function runDocxPicturesProof(
  input: DocxPicturesProofInput,
): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string) => {
    ok = false;
    lines.push(`FAIL ${line}`);
  };
  const { exportDeps } = input;
  if (!exportDeps.extractFlow || !exportDeps.scanPages)
    return {
      ok: false,
      lines: ["FAIL the worker's deps have no extractor or page reader"],
    };
  if (input.fixtures.length === 0)
    return { ok: false, lines: ["FAIL no fixtures: nothing would be proven"] };
  // Judged all the same: the lines say what the corpus it had proved.
  if (input.fixtures.length < PROOF_CORPUS.min)
    fail(
      `the corpus holds ${input.fixtures.length} fixture(s), implausibly few (at least ${PROOF_CORPUS.min})`,
    );
  if (input.fixtures.length > PROOF_CORPUS.max)
    fail(
      `the corpus holds ${input.fixtures.length} fixture(s), implausibly many (at most ${PROOF_CORPUS.max})`,
    );

  for (const fixture of input.fixtures) {
    const run = await runPdfOfficeExport(
      "pdf-to-word",
      fixture.pdf,
      exportDeps,
    );
    if (!run.ok) {
      fail(`${fixture.name}: the engine refused it (${run.kind})`);
      continue;
    }
    const report = await compareDocxPictures(fixture.pdf, run.output);
    if (report.sourcePictures !== fixture.pictures)
      fail(
        `${fixture.name}: the instrument found ${report.sourcePictures} source picture(s), the fixture paints ${fixture.pictures}`,
      );
    if (!report.pass) fail(`${fixture.name}: ${report.detail}`);
    else lines.push(`ok   ${fixture.name}: ${report.detail}`);

    const flow = await exportDeps.extractFlow(fixture.pdf);
    const textOnly = await input.textOnlyDocx(flow.pages);
    const control = await compareDocxPictures(fixture.pdf, textOnly);
    if (control.pass || control.matched > 0)
      fail(
        `${fixture.name}: CONTROL the text-only .docx passed (${control.detail})`,
      );
    else
      lines.push(
        `ok   ${fixture.name}: control, text-only .docx fails (${control.matched} of ${control.sourcePictures} found)`,
      );
    const partial = await compareDocxPictures(
      fixture.pdf,
      await input.dropOnePicture(run.output),
    );
    if (partial.pass)
      fail(`${fixture.name}: CONTROL a .docx missing one picture passed`);
    else
      lines.push(
        `ok   ${fixture.name}: control, one picture removed fails (${partial.matched} of ${partial.sourcePictures} found)`,
      );

    // A real word processor lays the document out: every picture painted.
    const held = (await readDocxBody(run.output)).pictures.length;
    const laid = await paintedPictures(await input.toPdf(run.output));
    if (laid !== held)
      fail(
        `${fixture.name}: LibreOffice painted ${laid ?? "?"} of the .docx's ${held} picture(s)`,
      );
    else
      lines.push(
        `ok   ${fixture.name}: LibreOffice laid the .docx out painting all ${held} picture(s)`,
      );
    const laidText = await paintedPictures(await input.toPdf(textOnly));
    if (laidText !== 0)
      fail(
        `${fixture.name}: CONTROL LibreOffice painted ${laidText ?? "?"} picture(s) for the text-only .docx`,
      );
  }

  // The damaged fixture: rebuilt by the image's qpdf, then every picture.
  const damaged = await runPdfOfficeExport(
    "pdf-to-word",
    input.damaged.pdf,
    exportDeps,
  );
  if (!damaged.ok)
    fail(
      `${input.damaged.name}: not converted (${damaged.kind}: ${damaged.message})`,
    );
  else {
    const report = await compareDocxPictures(
      input.damaged.source.pdf,
      damaged.output,
    );
    if (damaged.coverage.repairedBeforeConversion !== true)
      fail(
        `${input.damaged.name}: converted without the rebuild being reported`,
      );
    if (!report.pass) fail(`${input.damaged.name}: ${report.detail}`);
    else
      lines.push(
        `ok   ${input.damaged.name}: rebuilt first, then ${report.detail}`,
      );
  }
  return { ok, lines };
}
