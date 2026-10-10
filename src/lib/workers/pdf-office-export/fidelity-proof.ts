/**
 * The round-trip fidelity proof: every committed fixture through the REAL PDF
 * to PowerPoint engine, the deck back to PDF through the REAL presentation
 * engine, compared page by page against its source (`./fidelity`) — with both
 * controls required to FAIL the same bound.
 *
 * Run inside the built worker image by `pnpm worker:pptx-fidelity-proof`
 * (`.github/workflows/container.yml`), the one CI place where pdftotext and
 * LibreOffice are both installed: CI's unit job has neither, and no vitest
 * suite runs in the image. Its injectable parts are what the image wires —
 * `pdfOfficeExportDeps` and the LibreOffice runner behind PowerPoint to PDF —
 * and `src/deploy/worker-pptx-fidelity-proof.test.ts` walks the chain from the
 * workflow step to that call.
 *
 * Output is content-free: fixture names, page numbers and scores.
 */
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  FIDELITY_BOUND,
  roundTripFidelity,
  type FidelityReport,
  type PptxToPdf,
} from "./fidelity";
import { runPdfOfficeExport, type PdfOfficeExportDeps } from "./engine";

export interface ProofFixture {
  name: string;
  pdf: Uint8Array;
}

export interface PptxFidelityProofDeps {
  /** The engine's deps, as the worker builds them. */
  exportDeps: PdfOfficeExportDeps;
  /** The presentation engine that turns a deck back into a PDF. */
  toPdf: PptxToPdf;
  fixtures: readonly ProofFixture[];
  /**
   * NEGATIVE CONTROL: the text-only deck this tool shipped until 2026-10-10,
   * built from the same extraction. It must FAIL on every fixture.
   */
  textOnlyDeck: (pages: ExtractedPdfText["pages"]) => Promise<Uint8Array>;
  /** NEGATIVE CONTROL: a deck of empty slides, one per page. */
  blankDeck: (pageCount: number) => Promise<Uint8Array>;
  bound?: { page: number; mean: number };
}

export interface PptxFidelityProofResult {
  ok: boolean;
  lines: string[];
}

const fmt = (r: FidelityReport) =>
  `${r.pass ? "PASS" : "FAIL"} ${r.detail} [${r.pages.map((p) => p.score.toFixed(3)).join(" ")}]`;

export async function runPptxFidelityProof(
  deps: PptxFidelityProofDeps,
): Promise<PptxFidelityProofResult> {
  const bound = deps.bound ?? FIDELITY_BOUND;
  const lines: string[] = [];
  let ok = deps.fixtures.length >= 4;
  if (!ok)
    lines.push(
      `only ${deps.fixtures.length} fixture(s): too few to prove anything`,
    );
  for (const fixture of deps.fixtures) {
    const run = await runPdfOfficeExport(
      "pdf-to-powerpoint",
      fixture.pdf,
      deps.exportDeps,
    );
    if (!run.ok) {
      ok = false;
      lines.push(`${fixture.name}: export FAILED (${run.kind})`);
      continue;
    }
    const subject = await roundTripFidelity(
      fixture.pdf,
      run.output,
      deps.toPdf,
      bound,
    );
    lines.push(`${fixture.name}: faithful deck ${fmt(subject)}`);
    if (!subject.pass) ok = false;

    // The controls go through the SAME comparator and bound, or they prove
    // nothing about it.
    const extract = deps.exportDeps.extract;
    const pages = extract ? (await extract(fixture.pdf)).pages : [];
    const textOnly = await roundTripFidelity(
      fixture.pdf,
      await deps.textOnlyDeck(pages),
      deps.toPdf,
      bound,
    );
    lines.push(`${fixture.name}: text-only control ${fmt(textOnly)}`);
    if (textOnly.pass) {
      ok = false;
      lines.push(
        `${fixture.name}: the text-only control PASSED — the bound cannot see a missing picture`,
      );
    }
    const blank = await roundTripFidelity(
      fixture.pdf,
      await deps.blankDeck(run.meta.pageCount),
      deps.toPdf,
      bound,
    );
    lines.push(`${fixture.name}: blank control ${fmt(blank)}`);
    if (blank.pass) {
      ok = false;
      lines.push(
        `${fixture.name}: the blank control PASSED — the bound cannot see an empty slide`,
      );
    }
  }
  return { ok, lines };
}
