// @vitest-environment node
/**
 * The language proof's LOGIC, over stub Chromium and stub readers: the real
 * chain (soundness → processor → manifest gate) runs, the renderer and the
 * poppler readers are stood in. `pdf-capability.chromium.test.ts` runs the
 * real thing where Chromium and poppler exist.
 *
 * MUTATION (2026-11-15, scratchpad copy, restored by `cp`, compared by
 * `cmp`): replacing the `fontsCarryScript(...)` condition with `false` (the
 * reader skips check (a)) turned the Private Use Area control red — the
 * stub text reader reads the PUA sample back whole, so (a) is the only check
 * that can refuse it here.
 *
 * SUPERSEDED (2026-11-16, CJK in Type 3): (a) no longer refuses a Type 3 font
 * for Japanese, so it is no longer what refuses the PUA. A PUA code point is
 * drawn with its font's .notdef CharProc (Skia's `g0`), and (glyphs) refuses
 * that: the ja PUA control now expects `glyphs`. Re-run the same day: making
 * the `glyphsCarrySample(...)` condition always true turned that control red
 * (`viewer_text` would still refuse it at the end, so the expected reason is
 * pinned, not just the verdict).
 */
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import {
  TRANSLATE_LANGUAGES,
  type TranslateLanguage,
} from "@/lib/jobs/translate-pdf";
import type { ChromiumPackageRunner } from "../html-render/engine";
import type { TranslatePdfDeps } from "./engine";
import {
  fontsCarryScript,
  LANGUAGE_SAMPLES,
  laidOutRightToLeft,
  PROBE_EXTRA,
  probeJudgedText,
  probeTranslatePdfLanguages,
  provesTranslatePdfLanguages,
  rasterHasInk,
  textCarriesSample,
  TranslatePdfProbeCorpusError,
} from "./pdf-capability";
import { renderTranslationPdf } from "./pdf-render";
import {
  parseBboxWords,
  type PdfProbeReaders,
  type Type3Font,
} from "./pdf-readers";
import { radicalRewritesFor } from "./radical-equivalents";
import { typesetText, type TypesetInput } from "./typeset";
import {
  memoTranslatePdfLanguages,
  resetTranslatePdfLanguagesForTests,
  settledTranslatePdfLanguages,
} from "./pdf-languages";

const PUA = String.fromCharCode(0xe000);

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

const TYPE3_DRAWN =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Co}/u;
const STUB_NOTDEF = "0 0 0 0 1000 1000 d1 0 0 m 1000 0 l 1000 1000 l h f";
const REGION: Partial<Record<TranslateLanguage, string>> = {
  zh: "sc",
  ja: "jp",
  ko: "kr",
};

/**
 * A stand-in for Chromium + poppler that "prints" what it is given: the text
 * reader returns the document's own text, the font reader reports a Noto face
 * for every non-CJK script — and Type 3 faces for CJK and the PUA, which is
 * what a real print in the worker image looks like (2026-11-15: Skia prints
 * CFF-only Noto CJK as Type 3). The Type 3 reader draws each CJK code point
 * with its own vector glyph, and a PUA code point with the .notdef box.
 */
