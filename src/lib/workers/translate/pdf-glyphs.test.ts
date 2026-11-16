// @vitest-environment node
// @native-canvas
/**
 * The CJK Type 3 checks over REAL probe PDFs captured in the worker image
 * (`fixtures/README.md`): pdffonts' columns, the Type 3 glyph reader, check
 * (glyphs), and pdf.js's extracted text. A desktop Chromium prints CJK with
 * TrueType system fonts and never produces Type 3, so these fixtures and the
 * prod-image proof are the only places this path runs.
 *
 * Every negative control mutates a COPY of a real fixture's bytes with
 * pdf-lib, so each fails for one named reason on an otherwise real file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFContext,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import {
  fontsCarryScript,
  glyphsCarrySample,
  LANGUAGE_SAMPLES,
  LANGUAGE_SCRIPT,
  probeJudgedText,
  textCarriesSample,
} from "./pdf-capability";
import {
  charProcIsVectorOnly,
  parsePdfFonts,
  PdfFontsLayoutError,
  type3Glyphs,
  viewerText,
} from "./pdf-readers";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const fixture = (f: string) =>
  new Uint8Array(readFileSync(path.join(FIXTURES, f)));
const CJK: readonly TranslateLanguage[] = ["zh", "ja", "ko"];
const judged = (l: TranslateLanguage) =>
  probeJudgedText(l, LANGUAGE_SAMPLES[l]);

describe("pdffonts columns, by header label", () => {
  /** REAL: `pdffonts` (poppler 22.12) in the worker image over zh-probe.pdf. */
  const REAL = readFileSync(
    path.join(FIXTURES, "zh-probe.pdffonts.txt"),
    "utf8",
  );

  it("reads the real poppler output, Type 3 rows included verbatim", () => {
    expect(REAL).toContain(
      "[none]                               Type 3            Custom           yes no  yes      6  0",
    );
    const rows = parsePdfFonts(REAL);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({
      name: "AAAAAA+NotoSans-Bold",
      type: "CID TrueType",
      embedded: true,
      unicode: true,
    });
    expect(rows.filter((r) => r.type === "Type 3")).toHaveLength(8);
    expect(rows.every((r) => r.embedded && r.unicode)).toBe(true);
    // The composed chain: the real rows through (a).
    expect(fontsCarryScript(rows, "Han")).toBe(true);
    expect(fontsCarryScript(rows, "Bengali")).toBe(false);
  });

  /**
   * CONSTRUCTED, not captured: no xpdf `pdffonts` exists on any machine this
   * was written on (the development machine has xpdf 4.00's pdftotext only).
   * It is the layout xpdf documents — no `encoding` column — and its job is
   * to prove the parser finds `emb` and `uni` by label: read by POSITION,
   * `uni` (index 5) would land on `object ID` here.
   */
  const XPDF = [
    "name                                 type              emb sub uni object ID",
    "------------------------------------ ----------------- --- --- --- ---------",
    "AAAAAA+NotoSans-Regular              CID TrueType      yes yes no       5  0",
    "[none]                               Type 3            yes no  yes      6  0",
  ].join("\n");

  it("control: an xpdf layout without the encoding column reads the right columns", () => {
    expect(parsePdfFonts(XPDF)).toEqual([
      {
        name: "AAAAAA+NotoSans-Regular",
        type: "CID TrueType",
        embedded: true,
        unicode: false,
      },
      { name: "[none]", type: "Type 3", embedded: true, unicode: true },
    ]);
  });

  it("a missing label THROWS — never a silent 'not embedded'", () => {
    expect(() => parsePdfFonts(REAL.replace(" uni ", " xyz "))).toThrow(
      PdfFontsLayoutError,
    );
    expect(() => parsePdfFonts(XPDF.replace("emb", "abc"))).toThrow(
      PdfFontsLayoutError,
    );
  });
});

