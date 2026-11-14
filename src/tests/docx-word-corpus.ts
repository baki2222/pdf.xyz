/**
 * Every .docx PDF to Word writes from this repository's generated fixtures —
 * for the checks that must hold over the WHOLE corpus, not over a sample
 * someone picked: the structure check (`docx-structure.test.ts`), the
 * formatting's text conservation and the matcher's fallback rate
 * (`docx-run-style.test.ts`).
 *
 * The fixtures are DISCOVERED: every export of `./pdf-office-fixtures` and
 * `./docx-picture-fixtures` that is a function named `…Pdf` taking no
 * required argument. A generator added to either module joins the corpus
 * with nothing typed here, and one that is renamed cannot leave it
 * silently: the callers hold its size to a floor.
 *
 * Each is run through the engine on PRODUCTION's deps
 * (`pdfOfficeExportDeps`), with poppler's reading order stood in for
 * (`./poppler-flow-standin`), as `docx-pictures.test.ts` does. A fixture the
 * engine refuses (a scan with no text, say) is listed as refused, not
 * dropped: its refusal is part of what the corpus says.
 */
import * as officeFixtures from "./pdf-office-fixtures";
import * as pictureFixtures from "./docx-picture-fixtures";
import { flowStandIn } from "./poppler-flow-standin";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
} from "@/lib/workers/pdf-office-export/engine";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";

export interface WordCorpusEntry {
  name: string;
  pdf: Uint8Array;
  /** The .docx the engine delivered, or why it refused. */
  docx: Uint8Array | null;
  refused?: string;
}

type Generator = () => Promise<unknown>;

/** Every no-argument `…Pdf` generator the two fixture modules export. */
export function wordCorpusGenerators(): { name: string; make: Generator }[] {
  const out: { name: string; make: Generator }[] = [];
  for (const mod of [officeFixtures, pictureFixtures] as Record<
    string,
    unknown
  >[]) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== "function" || !/Pdf$/.test(name)) continue;
      if ((value as Generator).length !== 0) continue;
      out.push({ name, make: value as Generator });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The PDF a generator made: bare bytes, or a fixture record's `pdf`. */
function pdfOf(made: unknown): Uint8Array | null {
  if (made instanceof Uint8Array) return made;
  const pdf = (made as { pdf?: unknown } | null)?.pdf;
  return pdf instanceof Uint8Array ? pdf : null;
}

/** Production's deps, with poppler's reading order stood in for. */
export function corpusDeps(
  extra: Partial<PdfOfficeExportDeps> = {},
): PdfOfficeExportDeps {
  return {
    ...pdfOfficeExportDeps(),
    extractFlow: flowStandIn,
    repairPdf: undefined,
    ...extra,
  };
}

/** Run every discovered generator's PDF through PDF to Word. */
export async function wordCorpus(
  extra: Partial<PdfOfficeExportDeps> = {},
): Promise<WordCorpusEntry[]> {
  const out: WordCorpusEntry[] = [];
  for (const { name, make } of wordCorpusGenerators()) {
    const pdf = pdfOf(await make());
    if (!pdf) continue;
    const run = await runPdfOfficeExport(
      PDF_TO_WORD_TOOL,
      pdf,
      corpusDeps(extra),
    );
    out.push(
      run.ok
        ? { name, pdf, docx: run.output }
        : { name, pdf, docx: null, refused: `${run.kind}: ${run.message}` },
    );
  }
  return out;
}
