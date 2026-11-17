// @vitest-environment node
/**
 * The name the upload is written under before LibreOffice reads it
 * (`./input-name`), and the runner that uses it (`./native`).
 *
 * Found in production 2026-11-17 by a real Excel to PDF job: every upload was
 * written as `input.<ext>`, LibreOffice named a CSV's sheet after that stem,
 * and Calc's default page style printed the sheet name as the page header,
 * so the PDF a user downloaded said "input" across the top of every page.
 *
 * What is held here:
 *  - the sanitizer over a hostile corpus, by ONE predicate, with a positive
 *    control (the same predicate rejects the raw names) and a health check
 *    on the corpus itself;
 *  - Bengali, Cyrillic and CJK stems survive exactly (strings built from
 *    code points, so no editor or shell can change them);
 *  - the extension is the old rule, character for character;
 *  - the runner writes only inside its temp dir, hands LibreOffice the file
 *    it wrote, and reads back the file a stand-in LibreOffice writes by
 *    LibreOffice's own naming rule, so a name the runner derives differently
 *    is a failed conversion here, not in production.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  INPUT_NAME_FALLBACK_STEM,
  INPUT_STEM_MAX_BYTES,
  INPUT_STEM_MAX_CODE_POINTS,
  officeInputExtension,
  officeInputName,
  officeOutputName,
  sanitizeInputStem,
} from "./input-name";
import {
  createNativeLibreOfficePdfRunner,
  libreOfficeEnv,
  type LibreOfficeExec,
  type LibreOfficeFs,
} from "./native";
import type { NativeOfficeConversionConfig } from "./native-config";

const cp = (...points: number[]) => String.fromCodePoint(...points);

// "Report" in three scripts, from code points.
const BENGALI = cp(0x09b0, 0x09bf, 0x09aa, 0x09cb, 0x09b0, 0x09cd, 0x099f);
const CYRILLIC = cp(0x041e, 0x0442, 0x0447, 0x0451, 0x0442);
const CJK = cp(0x5831, 0x544a, 0x66f8);
/** A CJK Extension B letter: one code point, two UTF-16 units, four bytes. */
const CJK_EXT_B = cp(0x20000);

const utf8 = (s: string) => new TextEncoder().encode(s).byteLength;

/** The old `safeInputName`, verbatim, as the reference for the extension. */
function oldSafeInputName(filename: string): string {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).replace(/[^a-zA-Z0-9.]/g, "")
    : ".docx";
  return `input${ext || ".docx"}`;
}

/**
 * THE predicate: what every stem the runner writes must satisfy. WAS a first
 * character of `[\p{L}\p{M}\p{N}_]` and no check for invisible characters,
 * so a stem made of the Hangul filler U+3164 (a letter that draws nothing) or
 * one opening on a bare combining mark passed (review 2026-11-18).
 */
const STEM_SHAPE = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N} _-]*$/u;
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const RESERVED =
  /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;
function stemProblems(stem: string): string[] {
  const out: string[] = [];
  if (!STEM_SHAPE.test(stem)) out.push("shape");
  if (INVISIBLE.test(stem)) out.push("invisible");
  if (stem !== stem.trimEnd()) out.push("trailing space");
  if (/ {2}/.test(stem)) out.push("double space");
  if ([...stem].length > INPUT_STEM_MAX_CODE_POINTS) out.push("code points");
  if (utf8(stem) > INPUT_STEM_MAX_BYTES) out.push("bytes");
  if (/[\uD800-\uDFFF]/u.test(stem)) out.push("lone surrogate");
  if (RESERVED.test(stem)) out.push("reserved");
  return out;
}

/** The stem as the user wrote it: the part of the last segment before its last dot. */
function rawStem(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(0, dot) : base;
}

