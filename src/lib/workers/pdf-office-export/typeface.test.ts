/**
 * `./typeface` (moved from `./deck-from-scan` on 2026-11-15): the one
 * mapping from a PDF font to an Office family both writers use, and PDF to
 * Word's two refusals — symbol faces and invisible runs name no typeface,
 * and a word with a letter outside Latin takes none.
 */
import { describe, expect, it } from "vitest";
import { OFFICE_METRIC_CLONES } from "../office-conversion/fonts";
import type { ScannedRun } from "./page-scan";
import {
  CLASS_DEFAULT,
  docxTypefaceOf,
  OFFICE_FAMILIES,
  sameWidths,
  typefaceFor,
  WORD_SCRIPT_SAFE,
} from "./typeface";

const run = (
  family: string,
  fontClass: ScannedRun["fontClass"] = "sans",
  extra: Partial<Pick<ScannedRun, "text" | "invisible">> = {},
) => ({ family, fontClass, text: "Abc", invisible: false, ...extra });

describe("typefaceFor / docxTypefaceOf — the mapping", () => {
  it("the PDF standard fonts become the Office face cut to their widths", () => {
    expect(docxTypefaceOf(run("Helvetica"))).toBe("Arial");
    expect(docxTypefaceOf(run("Helvetica Neue"))).toBe("Arial");
    expect(docxTypefaceOf(run("Times", "serif"))).toBe("Times New Roman");
    expect(docxTypefaceOf(run("Times Roman", "serif"))).toBe("Times New Roman");
    expect(docxTypefaceOf(run("Courier", "mono"))).toBe("Courier New");
    for (const f of ["helvetica", "times", "courier"])
      expect(sameWidths({ family: f }), f).toBe(true);
  });

  it("a family Office ships keeps its name, whatever its case", () => {
    expect(docxTypefaceOf(run("Georgia", "serif"))).toBe("Georgia");
    expect(docxTypefaceOf(run("calibri"))).toBe("Calibri");
    expect(docxTypefaceOf(run("Consolas", "mono"))).toBe("Consolas");
  });

  it("each free metric clone becomes the family it clones", () => {
    // Health: the clone list is not empty.
    expect(OFFICE_METRIC_CLONES.length).toBeGreaterThan(3);
    for (const c of OFFICE_METRIC_CLONES)
      expect(docxTypefaceOf(run(c.clone)), c.clone).toBe(c.office);
  });

  it("an unknown family becomes its class's default: Arial, Times New Roman, Courier New", () => {
    expect(docxTypefaceOf(run("DejaVu Sans"))).toBe("Arial");
    expect(docxTypefaceOf(run("Noto Serif", "serif"))).toBe("Times New Roman");
    expect(docxTypefaceOf(run("Fira Code", "mono"))).toBe("Courier New");
    expect(CLASS_DEFAULT).toEqual({
      sans: "Arial",
      serif: "Times New Roman",
      mono: "Courier New",
    });
  });

  /*
   * Review of 2026-11-15, round 2. Until then an unknown family took
   * CLASS_DEFAULT[fontClass] in Word too, and `fontClass` is pdf.js's
   * `fallbackName`: "serif" from the Serif flag or a name list, "monospace"
   * when every width in the font is equal, and "sans-serif" for EVERYTHING
   * else — so "sans" meant "nothing said", and pdfTeX's CMR10 (/Flags 4),
   * CMTT10 and pdf.xyz's own Geist Mono pack were all written as Arial. The
   * kind is now taken from the family's name and from what pdf.js could
   * positively see; with neither, or when they disagree, no typeface.
   */
  it("an unknown family's kind comes from its name: CMR10 is serif, CMTT10 and Geist Mono are monospaced, though pdf.js said sans", () => {
    expect(docxTypefaceOf(run("CMR10"))).toBe("Times New Roman");
    expect(docxTypefaceOf(run("CMBX12"))).toBe("Times New Roman");
    expect(docxTypefaceOf(run("LMRoman10"))).toBe("Times New Roman");
    expect(docxTypefaceOf(run("CMTT10"))).toBe("Courier New");
    expect(docxTypefaceOf(run("LMMono10"))).toBe("Courier New");
    expect(docxTypefaceOf(run("Geist Mono"))).toBe("Courier New");
    expect(docxTypefaceOf(run("Source Code Pro"))).toBe("Courier New");
    expect(docxTypefaceOf(run("DejaVu Sans Mono"))).toBe("Courier New");
    expect(docxTypefaceOf(run("CMSS10", "serif"))).toBeNull();
    expect(docxTypefaceOf(run("Noto Sans"))).toBe("Arial");
    expect(docxTypefaceOf(run("Monotype Corsiva"))).toBeNull();
  });

  it("an unknown family pdf.js could not mark, with no kind in its name, takes NO typeface (it was Arial)", () => {
    expect(docxTypefaceOf(run("Some Unknown Face"))).toBeNull();
    expect(docxTypefaceOf(run("Geist"))).toBeNull();
    expect(docxTypefaceOf(run("Roboto"))).toBeNull();
    // PowerPoint keeps its own rule: the deck's text box needs a face.
    expect(typefaceFor(run("Some Unknown Face"))).toBe("Arial");
  });

  it("pdf.js's 'monospace' counts only when the run shows a narrow and a wide letter at the same width", () => {
    // Every width equal is pdf.js's whole test, and a subset of digits
    // (tabular in most faces) or of one glyph passes it.
    expect(docxTypefaceOf(run("Unknown", "mono", { text: "2026" }))).toBeNull();
    expect(docxTypefaceOf(run("Unknown", "mono", { text: "Abc" }))).toBeNull();
    expect(docxTypefaceOf(run("Unknown", "mono", { text: "if x: m" }))).toBe(
      "Courier New",
    );
    // A serif mark from the Serif flag or pdf.js's name list stands.
    expect(docxTypefaceOf(run("Unknown", "serif"))).toBe("Times New Roman");
  });

  it("a name and a mark that disagree name no typeface", () => {
    expect(docxTypefaceOf(run("Noto Serif", "mono", { text: "mil" }))).toBe(
      null,
    );
    expect(docxTypefaceOf(run("Fira Code", "serif"))).toBeNull();
  });

  it("a symbol or dingbat face names NO typeface in Word, mapped or not (PowerPoint keeps its own rule)", () => {
    const pua = String.fromCharCode(0xf0e0);
    for (const f of [
      "Symbol",
      "ZapfDingbats",
      "Zapf Dingbats",
      "Wingdings",
      "Wingdings 2",
      "Webdings",
    ]) {
      expect(docxTypefaceOf(run(f)), f).toBeNull();
      expect(docxTypefaceOf(run(f, "sans", { text: pua })), f).toBeNull();
    }
    // PowerPoint: a symbol run whose glyphs are real characters takes the
    // line's face; one in the Private Use Area keeps the symbol face.
    expect(typefaceFor(run("Wingdings"), "Georgia")).toBe("Georgia");
    expect(typefaceFor(run("Wingdings", "sans", { text: pua }))).toBe(
      "Wingdings",
    );
  });

  it("an invisible run (an OCR layer) names no typeface", () => {
    expect(docxTypefaceOf(run("Helvetica", "sans", { invisible: true }))).toBe(
      null,
    );
  });

  it("every typeface Word is given is an Office family, and never a symbol face", () => {
    const families = [
      "Helvetica",
      "Times",
      "Courier",
      "Georgia",
      "DejaVu Sans",
      "Noto Sans",
      "Some Unknown Face",
      ...OFFICE_METRIC_CLONES.map((c) => c.clone),
      ...OFFICE_FAMILIES,
    ];
    const office = new Set<string>(OFFICE_FAMILIES);
    const symbols = new Set(["Symbol", "Wingdings", "Wingdings 2"]);
    const got = families.flatMap((f) =>
      (["sans", "serif", "mono"] as const).map((c) =>
        docxTypefaceOf(run(f, c)),
      ),
    );
    // Health: the list reaches both answers.
    expect(got.filter((g) => g === null).length).toBeGreaterThan(0);
    expect(got.filter((g) => g !== null).length).toBeGreaterThan(50);
    for (const g of got) {
      if (g === null) continue;
      expect(office.has(g), g).toBe(true);
      expect(symbols.has(g), g).toBe(false);
    }
  });
});

describe("WORD_SCRIPT_SAFE — which words may take a typeface", () => {
  it.each([
    ["Latin", "Hello"],
    ["accented Latin", "café naïve Ærø Łódź"],
    ["digits and punctuation", "(42), 3.14 — “quoted” €5"],
    ["a word with its leading space", " printf"],
    ["empty", ""],
  ])("%s passes", (_, text) => {
    expect(WORD_SCRIPT_SAFE.test(text)).toBe(true);
  });

  it.each([
    ["Bengali", "মোট"],
    ["Greek", "αβγ"],
    ["Cyrillic", "Привет"],
    ["Chinese", "中文"],
    ["Arabic", "مرحبا"],
    ["Hebrew", "שלום"],
    ["Devanagari", "हिन्दी"],
    ["one Bengali letter among Latin", "Totalম"],
  ])("%s fails", (_, text) => {
    expect(WORD_SCRIPT_SAFE.test(text)).toBe(false);
  });
});