function stubs(
  opts: {
    failRender?: TranslateLanguage;
    rtl?: boolean;
    viewer?: "absent" | ((text: string) => string);
  } = {},
) {
  let last: TypesetInput | null = null;
  const chromium: ChromiumPackageRunner = {
    renderPackage: async () => [await blankPdf()],
  };
  const render: TranslatePdfDeps["render"] = async ({ input }) => {
    last = input;
    if (input.target === opts.failRender)
      return { ok: false, reason: "render_failed" };
    return renderTranslationPdf({
      chromium,
      readBack: async () => typesetText(input),
      input,
    });
  };
  const text = () => (last ? typesetText(last) : "");
  const cid = (name: string) => ({
    name,
    type: "CID TrueType",
    embedded: true,
    unicode: true,
  });
  const type3Drawn = () =>
    [...new Set(text())].filter((c) => TYPE3_DRAWN.test(c));
  const readers: PdfProbeReaders = {
    fonts: async () => [
      cid("AAAAAA+NotoSans-Regular"),
      cid("BBBBBB+NotoSansArabic-Regular"),
      cid("CCCCCC+NotoSansBengali-Regular"),
      cid("DDDDDD+NotoSansDevanagari-Regular"),
      cid("EEEEEE+NotoSansThai-Regular"),
      // HISTORY (2026-11-16): this stub listed a `CID Type 0C`
      // NotoSansCJKjp row — a shape the worker image never produces (it
      // prints Noto CJK as Type 3). Replaced by the real shape below.
      ...(type3Drawn().length > 0
        ? [{ name: "[none]", type: "Type 3", embedded: true, unicode: true }]
        : []),
    ],
    type3: async (): Promise<Type3Font[]> => {
      const drawn = type3Drawn();
      if (drawn.length === 0) return [];
      const region = (last && REGION[last.target]) ?? "jp";
      return [
        {
          descriptorName: `NotoSansCJK${region}-Regular`,
          hasToUnicode: true,
          notdef: STUB_NOTDEF,
          used: drawn.map((ch, i) => {
            const cp = ch.codePointAt(0)!;
            return {
              code: i,
              unicode: ch,
              content: /\p{Co}/u.test(ch)
                ? STUB_NOTDEF
                : `0 0 0 0 1000 1000 d1 ${cp} 0 m ${cp} 1 l h f`,
              vectorOnly: true,
            };
          }),
        },
      ];
    },
    ...(opts.viewer === "absent"
      ? {}
      : {
          viewerText: async () =>
            typeof opts.viewer === "function" ? opts.viewer(text()) : text(),
        }),
    text: async () => text(),
    words: async () => {
      const words = (last?.parts[0]?.kind === "body" ? last.parts[0].text : "")
        .split(/\s+/)
        .filter(Boolean);
      // Right to left: the first logical word has the LARGEST xMin. And the
      // text is what real poppler returns for a right-to-left script: each
      // word's code points in VISUAL (reversed) order. Until 2026-11-15 this
      // stub emitted logical order, which no real reader does, so the
      // probe-level tests agreed with a predicate that failed every real run.
      const visual = (w: string) =>
        /\p{Script=Arabic}|\p{Script=Hebrew}/u.test(w)
          ? [...w].reverse().join("")
          : w;
      return words.map((w, i) => ({
        text: visual(w),
        xMin: opts.rtl === false ? i * 10 : 1000 - i * 10,
      }));
    },
  };
  return { render, readers };
}