/** Hostile names; `raw` marks those whose own stem the predicate must reject. */
const HOSTILE: readonly { name: string; raw: boolean }[] = [
  { name: "../../etc/passwd", raw: false },
  { name: "../../../x.csv", raw: false },
  { name: "..", raw: true },
  { name: ".", raw: true },
  { name: "", raw: true },
  { name: ".hidden.csv", raw: true },
  { name: `a${cp(0)}b.csv`, raw: true },
  { name: `${cp(0x202e)}vsc.exe.csv`, raw: true },
  { name: `${cp(0xfeff)}bom.csv`, raw: true },
  { name: `${cp(0xd800)}x.csv`, raw: true },
  { name: `${"a".repeat(1000)}.csv`, raw: true },
  { name: `${CJK_EXT_B.repeat(100)}.csv`, raw: true },
  { name: `${BENGALI.repeat(40)}.csv`, raw: true },
  { name: "!!!@@@###.csv", raw: true },
  { name: "-rf.csv", raw: true },
  { name: "--version", raw: true },
  { name: "CON.csv", raw: true },
  { name: "nul", raw: true },
  { name: "com1.xlsx", raw: true },
  { name: `lpt${cp(0xb9)}.docx`, raw: true },
  { name: "%2e%2e%2fx.csv", raw: true },
  { name: "#frag.csv", raw: true },
  { name: `a${cp(0x200d)}b${cp(0x200c)}c.csv`, raw: true },
  { name: 'a?b*c:d|e<f>g"h.csv', raw: true },
  { name: "C:\\Users\\x\\file.csv", raw: false },
  { name: "  spaced   out  .csv", raw: true },
  { name: "a\tb\nc.csv", raw: true },
  { name: `${cp(0x1f600)}report.csv`, raw: true },
  { name: "it's [draft] (v2).docx", raw: true },
  { name: "x.", raw: false },
  { name: "x..", raw: true },
  // Invisible letters and marks (review 2026-11-18): each drew a blank header.
  { name: `${cp(0x3164)}.csv`, raw: true },
  { name: `${cp(0x115f)}.csv`, raw: true },
  { name: `${cp(0xffa0)}${cp(0x1160)}.csv`, raw: true },
  { name: `${cp(0xfe0f)}.csv`, raw: true },
  { name: `${cp(0x034f)}.csv`, raw: true },
  { name: `${cp(0x0301)}x.csv`, raw: true },
  { name: `-${cp(0x0301)}x.csv`, raw: true },
];

