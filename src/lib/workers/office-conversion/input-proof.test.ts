// @vitest-environment node
/**
 * The OpenDocument / RTF proof's verdict, held to stand-ins that break each
 * property it claims to check — and its fixtures held to the recogniser and
 * the content check, so the files CI's LibreOffice converts are the files the
 * engine is meant to take.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { formatOfName } from "@/lib/intent/formats";
import { sniffFormat, zipMimetype } from "@/lib/intent/sniff";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { getToolBySlug } from "@/lib/tools";
import {
  OFFICE_INPUT_FIXTURES,
  odsWith,
  odtWith,
} from "@/tests/office-input-fixtures";
import { lockedOdfFixtures } from "@/tests/locked-odf";
import {
  CSV_CHARSET_CASES,
  CSV_CHOICE_CASES,
  CSV_DEFAULT_CASES,
  CSV_FILE_NAME_CASES,
} from "@/tests/csv-charset-fixtures";
import { sanitizeInputStem } from "./input-name";
import type { CsvCharset, CsvDelimiter, CsvImportChoice } from "./csv-import";
import type { LibreOfficePdfRunner } from "./engine";
import { LibreOfficeRunError } from "./errors";
import { officeContentRefusal, SIGNED_OFFICE_INPUTS } from "./input-content";
import {
  fileNameHeaderVerdict,
  fileNameSpecOk,
  runOfficeInputProof,
  type CsvFileNameCase,
  type OfficeInputProofDeps,
} from "./input-proof";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The words a reader of the file would see: content.xml's text, or the RTF's. */
const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);
/** A CSV read the way the worker reads it since 2026-11-07. */
function csvText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return latin1(bytes);
  }
}
const isCsv = (bytes: Uint8Array) => bytes[0] !== 0x50 && bytes[0] !== 0x7b;

async function wordsIn(bytes: Uint8Array): Promise<string> {
  if (isCsv(bytes)) return csvText(bytes);
  if (bytes[0] === 0x7b) return dec.decode(bytes).replace(/\\[a-z0-9]+ ?/g, "");
  const zip = await JSZip.loadAsync(bytes);
  const xml = (await zip.file("content.xml")?.async("string")) ?? "";
  return xml.replace(/<[^>]+>/g, " ");
}

/** A PDF-shaped envelope (`looksLikePdf` wants 32 bytes) around `text`. */
const HEAD = `%PDF-1.7\n%${"-".repeat(32)}\n`;
const TAIL = "\n%%EOF\n";
const pdfOf = (text: string) => enc.encode(`${HEAD}${text}${TAIL}`);

/** Is the package locked? Read by JSZip, not by the engine's own detector. */
async function lockedByJsZip(bytes: Uint8Array): Promise<boolean> {
  if (bytes[0] !== 0x50) return false;
  const zip = await JSZip.loadAsync(bytes);
  const manifest = await zip.file("META-INF/manifest.xml")?.async("string");
  return manifest?.includes("encryption-data") ?? false;
}

/**
 * A stand-in LibreOffice that lays out exactly the words in the file — and,
 * like the image's (PROVENANCE.txt), makes no PDF of a locked one.
 */
const honestWith = (
  /** The stem the runner writes the upload under; null prints no header. */
  headerStem: ((name: string) => string) | null,
): LibreOfficePdfRunner => ({
  convertToPdf: async (input, name, _run, _layout, csv) => {
    if (await lockedByJsZip(input)) throw new LibreOfficeRunError("no_output");
    // A CSV's sheet is named after the file LibreOffice opened, and Calc
    // prints the sheet name as the page header (production, 2026-11-17).
    if (isCsv(input))
      return pdfOf(
        `${headerStem ? `${headerStem(name)}\n` : ""}${readCsv(input, csv)}`,
      );
    return pdfOf(await wordsIn(input));
  },
});
/** The runner since 2026-11-17: the user's own stem. */
const honest = honestWith(sanitizeInputStem);

