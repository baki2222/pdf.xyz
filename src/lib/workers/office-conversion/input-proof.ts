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
 * And the CSV DEFAULT IMPORT (review, 2026-11-17): value-rich CSVs, one
 * ASCII and one UTF-8, converted the way the worker imports them (Auto,
 * through the engine) and again with NO import options by the same runner
 * (`libreofficeNoOptions`). The two must print the same values: every
 * ASCII word of the two texts equal, in order. The check exists because
 * the filter once stopped after token 4, which leaves LibreOffice's
 * "detect special numbers" on, so `1/2` printed as a date and `12%` as
 * 12.00%, while a test compared only the option string and called it the
 * same import. Each case's `marks` must be in the no-options text first,
 * or a blank or garbled baseline would make "the same" vacuous; and the
 * UTF-8 case's word must be in the Auto text, or it was not read as UTF-8.
 *
 * And the FILE NAME in a CSV's header (2026-11-17, found in production): a
 * CSV becomes one sheet named after the file LibreOffice opened, and Calc's
 * default page style prints the sheet name at the top of every page. Every
 * upload used to be written as `input.<ext>`, so every converted CSV said
 * "input" there. Each CSV named with a non-Latin stem (`csvFileNames`) must
 * print that stem and never "input"; the CONTROL, a CSV the user named
 * `input.csv`, must print "input", or the header is not printed or not read
 * and the other cases' "never input" proves nothing. Judged by
 * {@link fileNameHeaderVerdict}, which `scripts/worker-prove-tools.ts` uses
 * on the downloaded PDF too.
 *
 * Pure: the runner and the extractor are passed in. `input-proof.test.ts`
 * holds the verdict to stand-ins that break each property in turn.
 */
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { CsvImportChoice } from "./csv-import";
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
  /** CSVs read with a chosen delimiter or character set (see CsvChoiceCase). */
  readonly csvChoices: readonly CsvChoiceCase[];
  /** The same LibreOffice runner with no import options on any file. */
  readonly libreofficeNoOptions: LibreOfficePdfRunner;
  /** Value-rich CSVs for the default-import comparison (see CsvDefaultCase). */
  readonly csvDefaults: readonly CsvDefaultCase[];
  /** CSVs whose printed header must show their own stem (see CsvFileNameCase). */
  readonly csvFileNames: readonly CsvFileNameCase[];
}

/**
 * A CSV named with a stem its header must print (ADDED 2026-11-17). The
 * `control` case is named `input.csv` and must print "input": the proof that
 * the header is there to read.
 */
export interface CsvFileNameCase {
  readonly label: string;
  /** The upload's filename. */
  readonly name: string;
  /** The stem the header must show. */
  readonly stem: string;
  readonly build: () => Uint8Array;
  readonly control?: boolean;
}

/** The name every upload was written under until 2026-11-17. */
export const OLD_INPUT_STEM = "input";

/**
 * Does the PDF's text show `stem`, and does it show the old fixed name?
 * Whitespace is removed and both are NFC-composed first, as an extractor may
 * break a line or a word anywhere in a header.
 */
export function fileNameHeaderVerdict(
  text: string,
  stem: string,
): { readonly shows: boolean; readonly showsInput: boolean } {
  const squeeze = (s: string) => s.normalize("NFC").replace(/\s+/g, "");
  const t = squeeze(text);
  return {
    shows: t.includes(squeeze(stem)),
    showsInput: t.toLowerCase().includes(OLD_INPUT_STEM),
  };
}

/**
 * A CSV full of values LibreOffice can reformat (a date, a fraction, a
 * percentage, scientific notation, a leading zero), for the default-import
 * comparison in the header. ADDED 2026-11-17 (review).
 */
export interface CsvDefaultCase {
  readonly encoding: "ascii" | "utf-8";
  readonly name: string;
  readonly build: () => Uint8Array;
  /** Words the no-options import prints for this file, each a whole word. */
  readonly marks: readonly string[];
  /** UTF-8 only: the non-ASCII word the Auto import must print. */
  readonly word?: string;
}

/** The words of a text made only of ASCII characters, in order. */
const asciiWords = (text: string) =>
  text
    .split(/\s+/)
    .filter((w) => w && [...w].every((ch) => ch.charCodeAt(0) < 0x80));

/**
 * A CSV that reads right only with the right Delimiter or Character set
 * (competitor audit #18, 2026-11-17). Each is converted with every `right`
 * choice, whose PDF must pass `reads`, and with every `wrong` one, whose PDF
 * must convert and FAIL `reads`: the control that shows the check can fail,
 * so a pass is the choice at work and not a judge that passes anything.
 */
export interface CsvChoiceCase {
  /** The name the run requires it by (see {@link CSV_CHOICE_PROOF_REQUIRED}). */
  readonly label: string;
  readonly name: string;
  readonly build: () => Uint8Array;
  readonly right: readonly CsvImportChoice[];
  readonly wrong: readonly CsvImportChoice[];
  /** True when the PDF's text shows the file read as intended. */
  readonly reads: (text: string) => boolean;
  /** What `reads` looks for, for the printed line. */
  readonly want: string;
}

/** The cases a run must hold: the two the feature was asked to prove. */
export const CSV_CHOICE_PROOF_REQUIRED = ["semicolon", "windows-1251"] as const;

