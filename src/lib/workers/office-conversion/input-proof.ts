/**
 * The OpenDocument and RTF proof: each new input format through the REAL
 * Office to PDF engine (`runOfficeToPdf`, the content check included) and the
 * real LibreOffice runner, judged by reading the PDF it makes.
 *
 * What passes, per fixture (`@/tests/office-input-fixtures`):
 *  - the engine answers `ok` for the format's own tool and file name;
 *  - the PDF has at least one page, read by the image's own text extractor;
 *  - its text carries the fixture's distinctive word;
 *  - and carries NO other fixture's word, so a converter that answered every
 *    file with the same PDF cannot pass, and neither can a text check that
 *    matches anything.
 *
 * And the controls, each of which must be REFUSED, before LibreOffice runs:
 *  - an OpenDocument SPREADSHEET named `.odt`, sent to Word to PDF;
 *  - random bytes named `.rtf`.
 * A refusal is read from the engine's answer (`invalid_input`) and from the
 * runner's call count: a refusal that still ran LibreOffice is a FAIL.
 *
 * Pure: the runner and the extractor are passed in. `input-proof.test.ts`
 * holds the verdict to stand-ins that break each property in turn.
 */
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  runOfficeToPdf,
  type LibreOfficePdfRunner,
  type OfficeToPdfTool,
} from "./engine";

/** One file the proof converts, and the word its PDF must carry. */
export interface OfficeInputFixture {
  readonly kind: string;
  /** The tool that takes it. */
  readonly tool: OfficeToPdfTool;
  /** The upload's filename. */
  readonly name: string;
  /** The canonical MIME type a client declares for it. */
  readonly type: string;
  /** The word the produced PDF must carry; no fixture's word is in another's. */
  readonly word: string;
  readonly build: () => Promise<Uint8Array>;
}

export interface OfficeInputProofDeps {
  readonly libreoffice: LibreOfficePdfRunner;
  readonly extract: (pdf: Uint8Array) => Promise<ExtractedPdfText>;
  readonly fixtures: readonly OfficeInputFixture[];
  /** A real file of another format, for the renamed-file control. */
  readonly spreadsheetBytes: Uint8Array;
}

export interface OfficeInputProofResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** The fewest fixtures a run may hold: ODT, RTF, ODS and ODP. */
export const OFFICE_INPUT_PROOF_MIN_FIXTURES = 4;

export async function runOfficeInputProof(
  deps: OfficeInputProofDeps,
): Promise<OfficeInputProofResult> {
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string) => {
    ok = false;
    lines.push(`FAIL  ${line}`);
  };
  const pass = (line: string) => lines.push(`ok    ${line}`);

  if (deps.fixtures.length < OFFICE_INPUT_PROOF_MIN_FIXTURES) {
    fail(
      `only ${deps.fixtures.length} fixtures; the proof needs at least ${OFFICE_INPUT_PROOF_MIN_FIXTURES}`,
    );
  }
  const words = deps.fixtures.map((f) => f.word);

  for (const fixture of deps.fixtures) {
    const label = `${fixture.tool} (${fixture.kind})`;
    const bytes = await fixture.build();
    const run = await runOfficeToPdf(fixture.tool, bytes, fixture.name, {
      libreoffice: deps.libreoffice,
    });
    if (!run.ok) {
      fail(`${label}: the engine answered ${run.kind}: ${run.message}`);
      continue;
    }
    const text = await deps.extract(run.output);
    if (text.pageCount < 1) {
      fail(`${label}: the PDF has no pages`);
      continue;
    }
    const others = words.filter(
      (word) => word !== fixture.word && text.text.includes(word),
    );
    if (!text.text.includes(fixture.word)) {
      fail(
        `${label}: ${text.pageCount} page(s), but the word "${fixture.word}" is not in its text (${text.characterCount} characters read)`,
      );
    } else if (others.length > 0) {
      fail(`${label}: the PDF also carries ${others.join(", ")}`);
    } else {
      pass(
        `${label}: ${text.pageCount} page(s), "${fixture.word}" in its text`,
      );
    }
  }

  const controls: {
    label: string;
    tool: OfficeToPdfTool;
    name: string;
    bytes: Uint8Array;
  }[] = [
    {
      label: "an OpenDocument spreadsheet named .odt",
      tool: "word-to-pdf",
      name: "essay.odt",
      bytes: deps.spreadsheetBytes,
    },
    {
      label: "random bytes named .rtf",
      tool: "word-to-pdf",
      name: "memo.rtf",
      bytes: Uint8Array.from([0x13, 0x37, 0x00, 0xff, 0x42, 0x7b, 0x5c]),
    },
  ];
  for (const control of controls) {
    let calls = 0;
    const counting: LibreOfficePdfRunner = {
      convertToPdf: (input, filename, run) => {
        calls += 1;
        return deps.libreoffice.convertToPdf(input, filename, run);
      },
    };
    const run = await runOfficeToPdf(
      control.tool,
      control.bytes,
      control.name,
      {
        libreoffice: counting,
      },
    );
    if (run.ok || run.kind !== "invalid_input") {
      fail(
        `control, ${control.label}: answered ${run.ok ? "ok" : run.kind}, not invalid_input`,
      );
    } else if (calls !== 0) {
      fail(`control, ${control.label}: refused, but LibreOffice ran`);
    } else {
      pass(`control, ${control.label}: refused before LibreOffice`);
    }
  }
  return { ok, lines };
}
