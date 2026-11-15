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
  probeTranslatePdfLanguages,
  provesTranslatePdfLanguages,
  rasterHasInk,
  textCarriesSample,
  TranslatePdfProbeCorpusError,
} from "./pdf-capability";
import { renderTranslationPdf } from "./pdf-render";
import { parseBboxWords, type PdfProbeReaders } from "./pdf-readers";
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

/**
 * A stand-in for Chromium + poppler that "prints" what it is given: the text
 * reader returns the document's own text, the font reader reports a Noto face
 * for every script — and a Type 3 face when the text holds a code point no
 * face draws (the PUA), which is what a real print of one looks like.
 */
function stubs(opts: { failRender?: TranslateLanguage; rtl?: boolean } = {}) {
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
  const readers: PdfProbeReaders = {
    fonts: async () => [
      { name: "AAAAAA+NotoSans-Regular", type: "CID TrueType", embedded: true },
      {
        name: "BBBBBB+NotoSansArabic-Regular",
        type: "CID TrueType",
        embedded: true,
      },
      {
        name: "CCCCCC+NotoSansBengali-Regular",
        type: "CID TrueType",
        embedded: true,
      },
      {
        name: "DDDDDD+NotoSansDevanagari-Regular",
        type: "CID TrueType",
        embedded: true,
      },
      {
        name: "EEEEEE+NotoSansThai-Regular",
        type: "CID TrueType",
        embedded: true,
      },
      {
        name: "FFFFFF+NotoSansCJKjp-Regular",
        type: "CID Type 0C",
        embedded: true,
      },
      ...(text().includes(PUA)
        ? [{ name: "[none]", type: "Type 3", embedded: true }]
        : []),
    ],
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
      "fonts",
    );
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
    };
    expect(fontsCarryScript([noto], "Bengali")).toBe(true);
    expect(fontsCarryScript([{ ...noto, embedded: false }], "Bengali")).toBe(
      false,
    );
    expect(
      fontsCarryScript(
        [noto, { name: "x", type: "Type 3", embedded: true }],
        "Bengali",
      ),
    ).toBe(false);
    expect(fontsCarryScript([noto], "Thai")).toBe(false);
    expect(fontsCarryScript([], "Latin")).toBe(false);
    expect(
      fontsCarryScript(
        [{ name: "CCCCCC+DejaVuSans", type: "CID TrueType", embedded: true }],
        "Arabic",
      ),
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
