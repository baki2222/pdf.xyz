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
 * And the LOCKED files (`src/tests/odf-locked-fixtures/`, locked by this
 * image's LibreOffice), one per tool:
 *  - the engine names each `password_protected`, before LibreOffice runs;
 *  - handed to LibreOffice DIRECTLY, each yields no PDF — the reason the
 *    check exists. A LibreOffice that converted one without its password
 *    would make the refusal a refusal of a file this image can convert, and
 *    that is a FAIL too;
 *  - the unlocked twin of one, made by the same script from the same kind of
 *    document, converts and carries its word, so "no PDF" is the lock and
 *    not the generator.
 *
 * Pure: the runner and the extractor are passed in. `input-proof.test.ts`
 * holds the verdict to stand-ins that break each property in turn.
 */
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  DOCUMENT_WORDS,
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
  /** Files LibreOffice locked with a password, at least one per tool. */
  readonly locked: readonly LockedOfficeFile[];
  /** The unlocked twin of one of them, and the word its PDF must carry. */
  readonly lockedTwin: LockedOfficeFile & { readonly word: string };
  /** CSVs in known encodings, through Excel to PDF (see CsvCharsetCase). */
  readonly csv: readonly CsvCharsetCase[];
}

/**
 * A CSV in a known encoding and the accented word its PDF must carry.
 * ADDED 2026-11-07, when production's "excel-to-pdf (csv)" proof found UTF-8
 * text printed as mojibake: the worker now imports a UTF-8 CSV as UTF-8 and
 * leaves any other CSV on LibreOffice's default (`csvImportFilter`). Only an
 * image run can show that LibreOffice reads both as intended.
 */
export interface CsvCharsetCase {
  readonly encoding: "utf-8" | "windows-1252";
  readonly name: string;
  readonly word: string;
  readonly build: () => Uint8Array;
}

/** A password-locked file and the tool it is sent to. */
export interface LockedOfficeFile {
  readonly tool: OfficeToPdfTool;
  readonly name: string;
  readonly bytes: Uint8Array;
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

  // Every tool the engine serves, from its own table, has a locked file.
  const uncovered = (Object.keys(DOCUMENT_WORDS) as OfficeToPdfTool[]).filter(
    (tool) => !deps.locked.some((l) => l.tool === tool),
  );
  if (uncovered.length > 0)
    fail(`locked: no locked file for ${uncovered.join(", ")}`);
  for (const file of deps.locked) {
    const label = `locked, ${file.tool} (${file.name})`;
    let calls = 0;
    const counting: LibreOfficePdfRunner = {
      convertToPdf: (input, filename, run) => {
        calls += 1;
        return deps.libreoffice.convertToPdf(input, filename, run);
      },
    };
    const run = await runOfficeToPdf(file.tool, file.bytes, file.name, {
      libreoffice: counting,
    });
    if (run.ok || run.kind !== "password_protected") {
      fail(
        `${label}: answered ${run.ok ? "ok" : run.kind}, not password_protected`,
      );
      continue;
    }
    if (calls !== 0) {
      fail(`${label}: named password-protected, but LibreOffice ran`);
      continue;
    }
    let direct: string;
    try {
      const pdf = await deps.libreoffice.convertToPdf(file.bytes, file.name);
      direct = `LibreOffice converted it without its password (${pdf.byteLength} bytes)`;
    } catch (error) {
      pass(
        `${label}: password_protected before LibreOffice; LibreOffice alone makes no PDF (${(error as Error).message})`,
      );
      continue;
    }
    fail(
      `${label}: ${direct}, so the refusal turns away a file this image converts`,
    );
  }
  const twin = deps.lockedTwin;
  const twinRun = await runOfficeToPdf(twin.tool, twin.bytes, twin.name, {
    libreoffice: deps.libreoffice,
  });
  if (!twinRun.ok) {
    fail(
      `locked twin, ${twin.name}: the engine answered ${twinRun.kind}: ${twinRun.message}`,
    );
  } else {
    const text = await deps.extract(twinRun.output);
    if (text.text.includes(twin.word))
      pass(`locked twin, ${twin.name}: converts, "${twin.word}" in its text`);
    else
      fail(
        `locked twin, ${twin.name}: converted, but "${twin.word}" is not in its text`,
      );
  }

  // CSV character sets: one of each encoding, or a fix for one could break
  // the other unseen; and a word with a non-ASCII letter, or the case
  // proves nothing about the character set.
  const encodings = new Set(deps.csv.map((c) => c.encoding));
  for (const needed of ["utf-8", "windows-1252"] as const)
    if (!encodings.has(needed))
      fail(`the CSV cases hold no ${needed} file; the proof needs one of each`);
  for (const c of deps.csv) {
    const label = `csv ${c.name} (${c.encoding})`;
    if (![...c.word].some((ch) => ch.charCodeAt(0) > 0x7f)) {
      fail(
        `${label}: its word "${c.word}" is plain ASCII, so it proves nothing`,
      );
      continue;
    }
    const run = await runOfficeToPdf("excel-to-pdf", c.build(), c.name, {
      libreoffice: deps.libreoffice,
    });
    if (!run.ok) {
      fail(`${label}: the engine answered ${run.kind}: ${run.message}`);
      continue;
    }
    const text = await deps.extract(run.output);
    if (text.text.includes(c.word)) pass(`${label}: "${c.word}" in its text`);
    else
      fail(
        `${label}: "${c.word}" is not in its text (${text.characterCount} characters read)`,
      );
  }
  return { ok, lines };
}