/**
 * A CSV read as a LibreOffice honouring the choice would read it, by an
 * independent decoder (the platform's TextDecoder, not the worker's sniff):
 * the chosen character set or, on Auto, UTF-16 by its mark, UTF-8, or
 * Latin-1; the chosen delimiter or, on Auto, the first of tab, semicolon and
 * pipe on line 1, else a comma. Cells are joined with a space.
 */
const DECODER_LABELS: Record<CsvCharset, string> = {
  "utf-8": "utf-8",
  "windows-1252": "windows-1252",
  "iso-8859-2": "iso-8859-2",
  "windows-1251": "windows-1251",
  "shift-jis": "shift_jis",
  "utf-16": "utf-16le",
};
const SEPARATORS: Record<CsvDelimiter, string> = {
  comma: ",",
  semicolon: ";",
  tab: String.fromCharCode(9),
  pipe: "|",
};
function readCsv(bytes: Uint8Array, csv?: CsvImportChoice): string {
  const text = csv?.charset
    ? new TextDecoder(DECODER_LABELS[csv.charset]).decode(bytes)
    : bytes[0] === 0xff && bytes[1] === 0xfe
      ? new TextDecoder("utf-16le").decode(bytes)
      : csvText(bytes);
  const lines = text.split(/\r?\n/);
  const sep = csv?.delimiter
    ? SEPARATORS[csv.delimiter]
    : ([SEPARATORS.tab, ";", "|"].find((c) => lines[0]?.includes(c)) ?? ",");
  return lines.map((line) => line.split(sep).join(" ")).join(" / ");
}