describe("type3Glyphs on the real fixtures", () => {
  it.each(CJK)(
    "%s: every Type 3 font names its regional face and carries its own .notdef",
    async (l) => {
      const fonts = await type3Glyphs(fixture(`${l}-probe.pdf`));
      // Health: a corpus that quietly shrank would pass everything below.
      expect(fonts.length).toBeGreaterThanOrEqual(4);
      const region = { zh: "sc", ja: "jp", ko: "kr" }[l as "zh" | "ja" | "ko"];
      for (const f of fonts) {
        expect(f.descriptorName?.toLowerCase()).toContain(
          `notosanscjk${region}`,
        );
        expect(f.hasToUnicode).toBe(true);
        // Measured, not assumed: every glyph-ID range font has its own g0.
        expect(f.notdef).not.toBeNull();
        for (const g of f.used) expect(g.vectorOnly).toBe(true);
      }
      // The heading draws the BOLD faces, so (glyphs) judges both weights.
      const names = new Set(fonts.map((f) => f.descriptorName));
      expect([...names].some((n) => /bold/i.test(n ?? ""))).toBe(true);
      expect([...names].some((n) => /regular/i.test(n ?? ""))).toBe(true);
    },
  );

  it("en and bn have no Type 3 font", async () => {
    expect(await type3Glyphs(fixture("en-probe.pdf"))).toEqual([]);
    expect(await type3Glyphs(fixture("bn-probe.pdf"))).toEqual([]);
  });

  it("the vector-only test sees an inline image and an XObject", () => {
    expect(charProcIsVectorOnly("0 0 0 0 9 9 d1 0 0 m 9 9 l h f")).toBe(true);
    expect(
      charProcIsVectorOnly(
        "0 0 0 0 9 9 d1 q 9 0 0 9 0 0 cm BI /W 1 /H 1 /IM true ID \u0000 EI Q",
      ),
    ).toBe(false);
    expect(charProcIsVectorOnly("0 0 0 0 9 9 d1 /Im0 Do")).toBe(false);
    expect(charProcIsVectorOnly("0 0 m 9 9 l h f")).toBe(false);
  });
});

describe("(glyphs) on the real fixtures", () => {
  it.each(CJK)("%s passes", async (l) => {
    const fonts = await type3Glyphs(fixture(`${l}-probe.pdf`));
    expect(glyphsCarrySample(fonts, judged(l), LANGUAGE_SCRIPT[l])).toBe(true);
  });

  it("the PRE-rewrite zh fixture fails: its ToUnicode maps 文's glyph to ⽂", async () => {
    const fonts = await type3Glyphs(fixture("zh-probe.pre-rewrite.pdf"));
    expect(fonts.some((f) => f.used.some((g) => g.unicode === "⽂"))).toBe(
      true,
    );
    expect(glyphsCarrySample(fonts, judged("zh"), "Han")).toBe(false);
  });

  it("wrong script: the zh fixture judged as Bengali fails", async () => {
    const fonts = await type3Glyphs(fixture("zh-probe.pdf"));
    expect(glyphsCarrySample(fonts, judged("zh"), "Bengali")).toBe(false);
    // And as Japanese: the descriptor names the SC face, not JP.
    expect(glyphsCarrySample(fonts, judged("zh"), "Kana")).toBe(false);
  });

  it("vacuity: no Type 3 fonts at all is not a pass", () => {
    expect(glyphsCarrySample([], judged("zh"), "Han")).toBe(false);
  });
});

interface Type3Handle {
  dict: PDFDict;
  procs: PDFDict;
  diffs: PDFArray;
  /** code → glyph name, from /Differences. */
  names: Map<number, string>;
}

/** Mutate a COPY of a fixture's Type 3 fonts, and return the saved bytes. */
async function mutate(
  file: string,
  fn: (fonts: Type3Handle[], ctx: PDFContext) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(fixture(file), { updateMetadata: false });
  const ctx = doc.context;
  const fonts: Type3Handle[] = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Subtype")) !== PDFName.of("Type3")) continue;
    const procs = obj.lookup(PDFName.of("CharProcs"), PDFDict);
    const enc = obj.lookup(PDFName.of("Encoding"), PDFDict);
    const diffs = enc.lookup(PDFName.of("Differences"), PDFArray);
    const names = new Map<number, string>();
    let code = 0;
    for (const item of diffs.asArray()) {
      if (item instanceof PDFName) names.set(code++, item.decodeText());
      else code = (item as unknown as { asNumber(): number }).asNumber();
    }
    fonts.push({ dict: obj, procs, diffs, names });
  }
  fn(fonts, ctx);
  return doc.save();
}

/** The codes each Type 3 font draws for the judged sample, from the reader. */
async function sampleCodes(file: string, l: TranslateLanguage) {
  const fonts = await type3Glyphs(fixture(file));
  const want = new Set(judged(l));
  return fonts.map((f) =>
    f.used.filter((g) => g.unicode && want.has(g.unicode)).map((g) => g.code),
  );
}