describe("the language proof", () => {
  it("passes all 21 languages through the real chain when every check holds", async () => {
    const { render, readers } = stubs();
    const probe = await probeTranslatePdfLanguages({ render, readers });
    expect(probe.passing).toEqual([...TRANSLATE_LANGUAGES].sort());
    expect(probe.results).toHaveLength(21);
  });

  it("health: a shrunk corpus is FATAL, not a smaller pass", async () => {
    const { render, readers } = stubs();
    const { ja: _ja, ...shrunk } = LANGUAGE_SAMPLES;
    void _ja;
    await expect(
      provesTranslatePdfLanguages({ render, readers, samples: shrunk }),
    ).rejects.toBeInstanceOf(TranslatePdfProbeCorpusError);
    await expect(
      provesTranslatePdfLanguages({
        render,
        readers,
        samples: { ...LANGUAGE_SAMPLES, xx: "extra" },
      }),
    ).rejects.toBeInstanceOf(TranslatePdfProbeCorpusError);
  });

  it("health: the stub prints CJK the way the image does, as Type 3", async () => {
    const { render, readers } = stubs();
    await probeTranslatePdfLanguages({ render, readers, only: ["ja"] });
    const rows = await readers.fonts(new Uint8Array());
    expect(rows.some((r) => r.type === "Type 3")).toBe(true);
    expect(
      (await readers.type3(new Uint8Array()))[0]?.used.length,
    ).toBeGreaterThan(5);
  });

  /**
   * INVERTED 2026-11-16 (was `"fonts"`): (a) refused the PUA because the
   * stub printed it as Type 3 and (a) refused every Type 3 font — a
   * mechanism that could never pass Noto CJK in bookworm. Japanese now
   * prints Type 3 legitimately, and the PUA is refused for what it IS: a
   * code point drawn with the .notdef box, which (glyphs) sees.
   */
  it("positive control: a sample in the Private Use Area fails its language", async () => {
    const { render, readers } = stubs();
    const probe = await probeTranslatePdfLanguages({
      render,
      readers,
      samples: { ...LANGUAGE_SAMPLES, ja: `${PUA}${PUA} ${PUA}` },
      only: ["ja", "en"],
    });
    expect(probe.passing).toEqual(["en"]);
    expect(probe.results.find((r) => r.language === "ja")?.failed).toBe(
      "glyphs",
    );
  });

  it("(e) no pdf.js reader: zh, ja and ko FAIL viewer_text, never skip it; en is unaffected", async () => {
    const { render, readers } = stubs({ viewer: "absent" });
    expect(readers.viewerText).toBeUndefined();
    const probe = await probeTranslatePdfLanguages({
      render,
      readers,
      only: ["zh", "ja", "ko", "en", "bn"],
    });
    expect(probe.passing).toEqual(["bn", "en"]);
    for (const l of ["zh", "ja", "ko"])
      expect(probe.results.find((r) => r.language === l)?.failed).toBe(
        "viewer_text",
      );
  });

  it("(e) a viewer that misses one judged code point fails viewer_text", async () => {
    // What pdf.js read before the rewrite: the glyph shared with ⽂.
    const { render, readers } = stubs({
      viewer: (t) => t.replaceAll("文", "\u2F42"),
    });
    const probe = await probeTranslatePdfLanguages({
      render,
      readers,
      only: ["ja", "ko"],
    });
    expect(probe.passing).toEqual(["ko"]);
    expect(probe.results.find((r) => r.language === "ja")?.failed).toBe(
      "viewer_text",
    );
  });

  it("the judged string carries the extra: 文 for ja, 一 for zh", () => {
    expect(probeJudgedText("ja", LANGUAGE_SAMPLES.ja)).toContain("文");
    expect(probeJudgedText("zh", LANGUAGE_SAMPLES.zh)).toContain("一");
    expect(probeJudgedText("en", LANGUAGE_SAMPLES.en)).toBe(
      LANGUAGE_SAMPLES.en,
    );
    // The sample alone has no Kangxi-shared Han for ja: the extra is needed.
    expect(LANGUAGE_SAMPLES.ja).not.toContain("文");
  });

  it("health: zh's and ja's judged text holds a code point the rewrite maps TO", () => {
    // The MECHANISM only. The PROPERTY (pdf.js misreads it without the
    // rewrite) is held by the composed-chain test in pdf-render.cjk.test.ts.
    // The table is per face (review 2026-11-16): the faces fontconfig picks
    // for zh and ja in the image, as the fixtures' Type 3 descriptors name.
    const face = { zh: "NotoSansCJKsc-Regular", ja: "NotoSansCJKjp-Regular" };
    for (const l of ["zh", "ja"] as const) {
      const targets = new Set(
        [...radicalRewritesFor(face[l]).values()].map((v) =>
          String.fromCodePoint(v),
        ),
      );
      expect(targets.size).toBeGreaterThan(200);
      const judged = probeJudgedText(l, LANGUAGE_SAMPLES[l]);
      expect([...judged].filter((c) => targets.has(c)).length).toBeGreaterThan(
        0,
      );
      expect(PROBE_EXTRA[l]).toBeTruthy();
    }
  });

  it("a job that delivered no PDF artifact fails that language", async () => {
    const { render, readers } = stubs({ failRender: "bn" });
    const probe = await probeTranslatePdfLanguages({
      render,
      readers,
      only: ["bn", "es"],
    });
    expect(probe.passing).toEqual(["es"]);
    expect(probe.results.find((r) => r.language === "bn")?.failed).toBe(
      "no_pdf",
    );
  });

  it("Arabic laid out left to right fails the direction check", async () => {
    const { render, readers } = stubs({ rtl: false });
    const probe = await probeTranslatePdfLanguages({
      render,
      readers,
      only: ["ar"],
    });
    expect(probe.passing).toEqual([]);
    expect(probe.results[0]?.failed).toBe("direction");
  });

  it("Arabic laid out right to left, read back in visual order, passes", async () => {
    const { render, readers } = stubs({ rtl: true });
    const probe = await probeTranslatePdfLanguages({
      render,
      readers,
      only: ["ar"],
    });
    expect(probe.passing).toEqual(["ar"]);
    expect(probe.results[0]?.failed).toBeUndefined();
  });

  it("no renderer or no readers: nothing proven, and no throw", async () => {
    const { render, readers } = stubs();
    expect(
      await provesTranslatePdfLanguages({ render: undefined, readers }),
    ).toEqual([]);
    expect(
      await provesTranslatePdfLanguages({ render, readers: null }),
    ).toEqual([]);
  });
});