describe("sanitizeInputStem over a hostile corpus", () => {
  it("health: the corpus is plausibly sized, and the predicate is not blind", () => {
    expect(HOSTILE.length).toBeGreaterThanOrEqual(25);
    // POSITIVE CONTROL: the predicate rejects the raw stems it must. A
    // predicate that passed everything would pass every sanitized stem too.
    const rejected = HOSTILE.filter((h) => h.raw).filter(
      (h) => stemProblems(rawStem(h.name)).length === 0,
    );
    expect(rejected.map((h) => JSON.stringify(h.name))).toEqual([]);
    // And it accepts what it must: a negative control.
    for (const ok of ["report", BENGALI, CYRILLIC, CJK, "Q3 report_v2-final"])
      expect(stemProblems(ok)).toEqual([]);
  });

  it("every sanitized stem passes the predicate, and the name stays in the dir", () => {
    const dir = path.join(path.sep, "tmp", "pdfxyz-office-1");
    const bad: string[] = [];
    for (const { name } of HOSTILE) {
      const stem = sanitizeInputStem(name);
      const problems = stemProblems(stem);
      if (problems.length)
        bad.push(
          `${JSON.stringify(name)} -> ${JSON.stringify(stem)}: ${problems}`,
        );
      const inputName = officeInputName(name);
      for (const file of [inputName, officeOutputName(inputName)]) {
        const full = path.join(dir, file);
        if (path.dirname(full) !== dir || path.basename(full) !== file)
          bad.push(
            `${JSON.stringify(name)} -> ${JSON.stringify(file)} leaves the dir`,
          );
        if (/[\0/\\]/.test(file))
          bad.push(`${JSON.stringify(file)} has a separator`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("each hostile shape comes out as written here", () => {
    const want: Record<string, string> = {
      "../../etc/passwd": "passwd",
      "..": INPUT_NAME_FALLBACK_STEM,
      "": INPUT_NAME_FALLBACK_STEM,
      ".hidden.csv": "hidden",
      [`a${cp(0)}b.csv`]: "a b",
      [`${cp(0x202e)}vsc.exe.csv`]: "vsc exe",
      [`${cp(0xfeff)}bom.csv`]: "bom",
      [`${cp(0xd800)}x.csv`]: "x",
      "!!!@@@###.csv": INPUT_NAME_FALLBACK_STEM,
      "-rf.csv": "rf",
      "--version": "version",
      "CON.csv": "CON_",
      nul: "nul_",
      "com1.xlsx": "com1_",
      [`lpt${cp(0xb9)}.docx`]: `lpt${cp(0xb9)}_`,
      "%2e%2e%2fx.csv": "2e 2e 2fx",
      "#frag.csv": "frag",
      // A zero-width joiner inside a word is dropped, not made a space.
      [`a${cp(0x200d)}b${cp(0x200c)}c.csv`]: "abc",
      'a?b*c:d|e<f>g"h.csv': "a b c d e f g h",
      "C:\\Users\\x\\file.csv": "file",
      "  spaced   out  .csv": "spaced out",
      "a\tb\nc.csv": "a b c",
      [`${cp(0x1f600)}report.csv`]: "report",
      "it's [draft] (v2).docx": "it s draft v2",
      // Nothing visible is left, so the fallback, not a blank header.
      [`${cp(0x3164)}.csv`]: INPUT_NAME_FALLBACK_STEM,
      [`${cp(0x115f)}.csv`]: INPUT_NAME_FALLBACK_STEM,
      [`${cp(0xffa0)}${cp(0x1160)}.csv`]: INPUT_NAME_FALLBACK_STEM,
      [`${cp(0xfe0f)}.csv`]: INPUT_NAME_FALLBACK_STEM,
      [`${cp(0x034f)}.csv`]: INPUT_NAME_FALLBACK_STEM,
      // A combining mark with nothing to sit on is dropped at the start.
      [`${cp(0x0301)}x.csv`]: "x",
      [`-${cp(0x0301)}x.csv`]: "x",
      // An invisible filler inside a word is dropped, not made a space.
      [`a${cp(0x3164)}b.csv`]: "ab",
    };
    for (const [name, stem] of Object.entries(want))
      expect([name, sanitizeInputStem(name)]).toEqual([name, stem]);
  });

  it("long names are cut on a code-point boundary, within both bounds", () => {
    expect(sanitizeInputStem(`${"a".repeat(1000)}.csv`)).toBe(
      "a".repeat(INPUT_STEM_MAX_CODE_POINTS),
    );
    // Four bytes each: the byte bound binds first, and no surrogate is split.
    const ext = sanitizeInputStem(`${CJK_EXT_B.repeat(100)}.csv`);
    expect(ext).toBe(CJK_EXT_B.repeat(Math.floor(INPUT_STEM_MAX_BYTES / 4)));
    // Three bytes each, seven code points per word: cut mid-word, never
    // inside a grapheme cluster. WAS a code-point cut, which ended this name
    // on a consonant whose vowel sign was cut off (review 2026-11-18).
    const raw = BENGALI.repeat(40);
    const bn = sanitizeInputStem(`${raw}.csv`);
    const byBytes = Math.floor(INPUT_STEM_MAX_BYTES / 3);
    expect(raw.startsWith(bn)).toBe(true);
    expect(utf8(bn)).toBeLessThanOrEqual(INPUT_STEM_MAX_BYTES);
    // CONTROL: the code-point cut here would split a cluster (the next code
    // point is a mark), so this case can tell the two cuts apart.
    expect([...raw][byBytes]).toMatch(/\p{M}/u);
    const next = [...raw][[...bn].length]!;
    expect(next).not.toMatch(/\p{M}/u);
    expect([...bn].length).toBeLessThan(byBytes);
    expect([...bn].length).toBeGreaterThanOrEqual(byBytes - BENGALI.length);
    // The rest of the name starts a new cluster where the cut is made.
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    const ends = new Set<number>();
    let at = 0;
    for (const { segment } of segmenter.segment(raw))
      ends.add((at += segment.length));
    expect(ends.has(bn.length)).toBe(true);
  });
});

describe("non-Latin names survive", () => {
  it.each([
    ["Bengali", BENGALI],
    ["Cyrillic", CYRILLIC],
    ["CJK", CJK],
    ["CJK Extension B", CJK_EXT_B],
  ])("%s stem kept exactly, extension as before", (_label, stem) => {
    expect(officeInputName(`${stem}.csv`)).toBe(`${stem}.csv`);
    expect(officeOutputName(officeInputName(`${stem}.csv`))).toBe(
      `${stem}.pdf`,
    );
    expect(sanitizeInputStem(`${stem} 2026.xlsx`)).toBe(`${stem} 2026`);
  });

  it("a decomposed vowel sign is composed (NFC), not dropped", () => {
    // U+09CB written as U+09C7 U+09BE.
    const decomposed = BENGALI.replace(cp(0x09cb), cp(0x09c7, 0x09be));
    expect(decomposed).not.toBe(BENGALI);
    expect(sanitizeInputStem(`${decomposed}.csv`)).toBe(BENGALI);
  });
});

describe("the extension is the old rule, character for character", () => {
  it("over the corpus and the supported formats", () => {
    const names = [
      ...HOSTILE.map((h) => h.name),
      ...["docx", "doc", "odt", "rtf", "xlsx", "xls", "csv", "ods"].map(
        (e) => `file.${e}`,
      ),
      ...["pptx", "ppt", "odp", "CSV", "Docx"].map((e) => `file.${e}`),
      "no-extension",
      "a.b.c.d",
    ];
    for (const name of names)
      expect([name, officeInputExtension(name)]).toEqual([
        name,
        oldSafeInputName(name).slice("input".length),
      ]);
  });
});

describe("officeOutputName is where LibreOffice writes", () => {
  it("cuts at the last dot not at the start, then .pdf", () => {
    expect(officeOutputName("towns.csv")).toBe("towns.pdf");
    expect(officeOutputName("document.docx")).toBe("document.pdf");
    expect(officeOutputName("x.")).toBe("x.pdf");
    expect(officeOutputName("x..")).toBe("x..pdf");
    expect(officeOutputName(`${BENGALI}.csv`)).toBe(`${BENGALI}.pdf`);
  });
});

describe("libreOfficeEnv", () => {
  it("adds a UTF-8 character type only when nothing names one", () => {
    expect(libreOfficeEnv({ PATH: "/bin" })).toEqual({
      PATH: "/bin",
      LC_CTYPE: "C.UTF-8",
    });
    expect(libreOfficeEnv({ LANG: "C" }).LC_CTYPE).toBe("C.UTF-8");
    expect(libreOfficeEnv({ LANG: "en_US.UTF-8" })).toEqual({
      LANG: "en_US.UTF-8",
    });
    expect(libreOfficeEnv({ LC_CTYPE: "C.utf8" })).toEqual({
      LC_CTYPE: "C.utf8",
    });
    // An explicit LC_ALL is the operator's choice.
    expect(libreOfficeEnv({ LC_ALL: "C" })).toEqual({ LC_ALL: "C" });
  });
});

// ---------------------------------------------------------------------------
// The runner, through a stand-in LibreOffice that names its output by
// LibreOffice's rule (INetURLObject::setExtension: the last segment cut at
// its last dot that is not its first character, stopping at a ';').
// ---------------------------------------------------------------------------

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const config: NativeOfficeConversionConfig = {
  enabled: true,
  candidates: ["soffice"],
  overridden: false,
  timeoutMs: 120_000,
  maxInputBytes: 1_000_000,
  maxOutputBytes: 1_000_000,
  tmpDir: path.join(path.sep, "tmp"),
};

function libreOfficeWrites(inputPath: string, outdir: string): string {
  const seg = path.basename(inputPath);
  const end = seg.includes(";") ? seg.indexOf(";") : seg.length;
  let dot = -1;
  for (let i = 1; i < end; i += 1) if (seg[i] === ".") dot = i;
  return path.join(outdir, `${seg.slice(0, dot > 0 ? dot : end)}.pdf`);
}

function standIn() {
  const files = new Map<string, Uint8Array>();
  const written: string[] = [];
  const calls: { args: string[]; env?: Record<string, string | undefined> }[] =
    [];
  const dir = path.join(path.sep, "tmp", "pdfxyz-office-1");
  const fs: LibreOfficeFs = {
    mkdtemp: async () => dir,
    writeFile: async (file, data) => {
      written.push(file);
      files.set(file, data);
    },
    readFile: async (file) => {
      const got = files.get(file);
      if (!got)
        throw Object.assign(new Error(`ENOENT ${file}`), { code: "ENOENT" });
      return got;
    },
    rm: async () => {},
  };
  const exec: LibreOfficeExec = async (_command, args, options) => {
    calls.push({ args: [...args], env: options.env });
    const input = args.at(-1)!;
    const outdir = args[args.indexOf("--outdir") + 1]!;
    if (!files.has(input)) return { code: 0, timedOut: false };
    files.set(libreOfficeWrites(input, outdir), PDF);
    return { code: 0, timedOut: false };
  };
  return { dir, fs, exec, files, written, calls };
}

describe("the runner writes the user's stem and reads what LibreOffice writes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("CONTROL: the stand-in's output is NOT input.pdf for a named file", async () => {
    const s = standIn();
    const runner = createNativeLibreOfficePdfRunner(config, {
      exec: s.exec,
      fs: s.fs,
      resolveOnPath: () => true,
    });
    await runner.convertToPdf(new TextEncoder().encode("a,b\n"), "towns.csv");
    await expect(
      s.fs.readFile(path.join(s.dir, "input.pdf")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(s.files.has(path.join(s.dir, "towns.pdf"))).toBe(true);
  });

  it("over the corpus and the scripts: one file written, in the dir, handed over last, read back", async () => {
    const names = [
      ...HOSTILE.map((h) => h.name).filter((n) => /\.[a-z]+$/i.test(n)),
      `${BENGALI}.csv`,
      `${CYRILLIC}.xlsx`,
      `${CJK}.docx`,
    ];
    expect(names.length).toBeGreaterThanOrEqual(20);
    const bad: string[] = [];
    for (const name of names) {
      const s = standIn();
      const runner = createNativeLibreOfficePdfRunner(config, {
        exec: s.exec,
        fs: s.fs,
        resolveOnPath: () => true,
        importFilter: () => null,
      });
      try {
        const out = await runner.convertToPdf(new Uint8Array([1]), name);
        if (out !== PDF) bad.push(`${name}: not the stand-in's PDF`);
      } catch (error) {
        bad.push(`${JSON.stringify(name)}: ${(error as Error).message}`);
        continue;
      }
      const file = s.written[0]!;
      if (s.written.length !== 1)
        bad.push(`${name}: ${s.written.length} files`);
      if (path.dirname(file) !== s.dir) bad.push(`${name}: wrote ${file}`);
      if (s.calls[0]!.args.at(-1) !== file) bad.push(`${name}: argv`);
      if (path.basename(file) !== officeInputName(name))
        bad.push(`${name}: ${path.basename(file)}`);
      if (path.basename(file).startsWith("input."))
        bad.push(`${name}: still input.*`);
    }
    expect(bad).toEqual([]);
  });

  it("a Bengali CSV is written, handed over and read back under its own stem", async () => {
    const s = standIn();
    const runner = createNativeLibreOfficePdfRunner(config, {
      exec: s.exec,
      fs: s.fs,
      resolveOnPath: () => true,
    });
    await runner.convertToPdf(
      new TextEncoder().encode("a,b\n"),
      `${BENGALI}.csv`,
    );
    expect(s.written).toEqual([path.join(s.dir, `${BENGALI}.csv`)]);
    expect(s.calls[0]!.args.at(-1)).toBe(path.join(s.dir, `${BENGALI}.csv`));
    // Its CSV filter is still chosen by the extension.
    expect(s.calls[0]!.args.some((a) => a.startsWith("--infilter="))).toBe(
      true,
    );
  });

  it("LibreOffice gets a UTF-8 character type when the worker sets no locale", async () => {
    vi.stubEnv("LC_ALL", "");
    vi.stubEnv("LC_CTYPE", "");
    vi.stubEnv("LANG", "");
    const s = standIn();
    const runner = createNativeLibreOfficePdfRunner(config, {
      exec: s.exec,
      fs: s.fs,
      resolveOnPath: () => true,
    });
    await runner.convertToPdf(new Uint8Array([1]), `${CYRILLIC}.docx`);
    expect(s.calls[0]!.env?.LC_CTYPE).toBe("C.UTF-8");
    // And the rest of the worker's environment is still there.
    expect(s.calls[0]!.env?.PATH ?? s.calls[0]!.env?.Path).toBe(
      process.env.PATH ?? process.env.Path,
    );
  });
});