describe("(glyphs) negative controls, each a mutated COPY of a real fixture", () => {
  it("tofu: every sample glyph replaced by its font's .notdef box fails", async () => {
    const codes = await sampleCodes("zh-probe.pdf", "zh");
    const bytes = await mutate("zh-probe.pdf", (fonts) => {
      fonts.forEach((f, i) => {
        const g0 = f.procs.get(PDFName.of("g0"));
        for (const code of codes[i] ?? [])
          f.procs.set(PDFName.of(f.names.get(code)!), g0!);
      });
    });
    expect(codes.flat().length).toBeGreaterThan(3);
    expect(
      glyphsCarrySample(await type3Glyphs(bytes), judged("zh"), "Han"),
    ).toBe(false);
  });

  /**
   * ONE box, not all of them: when every glyph is the box, distinctness
   * alone refuses it (mutation m3, 2026-11-16: dropping only the .notdef
   * comparison left "tofu" green). A single box among real glyphs is
   * distinct from them, so only the .notdef comparison can see it.
   */
  it("one tofu: a single sample glyph replaced by its font's .notdef box fails", async () => {
    const codes = await sampleCodes("ja-probe.pdf", "ja");
    const i = codes.findIndex((c) => c.length > 0);
    const bytes = await mutate("ja-probe.pdf", (fonts) => {
      const f = fonts[i]!;
      f.procs.set(
        PDFName.of(f.names.get(codes[i]![0]!)!),
        f.procs.get(PDFName.of("g0"))!,
      );
    });
    expect(
      glyphsCarrySample(await type3Glyphs(bytes), judged("ja"), "Kana"),
    ).toBe(false);
  });

  it("bitmap: one drawn glyph replaced by an inline-image glyph fails", async () => {
    const codes = await sampleCodes("ja-probe.pdf", "ja");
    const bytes = await mutate("ja-probe.pdf", (fonts, ctx) => {
      const i = codes.findIndex((c) => c.length > 0);
      const name = fonts[i]!.names.get(codes[i]![0]!)!;
      fonts[i]!.procs.set(
        PDFName.of(name),
        ctx.register(
          ctx.flateStream(
            "1000 0 0 -880 1000 120 d1 q 1000 0 0 1000 0 -880 cm BI /W 1 /H 1 /BPC 1 /IM true ID \u0000 EI Q 0 0 m 1 1 l h f",
          ),
        ),
      );
    });
    expect(
      glyphsCarrySample(await type3Glyphs(bytes), judged("ja"), "Kana"),
    ).toBe(false);
  });

  it("no ToUnicode on one font fails", async () => {
    const bytes = await mutate("ko-probe.pdf", (fonts) => {
      fonts[0]!.dict.delete(PDFName.of("ToUnicode"));
    });
    const fonts = await type3Glyphs(bytes);
    expect(fonts.filter((f) => !f.hasToUnicode)).toHaveLength(1);
    expect(glyphsCarrySample(fonts, judged("ko"), "Hangul")).toBe(false);
  });

  it("duplicate glyphs: two distinct sample code points drawn by one CharProc fail", async () => {
    const codes = await sampleCodes("zh-probe.pdf", "zh");
    const i = codes.findIndex((c) => c.length >= 2);
    expect(i).toBeGreaterThanOrEqual(0);
    const bytes = await mutate("zh-probe.pdf", (fonts) => {
      const f = fonts[i]!;
      const [a, b] = codes[i]!;
      f.procs.set(
        PDFName.of(f.names.get(b!)!),
        f.procs.get(PDFName.of(f.names.get(a!)!))!,
      );
    });
    expect(
      glyphsCarrySample(await type3Glyphs(bytes), judged("zh"), "Han"),
    ).toBe(false);
  });

  it("missing .notdef: a font whose g0 is gone FAILS, it is not compared against nothing", async () => {
    const bytes = await mutate("zh-probe.pdf", (fonts) => {
      fonts[1]!.procs.delete(PDFName.of("g0"));
    });
    const fonts = await type3Glyphs(bytes);
    expect(fonts.filter((f) => f.notdef === null)).toHaveLength(1);
    expect(glyphsCarrySample(fonts, judged("zh"), "Han")).toBe(false);
  });

  it("health: the mutation helper itself leaves a copy that still passes", async () => {
    const bytes = await mutate("zh-probe.pdf", () => {});
    expect(
      glyphsCarrySample(await type3Glyphs(bytes), judged("zh"), "Han"),
    ).toBe(true);
  });
});

describe("(e) pdf.js extracted text on the real fixtures", () => {
  it.each(CJK)("%s: every judged code point is in pdf.js's text", async (l) => {
    expect(
      textCarriesSample(await viewerText(fixture(`${l}-probe.pdf`)), judged(l)),
    ).toBe(true);
  });

  it("the pre-rewrite zh fixture reads ⽂, not 文, in pdf.js", async () => {
    const text = await viewerText(fixture("zh-probe.pre-rewrite.pdf"));
    expect(text).toContain("⽂");
    expect(textCarriesSample(text, judged("zh"))).toBe(false);
  });
});