/** A stand-in pdftotext for {@link pdfOf}'s PDFs. */
async function extract(pdf: Uint8Array): Promise<ExtractedPdfText> {
  const all = dec.decode(pdf);
  const text = all.slice(HEAD.length, all.length - TAIL.length);
  return {
    pageCount: 1,
    pages: [],
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

async function deps(
  over: Partial<OfficeInputProofDeps> = {},
): Promise<OfficeInputProofDeps> {
  return {
    libreoffice: honest,
    extract,
    fixtures: OFFICE_INPUT_FIXTURES,
    spreadsheetBytes: await odsWith("Renamed"),
    ...lockedOdfFixtures(),
    csv: CSV_CHARSET_CASES,
    csvChoices: CSV_CHOICE_CASES,
    libreofficeNoOptions: honest,
    csvDefaults: CSV_DEFAULT_CASES,
    csvFileNames: CSV_FILE_NAME_CASES,
    ...over,
  };
}

describe("the fixtures are the files the engine is meant to take", () => {
  it("one per checked format, derived from the content check's own table", () => {
    expect(OFFICE_INPUT_FIXTURES.map((f) => f.kind).sort()).toEqual(
      Object.keys(SIGNED_OFFICE_INPUTS).sort(),
    );
  });

  it.each(OFFICE_INPUT_FIXTURES.map((f) => [f.kind, f] as const))(
    "%s: its tool takes it, its bytes name it, and the content check passes it",
    async (kind, fixture) => {
      const bytes = await fixture.build();
      expect(getToolBySlug(fixture.tool)!.accept).toContain(kind.toUpperCase());
      expect(formatOfName(fixture.name)).toBe(kind.toUpperCase());
      expect(sniffFormat(bytes)).toBe(kind.toUpperCase());
      expect(officeContentRefusal(kind, bytes)).toBeNull();
      if (kind !== "rtf") expect(zipMimetype(bytes)).toBe(fixture.type);
      expect(await wordsIn(bytes)).toContain(fixture.word);
    },
  );

  it("no fixture's word is inside another's", () => {
    const words = OFFICE_INPUT_FIXTURES.map((f) => f.word);
    expect(new Set(words).size).toBe(words.length);
    for (const a of words)
      for (const b of words)
        if (a !== b) expect(a.toLowerCase()).not.toContain(b.toLowerCase());
  });
});

describe("the proof's verdict", () => {
  it("passes an honest converter, every fixture, both controls, the locked files and their twin", async () => {
    const result = await runOfficeInputProof(await deps());
    expect(result.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(result.ok).toBe(true);
    const { locked } = lockedOdfFixtures();
    expect(result.lines.filter((l) => l.startsWith("ok"))).toHaveLength(
      OFFICE_INPUT_FIXTURES.length +
        2 +
        locked.length +
        1 +
        CSV_CHARSET_CASES.length +
        // One line per CSV choice run, right and wrong (audit #18).
        CSV_CHOICE_CASES.reduce(
          (n, c) => n + c.right.length + c.wrong.length,
          0,
        ) +
        // One line per default-import comparison (review 2026-11-17).
        CSV_DEFAULT_CASES.length +
        // One line per file-name header case, the control included.
        CSV_FILE_NAME_CASES.length,
    );
  });

  it("fails a converter that loses the text", async () => {
    const blank: LibreOfficePdfRunner = {
      convertToPdf: async () => pdfOf(""),
    };
    const result = await runOfficeInputProof(
      await deps({ libreoffice: blank }),
    );
    expect(result.ok).toBe(false);
    expect(
      result.lines.filter((l) => /is not in its text/.test(l)),
      // Every fixture, the locked files' unlocked twin, every CSV, the
      // UTF-8 default-import case's word, and every file-name header case
      // (a stem, or the control's "input").
    ).toHaveLength(
      OFFICE_INPUT_FIXTURES.length +
        1 +
        CSV_CHARSET_CASES.length +
        CSV_DEFAULT_CASES.filter((c) => c.encoding === "utf-8").length +
        CSV_FILE_NAME_CASES.length,
    );
  });

  it("fails a converter that answers every file with the same PDF", async () => {
    const all = OFFICE_INPUT_FIXTURES.map((f) => f.word).join(" ");
    const same: LibreOfficePdfRunner = {
      convertToPdf: async () => pdfOf(all),
    };
    const result = await runOfficeInputProof(await deps({ libreoffice: same }));
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => /also carries/.test(l))).toBe(true);
  });

  it("fails a PDF with no pages", async () => {
    const result = await runOfficeInputProof(
      await deps({
        extract: async (pdf) => ({ ...(await extract(pdf)), pageCount: 0 }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => /has no pages/.test(l))).toBe(true);
  });

  it("fails when the renamed-file control is not refused", async () => {
    // A genuine .odt as the "spreadsheet named .odt": the engine converts it,
    // so the control must report it.
    const result = await runOfficeInputProof(
      await deps({ spreadsheetBytes: await odtWith("Genuine") }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.filter((l) => l.startsWith("FAIL")).join("\n")).toMatch(
      /spreadsheet named \.odt: answered ok/,
    );
  });

  it("fails a run with too few fixtures (a shrunken corpus is not a pass)", async () => {
    const result = await runOfficeInputProof(
      await deps({ fixtures: OFFICE_INPUT_FIXTURES.slice(0, 2) }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/only 2 fixtures/);
  });

  it("fails a LibreOffice that converts a locked file without its password", async () => {
    // Then the refusal would turn away a file the image can convert.
    const opens: LibreOfficePdfRunner = {
      convertToPdf: async (input) => pdfOf(await wordsIn(input)),
    };
    const result = await runOfficeInputProof(
      await deps({ libreoffice: opens }),
    );
    expect(result.ok).toBe(false);
    expect(
      result.lines.filter((l) => /converted it without its password/.test(l)),
    ).toHaveLength(lockedOdfFixtures().locked.length);
  });

  it("fails when a 'locked' file is not named password-protected", async () => {
    const { locked, lockedTwin } = lockedOdfFixtures();
    const result = await runOfficeInputProof(
      await deps({
        locked: [
          { ...locked[0]!, bytes: lockedTwin.bytes },
          ...locked.slice(1),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.filter((l) => l.startsWith("FAIL")).join("\n")).toMatch(
      /locked, word-to-pdf \(locked\.odt\): answered ok, not password_protected/,
    );
  });

  it("fails a run with no locked file for a tool (derived from the engine's own table)", async () => {
    const { locked } = lockedOdfFixtures();
    const result = await runOfficeInputProof(
      await deps({
        locked: locked.filter((l) => l.tool !== "powerpoint-to-pdf"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.filter((l) => l.startsWith("FAIL"))).toContain(
      "FAIL  locked: no locked file for powerpoint-to-pdf",
    );
  });

  it("fails when the unlocked twin does not carry its word", async () => {
    const { lockedTwin } = lockedOdfFixtures();
    const result = await runOfficeInputProof(
      await deps({ lockedTwin: { ...lockedTwin, word: "NOTINIT" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines.filter((l) => l.startsWith("FAIL")).join("\n")).toMatch(
      /locked twin, open\.odt: converted, but "NOTINIT" is not in its text/,
    );
  });
});

describe("the CSV character-set cases", () => {
  const csvFails = (lines: readonly string[]) =>
    lines.filter(
      (l) =>
        l.startsWith("FAIL  csv ") &&
        !l.startsWith("FAIL  csv choice ") &&
        !l.startsWith("FAIL  csv default import ") &&
        !l.startsWith("FAIL  csv file name "),
    );
  const nameOf = (line: string) => /FAIL {2}csv (\S+)/.exec(line)?.[1];
  const reading = (
    decode: (b: Uint8Array) => string,
  ): LibreOfficePdfRunner => ({
    convertToPdf: async (input) =>
      isCsv(input) ? pdfOf(decode(input)) : honest.convertToPdf(input, ""),
  });

  it("fails a converter that reads every CSV in the Western default (production, 2026-11-07)", async () => {
    const result = await runOfficeInputProof(
      await deps({ libreoffice: reading(latin1) }),
    );
    expect(result.ok).toBe(false);
    expect(csvFails(result.lines).map(nameOf)).toEqual([
      "towns.csv",
      "cheeses.csv",
    ]);
  });

  it("fails a converter that forces UTF-8 on every CSV (the fix that breaks Windows-1252)", async () => {
    const result = await runOfficeInputProof(
      await deps({ libreoffice: reading((b) => new TextDecoder().decode(b)) }),
    );
    expect(result.ok).toBe(false);
    expect(csvFails(result.lines).map(nameOf)).toEqual(["names.csv"]);
  });

  it("fails a run with no Windows-1252 case, and a case whose word is plain ASCII", async () => {
    const result = await runOfficeInputProof(
      await deps({
        csv: [
          CSV_CHARSET_CASES[0]!,
          { ...CSV_CHARSET_CASES[0]!, name: "plain.csv", word: "Town" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    const fails = result.lines.filter((l) => l.startsWith("FAIL"));
    expect(fails).toContain(
      "FAIL  the CSV cases hold no windows-1252 file; the proof needs one of each",
    );
    expect(fails).toContain(
      'FAIL  csv plain.csv (utf-8): its word "Town" is plain ASCII, so it proves nothing',
    );
  });
});

describe("the CSV choice cases (competitor audit #18)", () => {
  const fails = (lines: readonly string[]) =>
    lines.filter((l) => l.startsWith("FAIL  csv choice "));
  const labelOf = (line: string) => /FAIL {2}csv choice (\S+)/.exec(line)?.[1];

  it("health: an honest converter passes every case, right and wrong, and the lines say so", async () => {
    const result = await runOfficeInputProof(await deps());
    expect(result.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(result.ok).toBe(true);
    const runs = CSV_CHOICE_CASES.reduce(
      (n, c) => n + c.right.length + c.wrong.length,
      0,
    );
    const choiceLines = result.lines.filter((l) => l.includes("csv choice "));
    expect(choiceLines).toHaveLength(runs);
    expect(
      choiceLines.filter((l) => l.includes("CONTROL, comes out wrong")).length,
    ).toBe(CSV_CHOICE_CASES.reduce((n, c) => n + c.wrong.length, 0));
  });

  it("the fixtures hold the two required cases and one per choice the selects offer", () => {
    const labels = CSV_CHOICE_CASES.map((c) => c.label).sort();
    expect(labels).toEqual(
      [
        "pipe",
        "semicolon",
        "tab",
        "windows-1251",
        "iso-8859-2",
        "shift-jis",
        "utf-16",
        "utf-16-bom",
      ].sort(),
    );
  });

  it("fails an image built before the feature: every choice ignored, every CSV comma separated", async () => {
    const old: LibreOfficePdfRunner = {
      convertToPdf: async (input) =>
        isCsv(input)
          ? pdfOf(readCsv(input, { delimiter: "comma", charset: null }))
          : honest.convertToPdf(input, ""),
    };
    const result = await runOfficeInputProof(await deps({ libreoffice: old }));
    expect(result.ok).toBe(false);
    const failed = new Set(fails(result.lines).map(labelOf));
    for (const label of [
      "semicolon",
      "pipe",
      "tab",
      "windows-1251",
      "iso-8859-2",
      "shift-jis",
    ])
      expect(failed.has(label), label).toBe(true);
  });

  it("fails a run without a required case", async () => {
    const result = await runOfficeInputProof(
      await deps({
        csvChoices: CSV_CHOICE_CASES.filter((c) => c.label !== "windows-1251"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines).toContain(
      'FAIL  the CSV choice cases hold no "windows-1251" case; the run needs it',
    );
  });

  it("fails a judge that passes an empty page, and a control that reads right", async () => {
    const semicolon = CSV_CHOICE_CASES.find((c) => c.label === "semicolon")!;
    const blind = { ...semicolon, label: "blind", reads: () => true };
    const lax = {
      ...semicolon,
      label: "lax",
      reads: (t: string) => t.includes("North"),
    };
    const result = await runOfficeInputProof(
      await deps({ csvChoices: [...CSV_CHOICE_CASES, blind, lax] }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines).toContain(
      "FAIL  csv choice blind (regions.csv): its judge passes an empty page, so it proves nothing",
    );
    expect(
      fails(result.lines).filter((l) => l.includes("CONTROL read right")),
    ).toHaveLength(semicolon.wrong.length);
  });
});

describe("the CSV default import: Auto prints what no options printed (review 2026-11-17)", () => {
  const fails = (lines: readonly string[]) =>
    lines.filter((l) => l.startsWith("FAIL  csv default import "));
  /**
   * LibreOffice with "detect special numbers" on, which is what a filter
   * token that stops after token 4 gave in the image: a date and a fraction
   * rewritten as dd/mm/yy, a percentage with two decimals.
   */
  const detecting: LibreOfficePdfRunner = {
    convertToPdf: async (input, name, run, layout, csv) => {
      const pdf = await honest.convertToPdf(input, name, run, layout, csv);
      if (!isCsv(input)) return pdf;
      const text = (await extract(pdf)).text;
      return pdfOf(
        text
          .replace(/\b1\/2\/2026\b/g, "01/02/26")
          .replace(/(^|\s)(\d)\/(\d)(?=\s|$)/g, "$1$2/$3/26")
          .replace(/(\d+)%/g, "$1.00%"),
      );
    },
  };

  it("health: an honest converter passes both cases, and the lines say so", async () => {
    const result = await runOfficeInputProof(await deps());
    expect(fails(result.lines)).toEqual([]);
    expect(
      result.lines.filter((l) => l.startsWith("ok    csv default import ")),
    ).toHaveLength(CSV_DEFAULT_CASES.length);
    expect(CSV_DEFAULT_CASES.map((c) => c.encoding).sort()).toEqual([
      "ascii",
      "utf-8",
    ]);
  });

  it("fails an import that detects special numbers (the 4-token filter, measured in the image)", async () => {
    const result = await runOfficeInputProof(
      await deps({ libreoffice: detecting }),
    );
    expect(result.ok).toBe(false);
    expect(fails(result.lines)).toEqual([
      'FAIL  csv default import ledger.csv (ascii): prints "01/02/26" where no options printed "1/2/2026"',
      'FAIL  csv default import visits.csv (utf-8): prints "01/02/26" where no options printed "1/2/2026"',
    ]);
  });

  it("fails a blank no-options baseline instead of calling two blanks the same", async () => {
    const blank: LibreOfficePdfRunner = {
      convertToPdf: async () => pdfOf(""),
    };
    const result = await runOfficeInputProof(
      await deps({ libreoffice: blank, libreofficeNoOptions: blank }),
    );
    expect(fails(result.lines)).toEqual(
      CSV_DEFAULT_CASES.map(
        (c) =>
          `FAIL  csv default import ${c.name} (${c.encoding}): the no-options text lacks ${c.marks.join(", ")}, so the comparison proves nothing`,
      ),
    );
  });

  it("fails a UTF-8 case the Auto import did not read as UTF-8", async () => {
    const western: LibreOfficePdfRunner = {
      convertToPdf: async (input, name) =>
        isCsv(input) ? pdfOf(latin1(input)) : honest.convertToPdf(input, name),
    };
    const result = await runOfficeInputProof(
      await deps({ libreoffice: western }),
    );
    expect(fails(result.lines)).toContain(
      `FAIL  csv default import visits.csv (utf-8): "${CSV_DEFAULT_CASES[1]!.word}" is not in its text, so it was not read as UTF-8`,
    );
  });

  it("fails a run without one of the two kinds", async () => {
    const result = await runOfficeInputProof(
      await deps({
        csvDefaults: CSV_DEFAULT_CASES.filter((c) => c.encoding === "ascii"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.lines).toContain(
      "FAIL  the csv default import cases hold no utf-8 file; the proof needs one of each",
    );
  });
});

describe("the file name in a CSV's header (production, 2026-11-17)", () => {
  const lines = (all: readonly string[], prefix: string) =>
    all.filter((l) => l.startsWith(`${prefix}  csv file name `));
  const nonLatin = CSV_FILE_NAME_CASES.filter((c) => !c.control);

  it("health: the cases hold a control and three non-Latin stems, and an honest converter passes them all", async () => {
    expect(CSV_FILE_NAME_CASES.filter((c) => c.control)).toHaveLength(1);
    expect(nonLatin.map((c) => c.label)).toEqual([
      "Cyrillic stem",
      "Bengali stem",
      "CJK stem",
    ]);
    for (const c of nonLatin) {
      expect(sanitizeInputStem(c.name)).toBe(c.stem);
      expect([...c.stem].every((ch) => ch.codePointAt(0)! > 0x24f)).toBe(true);
    }
    const result = await runOfficeInputProof(await deps());
    expect(lines(result.lines, "FAIL")).toEqual([]);
    expect(lines(result.lines, "ok  ")).toHaveLength(
      CSV_FILE_NAME_CASES.length,
    );
    expect(result.ok).toBe(true);
  });

  it("fails the runner as it was: every upload written as input.<ext>", async () => {
    const result = await runOfficeInputProof(
      await deps({ libreoffice: honestWith(() => "input") }),
    );
    expect(result.ok).toBe(false);
    expect(lines(result.lines, "FAIL")).toEqual(
      nonLatin.map((c) =>
        expect.stringContaining(
          `FAIL  csv file name ${c.label}: its stem is not in its text`,
        ),
      ),
    );
    // The control still passes: "input" IS printed, and read.
    expect(lines(result.lines, "ok  ")).toEqual([
      'ok    csv file name control, a file the user named input.csv: CONTROL, "input" printed, so the header is read',
    ]);
  });

  it("fails a header that prints the stem AND input", async () => {
    const result = await runOfficeInputProof(
      await deps({
        libreoffice: honestWith((n) => `${sanitizeInputStem(n)} input`),
      }),
    );
    expect(lines(result.lines, "FAIL")).toHaveLength(nonLatin.length);
    expect(lines(result.lines, "FAIL")[0]).toContain(
      'its stem is printed, and so is "input"',
    );
  });

  it("CONTROL: with no header printed at all, the control fails (the check is not blind)", async () => {
    const result = await runOfficeInputProof(
      await deps({ libreoffice: honestWith(null) }),
    );
    expect(lines(result.lines, "FAIL")).toContainEqual(
      expect.stringContaining('CONTROL, "input" is not in its text'),
    );
  });

  it("fails a run without a control or without a non-Latin stem", async () => {
    const noControl = await runOfficeInputProof(
      await deps({ csvFileNames: nonLatin }),
    );
    expect(noControl.lines).toContain(
      "FAIL  the csv file-name cases hold no control; the proof needs one",
    );
    const latinOnly: CsvFileNameCase[] = [
      { ...nonLatin[0]!, label: "latin", name: "towns.csv", stem: "towns" },
      CSV_FILE_NAME_CASES.find((c) => c.control)!,
    ];
    const latin = await runOfficeInputProof(
      await deps({ csvFileNames: latinOnly }),
    );
    expect(latin.lines).toContain(
      "FAIL  the csv file-name cases hold no non-Latin stem; the proof needs one",
    );
  });

  it("fails a case whose own cells hold the stem or the word input", async () => {
    const result = await runOfficeInputProof(
      await deps({
        csvFileNames: [
          ...CSV_FILE_NAME_CASES,
          {
            label: "vacuous",
            name: `${nonLatin[0]!.stem}.csv`,
            stem: nonLatin[0]!.stem,
            build: () =>
              enc.encode(`Region,input\nNorth,${nonLatin[0]!.stem}\n`),
          },
        ],
      }),
    );
    expect(lines(result.lines, "FAIL")).toEqual([
      'FAIL  csv file name vacuous: its own cells hold the stem or "input", so the header check proves nothing',
    ]);
  });

  it("the verdict reads through line breaks and decomposed text", () => {
    const stem = nonLatin[1]!.stem;
    const split = `${[...stem].slice(0, 2).join("")}\n ${[...stem].slice(2).join("")}`;
    expect(fileNameHeaderVerdict(split, stem)).toEqual({
      shows: true,
      showsInput: false,
    });
    expect(fileNameHeaderVerdict("In put\nrows", "rows")).toEqual({
      shows: true,
      showsInput: true,
    });
    // E + combining diaeresis, which NFC composes to YO.
    const nfd = String.fromCodePoint(0x415, 0x308);
    expect(fileNameHeaderVerdict(nfd, String.fromCodePoint(0x401)).shows).toBe(
      true,
    );
  });

  it("the deployment spec's verdict needs the stem AND no input (review 2026-11-18)", () => {
    // The stem the deployment proof uploads, so this is its case, not a lookalike.
    const { stem } = CSV_FILE_NAME_CASES.find(
      (c) => c.label === "Cyrillic stem",
    )!;
    expect(fileNameSpecOk(`${stem}\nrows`, stem)).toBe(true);
    // Each half alone is not enough.
    expect(fileNameSpecOk(`${stem} input\nrows`, stem)).toBe(false);
    expect(fileNameSpecOk(`${stem}\nIn put rows`, stem)).toBe(false);
    expect(fileNameSpecOk("input\nrows", stem)).toBe(false);
    expect(fileNameSpecOk("rows", stem)).toBe(false);
  });
});