describe("the independent checks", () => {
  it("(a) refuses a missing embed, a Type 3 face, or no Noto face for the script", () => {
    const noto = {
      name: "AAAAAA+NotoSansBengali-Regular",
      type: "CID TrueType",
      embedded: true,
      unicode: true,
    };
    expect(fontsCarryScript([noto], "Bengali")).toBe(true);
    expect(fontsCarryScript([{ ...noto, embedded: false }], "Bengali")).toBe(
      false,
    );
    expect(
      fontsCarryScript(
        [noto, { name: "x", type: "Type 3", embedded: true, unicode: true }],
        "Bengali",
      ),
    ).toBe(false);
    expect(fontsCarryScript([noto], "Thai")).toBe(false);
    expect(fontsCarryScript([], "Latin")).toBe(false);
    expect(
      fontsCarryScript(
        [
          {
            name: "CCCCCC+DejaVuSans",
            type: "CID TrueType",
            embedded: true,
            unicode: true,
          },
        ],
        "Arabic",
      ),
    ).toBe(false);
  });

  it("(a) refuses a font without ToUnicode, for every script", () => {
    const row = {
      name: "AAAAAA+NotoSansBengali-Regular",
      type: "CID TrueType",
      embedded: true,
      unicode: false,
    };
    expect(fontsCarryScript([row], "Bengali")).toBe(false);
    expect(fontsCarryScript([{ ...row, unicode: true }], "Bengali")).toBe(true);
  });

  /**
   * NEW 2026-11-16, beside the Bengali Type 3 refusal above (the surviving
   * non-CJK half of the old rule): Han, Kana and Hangul accept Type 3 at (a)
   * and leave the face's identity to (glyphs). Every other script still
   * refuses it.
   */
  it("(a) accepts Type 3 for Han, Kana and Hangul only", () => {
    const rows = [
      {
        name: "BAAAAA+NotoSans-Regular",
        type: "CID TrueType",
        embedded: true,
        unicode: true,
      },
      { name: "[none]", type: "Type 3", embedded: true, unicode: true },
    ];
    for (const s of ["Han", "Kana", "Hangul"] as const)
      expect(fontsCarryScript(rows, s)).toBe(true);
    for (const s of [
      "Latin",
      "Cyrillic",
      "Arabic",
      "Bengali",
      "Devanagari",
      "Thai",
    ] as const)
      expect(fontsCarryScript(rows, s)).toBe(false);
    expect(
      fontsCarryScript([rows[0]!, { ...rows[1]!, unicode: false }], "Han"),
    ).toBe(false);
  });

  it("(b) needs every code point of the sample", () => {
    expect(textCarriesSample("বাংলা লেখা", "বাংলা লেখা")).toBe(true);
    expect(textCarriesSample("বাংলা", "বাংলা লেখা")).toBe(false);
  });

  it("(c) looks for ink inside the margins only", () => {
    const width = 100;
    const height = 130;
    const blank = new Uint8Array(width * height).fill(255);
    expect(rasterHasInk({ width, height, pixels: blank })).toBe(false);
    const edge = blank.slice();
    edge[0] = 0; // the corner, inside the margin
    expect(rasterHasInk({ width, height, pixels: edge })).toBe(false);
    const body = blank.slice();
    body[65 * width + 50] = 0;
    expect(rasterHasInk({ width, height, pixels: body })).toBe(true);
  });

  /**
   * The REAL words: `pdftotext -bbox` in the live worker image (2026-11-15)
   * over the probe's Arabic PDF, in the order poppler gave them. Each word's
   * code points are in VISUAL order — "صنلا" is "النص" reversed — and the
   * first logical word sits RIGHT (x=533.9) of the last (x=504.4).
   */
  const REAL_AR_WORDS = [
    { xMin: 504.433576, text: "يبرعلا" },
    { xMin: 533.892762, text: "صنلا" },
    { xMin: 504.433576, text: "يبرعلا" },
    { xMin: 533.892762, text: "صنلا" },
  ];
  const AR_SAMPLE = LANGUAGE_SAMPLES.ar;
  const swapped = (words: typeof REAL_AR_WORDS) =>
    words.map((w) => ({
      ...w,
      xMin: w.xMin === 504.433576 ? 533.892762 : 504.433576,
    }));
  const asBbox = (words: typeof REAL_AR_WORDS) =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>',
      '<doc><page width="612.000000" height="792.000000">',
      ...words.map(
        (w) =>
          `    <word xMin="${w.xMin.toFixed(6)}" yMin="72.000000" xMax="${(w.xMin + 25).toFixed(6)}" yMax="86.000000">${w.text}</word>`,
      ),
      "</page></doc></body></html>",
    ].join(String.fromCharCode(10));

  it("(d) health: the real fixture is the probe's sample, in visual order", () => {
    expect(AR_SAMPLE).toBe("النص العربي");
    const logical = AR_SAMPLE.split(" ");
    expect(REAL_AR_WORDS.map((w) => w.text)).toContain(
      [...logical[0]!].reverse().join(""),
    );
    expect(REAL_AR_WORDS.map((w) => w.text)).toContain(
      [...logical[1]!].reverse().join(""),
    );
    // Neither logical word occurs as-is: this is what the old predicate saw.
    expect(REAL_AR_WORDS.map((w) => w.text)).not.toContain(logical[0]);
    expect(REAL_AR_WORDS.map((w) => w.text)).not.toContain(logical[1]);
  });

  it("(d) the real poppler words, right to left, pass", () => {
    expect(laidOutRightToLeft(REAL_AR_WORDS, AR_SAMPLE)).toBe(true);
  });

  it("(d) positive control: the same words placed left to right fail", () => {
    expect(laidOutRightToLeft(swapped(REAL_AR_WORDS), AR_SAMPLE)).toBe(false);
  });

  it("(d) the composed chain: bbox XHTML → parseBboxWords → the predicate", () => {
    const parsed = parseBboxWords(asBbox(REAL_AR_WORDS));
    expect(parsed).toHaveLength(4);
    expect(laidOutRightToLeft(parsed, AR_SAMPLE)).toBe(true);
    expect(
      laidOutRightToLeft(
        parseBboxWords(asBbox(swapped(REAL_AR_WORDS))),
        AR_SAMPLE,
      ),
    ).toBe(false);
  });

  /**
   * HISTORY (2026-11-15): this was the only (d) case, and it handed the
   * predicate LOGICAL-order words, expecting `true` for the right-to-left
   * placement. Real poppler never returns those (see the real fixture above),
   * so this test pinned the defect: it stayed green while production proved
   * Arabic false on every run.
   *
   * INVERTED, not deleted (review, same day): logical order inside a word
   * means its letters were drawn left to right, which a reader sees reversed,
   * so the same placement with logical-order text is now `false`. It is the
   * one case that sees intra-word letter order: without it, a predicate that
   * accepted logical order again would stay green on every real fixture.
   */
  it("(d) words read back in logical order fail, whatever their placement", () => {
    const sample = "النص العربي";
    expect(
      laidOutRightToLeft(
        [
          { text: "العربي", xMin: 100 },
          { text: "النص", xMin: 200 },
        ],
        sample,
      ),
    ).toBe(false);
    expect(
      laidOutRightToLeft(
        [
          { text: "النص", xMin: 100 },
          { text: "العربي", xMin: 200 },
        ],
        sample,
      ),
    ).toBe(false);
    expect(laidOutRightToLeft([], sample)).toBe(false);
    expect(laidOutRightToLeft(REAL_AR_WORDS, "النص")).toBe(false);
  });
});

describe("one memo, two readers", () => {
  afterEach(() => resetTranslatePdfLanguagesForTests());

  it("is null while proving, the proven set after, and proves once", async () => {
    let runs = 0;
    let release!: (l: TranslateLanguage[]) => void;
    const prove = () => {
      runs += 1;
      return new Promise<TranslateLanguage[]>((r) => (release = r));
    };
    const first = memoTranslatePdfLanguages(prove);
    expect(settledTranslatePdfLanguages()).toBeNull();
    release(["bn", "es"]);
    expect(await first).toEqual(["bn", "es"]);
    expect([...(settledTranslatePdfLanguages() ?? [])]).toEqual(["bn", "es"]);
    expect(await memoTranslatePdfLanguages(prove)).toEqual(["bn", "es"]);
    expect(runs).toBe(1);
  });

  it("a proof that throws proves nothing", async () => {
    expect(
      await memoTranslatePdfLanguages(async () => {
        throw new Error("chromium crashed");
      }),
    ).toEqual([]);
    expect(settledTranslatePdfLanguages()?.size).toBe(0);
  });
});