const describeChoice = (c: CsvImportChoice) =>
  `delimiter ${c.delimiter ?? "auto"}, charset ${c.charset ?? "auto"}`;

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

  // CSV choices: the required cases are present, each judge rejects an
  // empty page (or a blank PDF would pass the controls below), and every
  // choice is converted by the real engine and the real LibreOffice.
  const choiceLabels = new Set(deps.csvChoices.map((c) => c.label));
  for (const needed of CSV_CHOICE_PROOF_REQUIRED)
    if (!choiceLabels.has(needed))
      fail(`the CSV choice cases hold no "${needed}" case; the run needs it`);
  for (const c of deps.csvChoices) {
    const label = `csv choice ${c.label} (${c.name})`;
    if (c.right.length === 0 || c.wrong.length === 0) {
      fail(`${label}: it needs a right choice and a wrong one`);
      continue;
    }
    if (c.reads("")) {
      fail(`${label}: its judge passes an empty page, so it proves nothing`);
      continue;
    }
    for (const [choice, expected] of [
      ...c.right.map((r) => [r, true] as const),
      ...c.wrong.map((w) => [w, false] as const),
    ]) {
      const run = await runOfficeToPdf(
        "excel-to-pdf",
        c.build(),
        c.name,
        { libreoffice: deps.libreoffice },
        undefined,
        undefined,
        choice,
      );
      const how = `${label}, ${describeChoice(choice)}`;
      if (!run.ok) {
        fail(`${how}: the engine answered ${run.kind}: ${run.message}`);
        continue;
      }
      const text = await deps.extract(run.output);
      const read = c.reads(text.text);
      if (read === expected)
        pass(
          expected
            ? `${how}: ${c.want}`
            : `${how}: CONTROL, comes out wrong as it must`,
        );
      else
        fail(
          expected
            ? `${how}: not ${c.want} (${text.characterCount} characters read)`
            : `${how}: CONTROL read right with the wrong choice, so the check cannot fail`,
        );
    }
  }
  // CSV default import: Auto prints what no options printed. See the header.
  const defaultKinds = new Set(deps.csvDefaults.map((c) => c.encoding));
  for (const needed of ["ascii", "utf-8"] as const)
    if (!defaultKinds.has(needed))
      fail(
        `the csv default import cases hold no ${needed} file; the proof needs one of each`,
      );
  for (const c of deps.csvDefaults) {
    const label = `csv default import ${c.name} (${c.encoding})`;
    const bytes = c.build();
    let baseline: ExtractedPdfText;
    try {
      baseline = await deps.extract(
        await deps.libreofficeNoOptions.convertToPdf(bytes, c.name),
      );
    } catch (error) {
      fail(
        `${label}: with no options LibreOffice made no PDF (${(error as Error).message})`,
      );
      continue;
    }
    const baseWords = asciiWords(baseline.text);
    const missing = c.marks.filter((m) => !baseWords.includes(m));
    if (c.marks.length === 0 || missing.length > 0) {
      fail(
        `${label}: the no-options text lacks ${missing.join(", ") || "any mark"}, so the comparison proves nothing`,
      );
      continue;
    }
    const run = await runOfficeToPdf("excel-to-pdf", bytes, c.name, {
      libreoffice: deps.libreoffice,
    });
    if (!run.ok) {
      fail(`${label}: the engine answered ${run.kind}: ${run.message}`);
      continue;
    }
    const auto = await deps.extract(run.output);
    if (c.encoding === "utf-8" && !(c.word && auto.text.includes(c.word))) {
      fail(
        `${label}: "${c.word ?? ""}" is not in its text, so it was not read as UTF-8`,
      );
      continue;
    }
    const autoWords = asciiWords(auto.text);
    const at = autoWords.findIndex((w, i) => w !== baseWords[i]);
    if (at < 0 && autoWords.length === baseWords.length)
      pass(`${label}: prints what no options printed (${c.marks.join(" ")})`);
    else {
      const i = at < 0 ? Math.min(autoWords.length, baseWords.length) : at;
      fail(
        `${label}: prints "${autoWords[i] ?? "(nothing)"}" where no options printed "${baseWords[i] ?? "(nothing)"}"`,
      );
    }
  }
  // The file name in a CSV's header. See the header of this file.
  if (!deps.csvFileNames.some((c) => c.control))
    fail("the csv file-name cases hold no control; the proof needs one");
  if (
    !deps.csvFileNames.some(
      (c) => !c.control && [...c.stem].some((ch) => ch.codePointAt(0)! > 0x24f),
    )
  )
    fail("the csv file-name cases hold no non-Latin stem; the proof needs one");
  for (const c of deps.csvFileNames) {
    const label = `csv file name ${c.label}`;
    const bytes = c.build();
    const body = new TextDecoder().decode(bytes).toLowerCase();
    if (body.includes(c.stem.toLowerCase()) || body.includes(OLD_INPUT_STEM)) {
      fail(
        `${label}: its own cells hold the stem or "input", so the header check proves nothing`,
      );
      continue;
    }
    const run = await runOfficeToPdf("excel-to-pdf", bytes, c.name, {
      libreoffice: deps.libreoffice,
    });
    if (!run.ok) {
      fail(`${label}: the engine answered ${run.kind}: ${run.message}`);
      continue;
    }
    const text = await deps.extract(run.output);
    const v = fileNameHeaderVerdict(text.text, c.stem);
    const top = JSON.stringify(text.text.trim().split(/\r?\n/)[0] ?? "");
    if (c.control) {
      if (v.showsInput)
        pass(`${label}: CONTROL, "input" printed, so the header is read`);
      else
        fail(
          `${label}: CONTROL, "input" is not in its text, so no header was read and "never input" proves nothing (first line ${top})`,
        );
    } else if (!v.shows) {
      fail(`${label}: its stem is not in its text (first line ${top})`);
    } else if (v.showsInput) {
      fail(
        `${label}: its stem is printed, and so is "input" (first line ${top})`,
      );
    } else {
      pass(`${label}: its stem printed, "input" nowhere`);
    }
  }
  return { ok, lines };
}
