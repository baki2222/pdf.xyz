// @vitest-environment node
// @native-canvas
/**
 * The handwriting faces of a typed signature (audit sign-pdf#1), checked at
 * the file a signer downloads — not at the table that describes them.
 *
 * Every style is DISCOVERED from `HANDWRITING_STYLES` / `HANDWRITING_FACES`;
 * nothing below names a face, so a fifth face is held to all of it.
 *
 *  - the table describes the files that ship: version, size, PostScript name
 *    and licence, each read back from the installed package;
 *  - the coverage table is the cmap, re-derived, and every covered letter
 *    shapes to a real glyph (so the export's `.notdef` bound and the panel's
 *    coverage check cannot disagree);
 *  - a typed signature in each style is embedded as that face — `/FontFile2`
 *    present, `/BaseFont` naming it — with its text extractable and no blank
 *    glyph, and its pixels are DRAWN (rasterised with pdf.js and counted);
 *  - a name a face cannot draw falls back to Script's rendering, never to a
 *    `.notdef` box: a Bengali name, and a Latin one with é, ł and ő.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  HANDWRITING_STYLES,
  SIGNATURE_STYLES,
  type SignatureStyle,
} from "./offered-kinds";
import {
  HANDWRITING_FACES,
  HANDWRITING_FACE_LIST,
  handwritingCanDraw,
  handwritingMissing,
  handwritingMissingLabels,
} from "./handwriting";
import { DEFAULT_SIGNATURE_STYLE } from "./signature-style";
import { HANDWRITING_COVERAGE } from "./handwriting-coverage.generated";
import {
  installedPackageVersion,
  notoTtfPath,
  openNotoFont,
  readNotoTtf,
} from "./noto-source";
import { handwritingCoverage } from "../../../scripts/generate-handwriting-coverage";
import { exportEditedPdf } from "./editor-export";
import { typedSignatureObject, withoutHandwritingFor } from "./editor/model";
import { handwritingFor, lineBaseline } from "./editor/text";
import {
  HANDWRITING_REACH,
  handwritingLineHeight,
} from "./handwriting-metrics";
import { proveGlyphs } from "@/tests/unicode-fonts";
import { embedFaceIfDrawable } from "./unicode-font";
import { renderPdfPages, type RenderedPage } from "@/tests/pdf-render";

/** One embedded font of the saved file, as a reader receives it. */
interface FontRecord {
  baseFont: string;
  hasFontFile2: boolean;
}

async function typedPdf(
  style: SignatureStyle,
  text: string,
): Promise<Uint8Array> {
  const blank = await PDFDocument.create();
  blank.addPage([400, 160]);
  const { bytes } = await exportEditedPdf(await blank.save(), [
    typedSignatureObject("t", 0, 20, 50, 360, text, style),
  ]);
  return bytes;
}

async function fontsOf(bytes: Uint8Array): Promise<FontRecord[]> {
  const doc = await PDFDocument.load(bytes);
  const fonts = doc
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("Font"), PDFDict);
  return fonts.entries().map(([, ref]) => {
    const font = doc.context.lookup(ref) as PDFDict;
    const baseFont = String(font.get(PDFName.of("BaseFont"))).replace(
      /^\//,
      "",
    );
    let hasFontFile2 = false;
    const descendants = font.lookup(PDFName.of("DescendantFonts"));
    if (descendants instanceof PDFArray) {
      const cid = doc.context.lookup(descendants.get(0)) as PDFDict;
      const descriptor = cid.lookup(PDFName.of("FontDescriptor"), PDFDict);
      hasFontFile2 = descriptor.get(PDFName.of("FontFile2")) !== undefined;
    }
    return { baseFont, hasFontFile2 };
  });
}

/** Dark pixels (any channel under 128) — the ink the page shows. */
function ink(page: RenderedPage): Uint8Array {
  const out = new Uint8Array(page.width * page.height);
  for (let i = 0; i < out.length; i++) {
    const r = page.data[i * 4]!;
    const g = page.data[i * 4 + 1]!;
    const b = page.data[i * 4 + 2]!;
    out[i] = Math.min(r, g, b) < 128 ? 1 : 0;
  }
  return out;
}

const count = (bits: Uint8Array) => bits.reduce((n, b) => n + b, 0);

/**
 * The face a `/BaseFont` names, without the per-file decorations pdf-lib adds
 * (a subset tag in front, a random suffix behind), so two files can be
 * compared face for face.
 */
const faceName = (baseFont: string) =>
  baseFont.replace(/^[A-Z]{6}[+]/, "").replace(/-[0-9]+$/, "");

async function inkOf(bytes: Uint8Array): Promise<Uint8Array> {
  const [page] = await renderPdfPages(bytes, 800);
  return ink(page!);
}

const LATIN_NAME = "Ada Lovelace";
const BENGALI_NAME = "আডা লভলেস";
/** é is Western European; ł and ő are not (Polish, Hungarian). */
const DIACRITIC_NAME = "Zoé Łukasz Erdős";

describe("the handwriting table describes the files that ship", () => {
  it("is not empty, and every face is an offered style (health check)", () => {
    expect(HANDWRITING_FACE_LIST.length).toBeGreaterThanOrEqual(3);
    expect(HANDWRITING_FACE_LIST.map((f) => f.id)).toEqual([
      ...HANDWRITING_STYLES,
    ]);
    for (const s of HANDWRITING_STYLES)
      expect(SIGNATURE_STYLES as readonly string[]).toContain(s);
  });

  it("records each face's installed version, size and PostScript name", async () => {
    for (const face of HANDWRITING_FACE_LIST) {
      expect(installedPackageVersion(face), face.pkg).toBe(face.version);
      expect(readNotoTtf(face).byteLength, face.file).toBe(face.bytes);
      const font = await openNotoFont(readNotoTtf(face));
      expect(font.postscriptName, face.file).toBe(face.postscriptName);
    }
  });

  it("records the licence the package ships, and only OFL-1.1 or Apache-2.0", () => {
    const shape: Record<string, RegExp> = {
      "OFL-1.1": /SIL Open Font License,? Version 1\.1/i,
      "Apache-2.0": /Apache License\s+Version 2\.0/i,
    };
    for (const face of HANDWRITING_FACE_LIST) {
      const text = readFileSync(
        path.join(path.dirname(notoTtfPath(face)), "..", "LICENSE_FONT"),
        "utf8",
      );
      expect(Object.keys(shape)).toContain(face.license);
      expect(text, `${face.pkg} LICENSE_FONT`).toMatch(shape[face.license]!);
      // Both directions: the file must not ALSO read as the other licence.
      for (const [id, re] of Object.entries(shape))
        if (id !== face.license) expect(text, face.pkg).not.toMatch(re);
    }
  });
});

describe("coverage is the cmap, and the cmap is drawn", () => {
  it("the committed coverage equals the ranges re-derived from each TTF", async () => {
    const derived = await handwritingCoverage();
    expect(Object.keys(derived).sort()).toEqual([...HANDWRITING_STYLES].sort());
    for (const s of HANDWRITING_STYLES) {
      expect(derived[s]!.length, s).toBeGreaterThan(5);
      expect(
        HANDWRITING_COVERAGE[s].map(([a, b]) => [a, b]),
        `${s}: run \`pnpm fonts:handwriting\``,
      ).toEqual(derived[s]);
    }
  });

  it("every covered printable letter shapes to a real glyph, never .notdef", async () => {
    for (const face of HANDWRITING_FACE_LIST) {
      const font = await openNotoFont(readNotoTtf(face));
      const bad: string[] = [];
      let checked = 0;
      for (const [a, b] of HANDWRITING_COVERAGE[face.id]) {
        for (let cp = Math.max(a, 0x21); cp <= b; cp++) {
          if (cp >= 0xd800 && cp <= 0xdfff) continue;
          if ((cp & 0xfffe) === 0xfffe) continue;
          checked++;
          // `layout`, the call pdf-lib and `embedFaceIfDrawable` make.
          const { glyphs } = font.layout(String.fromCodePoint(cp));
          if (glyphs.length === 0 || glyphs.some((g) => g.id === 0))
            bad.push(cp.toString(16));
        }
      }
      expect(checked, face.id).toBeGreaterThan(90);
      expect(bad, face.id).toEqual([]);
    }
  });

  it("a Latin name is drawable in every face; a Bengali one in none", () => {
    for (const s of HANDWRITING_STYLES) {
      expect(handwritingMissing(s, LATIN_NAME), s).toEqual([]);
      expect(handwritingCanDraw(s, BENGALI_NAME), s).toBe(false);
    }
  });
});

describe("a typed signature in each handwriting style is that face in the PDF", () => {
  for (const style of HANDWRITING_STYLES) {
    it(`${style}: embedded, named, extractable, drawn`, async () => {
      const face = HANDWRITING_FACES[style];
      const bytes = await typedPdf(style, LATIN_NAME);

      const fonts = await fontsOf(bytes);
      expect(fonts, style).toHaveLength(1);
      expect(fonts[0]!.baseFont, style).toContain(face.postscriptName);
      expect(fonts[0]!.hasFontFile2, style).toBe(true);

      const proof = await proveGlyphs(bytes);
      expect(proof.embeddedFonts).toBe(1);
      expect(proof.extractedText).toBe(LATIN_NAME);
      expect(proof.notdefIds).toEqual([]);
      expect(proof.emptyOutlineIds).toEqual([]);
      expect(proof.untranslatableIds).toEqual([]);

      // Pixels: the face is DRAWN, and it is not Script's Times Italic.
      const hand = await inkOf(bytes);
      const script = await inkOf(await typedPdf("signature", LATIN_NAME));
      expect(count(hand), `${style} ink`).toBeGreaterThan(400);
      let differ = 0;
      for (let i = 0; i < hand.length; i++) if (hand[i] !== script[i]) differ++;
      expect(differ / count(hand), `${style} vs Script`).toBeGreaterThan(0.3);
    }, 60_000);
  }

  it("the ink instrument sees nothing on a blank page and something under Script (controls)", async () => {
    const blank = await PDFDocument.create();
    blank.addPage([400, 160]);
    const empty = await inkOf(await blank.save());
    expect(count(empty)).toBe(0);
    const script = await inkOf(await typedPdf("signature", LATIN_NAME));
    expect(count(script)).toBeGreaterThan(400);
  }, 60_000);
});

describe("a name a face cannot draw is set as Script sets it, never as a blank", () => {
  it("a Bengali name: the upright Noto face in every handwriting style", async () => {
    const scriptBytes = await typedPdf("signature", BENGALI_NAME);
    const script = await fontsOf(scriptBytes);
    expect(script[0]!.baseFont).toMatch(/Noto/);
    // Bengali is shaped (a pre-base vowel sign is drawn before its
    // consonant), so the text reads back in GLYPH order — the same order
    // Script's file reads back in, which is the claim: set as Script sets it.
    const scriptText = (await proveGlyphs(scriptBytes)).extractedText;
    expect([...scriptText].sort()).toEqual([...BENGALI_NAME].sort());
    for (const style of HANDWRITING_STYLES) {
      expect(handwritingFor({ hand: style }, BENGALI_NAME), style).toBeNull();
      const bytes = await typedPdf(style, BENGALI_NAME);
      const fonts = await fontsOf(bytes);
      expect(
        fonts.map((f) => faceName(f.baseFont)),
        style,
      ).toEqual(script.map((f) => faceName(f.baseFont)));
      const proof = await proveGlyphs(bytes);
      expect(proof.notdefIds, style).toEqual([]);
      expect(proof.emptyOutlineIds, style).toEqual([]);
      expect(proof.extractedText, style).toBe(scriptText);
    }
  }, 120_000);

  it("é, ł and ő: drawn by every face that has them, Script's rendering for one that lacks ő", async () => {
    const lacking = HANDWRITING_STYLES.filter(
      (s) => !handwritingCanDraw(s, DIACRITIC_NAME),
    );
    const having = HANDWRITING_STYLES.filter((s) =>
      handwritingCanDraw(s, DIACRITIC_NAME),
    );
    // Both arms must be exercised, or this proves only one of them.
    expect(lacking.length).toBeGreaterThan(0);
    expect(having.length).toBeGreaterThan(0);
    for (const s of lacking)
      expect(handwritingMissing(s, DIACRITIC_NAME), s).not.toContain("é");

    const scriptFonts = await fontsOf(
      await typedPdf("signature", DIACRITIC_NAME),
    );
    for (const style of HANDWRITING_STYLES) {
      const bytes = await typedPdf(style, DIACRITIC_NAME);
      const fonts = await fontsOf(bytes);
      expect(fonts, style).toHaveLength(1);
      if (having.includes(style)) {
        expect(fonts[0]!.baseFont, style).toContain(
          HANDWRITING_FACES[style].postscriptName,
        );
      } else {
        expect(faceName(fonts[0]!.baseFont), style).toBe(
          faceName(scriptFonts[0]!.baseFont),
        );
      }
      const proof = await proveGlyphs(bytes);
      expect(proof.notdefIds, style).toEqual([]);
      expect(proof.emptyOutlineIds, style).toEqual([]);
      expect(proof.extractedText, style).toBe(DIACRITIC_NAME);
    }
  }, 120_000);
});

describe("Script and Print are placed exactly as before; a picked font leaves the face", () => {
  it("Script is Times Italic and Print Helvetica, with no handwriting face", () => {
    const script = typedSignatureObject("s", 0, 0, 0, 100, "Ada", "signature");
    const print = typedSignatureObject("p", 0, 0, 0, 100, "Ada", "print");
    expect(script).toMatchObject({ font: "times", italic: true, bold: false });
    expect(print).toMatchObject({
      font: "helvetica",
      italic: false,
      bold: false,
    });
    expect("hand" in script).toBe(false);
    expect("hand" in print).toBe(false);
  });

  it("a handwriting style carries its face over Script's font and slant", () => {
    for (const style of HANDWRITING_STYLES) {
      expect(
        typedSignatureObject("h", 0, 0, 0, 100, "Ada", style),
        style,
      ).toMatchObject({ font: "times", italic: true, hand: style });
    }
  });

  it("a font, weight or slant choice takes the box out of its face; colour or size does not", () => {
    expect(withoutHandwritingFor({ font: "helvetica" })).toBe(true);
    expect(withoutHandwritingFor({ bold: true })).toBe(true);
    expect(withoutHandwritingFor({ italic: false })).toBe(true);
    expect(withoutHandwritingFor({ color: "#000000" })).toBe(false);
    expect(withoutHandwritingFor({ size: 30 })).toBe(false);
  });
});

describe("the export's second bound: the face is shaped before it is embedded", () => {
  it("embedFaceIfDrawable declines a name with a letter the face lacks, and embeds one it has", async () => {
    const lacking = HANDWRITING_FACE_LIST.find(
      (f) => !handwritingCanDraw(f.id, DIACRITIC_NAME),
    )!;
    expect(lacking).toBeDefined();
    const doc = await PDFDocument.create();
    expect(
      await embedFaceIfDrawable(doc, lacking, [DIACRITIC_NAME]),
    ).toBeNull();
    expect(
      await embedFaceIfDrawable(doc, lacking, [LATIN_NAME]),
    ).not.toBeNull();
  });
});

/*
 * Review of sign-pdf#1: a name pasted in decomposed form (e + U+0301) passed
 * the coverage check — Dancing Script's cmap has U+0301 — and pdf-lib, which
 * draws advances only, put the accent BESIDE the e. A no-break space knocked
 * a whole name out of Mr Dafoe. The text is now NFC with plain spaces at the
 * source (`typedSignatureText`), and a combining mark that survives NFC is
 * never drawn by a handwriting face. Held at the pixels a reader sees.
 */
describe("a name is drawn as its letters, however it was typed or pasted", () => {
  const COMPOSED = "José Zoé Muñoz Weiß";
  const DECOMPOSED = COMPOSED.normalize("NFD");

  it("the decomposed form really is different text (health check)", () => {
    expect(DECOMPOSED).not.toBe(COMPOSED);
    expect(DECOMPOSED.length).toBeGreaterThan(COMPOSED.length);
  });

  for (const style of SIGNATURE_STYLES) {
    it(`${style}: e + U+0301 is drawn pixel for pixel as é`, async () => {
      const composed = await typedPdf(style, COMPOSED);
      const decomposed = await typedPdf(style, DECOMPOSED);
      expect(
        (await fontsOf(decomposed)).map((f) => faceName(f.baseFont)),
      ).toEqual((await fontsOf(composed)).map((f) => faceName(f.baseFont)));
      const a = await inkOf(composed);
      const b = await inkOf(decomposed);
      expect(count(a), style).toBeGreaterThan(400);
      let differ = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
      expect(differ, style).toBe(0);
    }, 60_000);
  }

  it("signPdf draws a decomposed name exactly as the composed one", async () => {
    const { signPdf } = await import("./signature");
    const blank = await PDFDocument.create();
    blank.addPage([400, 160]);
    const src = await blank.save();
    const sign = (text: string) =>
      signPdf(
        src,
        { kind: "typed", text, style: DEFAULT_SIGNATURE_STYLE },
        { pageIndex: 0, position: "middle-center", width: 300 },
      );
    const a = await inkOf(await sign(COMPOSED));
    const b = await inkOf(await sign(DECOMPOSED));
    expect(count(a)).toBeGreaterThan(400);
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
    expect(differ).toBe(0);
  }, 60_000);

  it("a mark with no precomposed letter is never drawn by a handwriting face", async () => {
    const name = "Jaq\u0303 Lovelace"; // q + combining tilde: NFC keeps two
    expect(name.normalize("NFC")).toBe(name);
    for (const style of HANDWRITING_STYLES) {
      expect(handwritingMissing(style, name), style).toEqual(["\u0303"]);
      expect(handwritingFor({ hand: style }, name), style).toBeNull();
      const fonts = await fontsOf(await typedPdf(style, name));
      for (const f of fonts)
        expect(f.baseFont, style).not.toContain(
          HANDWRITING_FACES[style].postscriptName,
        );
    }
  }, 120_000);

  it("a no-break space is a space: the name stays in its face", async () => {
    const plain = "Ada Lovelace";
    const pasted = "Ada\u00a0Lovelace";
    for (const style of HANDWRITING_STYLES) {
      const a = await typedPdf(style, plain);
      const b = await typedPdf(style, pasted);
      const fonts = await fontsOf(b);
      expect(fonts, style).toHaveLength(1);
      expect(fonts[0]!.baseFont, style).toContain(
        HANDWRITING_FACES[style].postscriptName,
      );
      const inkA = await inkOf(a);
      const inkB = await inkOf(b);
      let differ = 0;
      for (let i = 0; i < inkA.length; i++) if (inkA[i] !== inkB[i]) differ++;
      expect(differ, style).toBe(0);
    }
  }, 120_000);

  it("what a face lacks is said readably: a script by name, an invisible or combining character by code point", () => {
    for (const style of HANDWRITING_STYLES) {
      expect(handwritingMissingLabels(style, BENGALI_NAME), style).toEqual([
        "Bengali letters",
      ]);
      expect(handwritingMissingLabels(style, "Jaq\u0303"), style).toEqual([
        "U+0303",
      ]);
      expect(handwritingMissingLabels(style, "Ada\u00a0L"), style).toEqual(
        handwritingMissing(style, "Ada\u00a0L").length ? ["U+00A0"] : [],
      );
    }
    // A Latin letter a face lacks is itself (Mr Dafoe and Homemade Apple
    // have no ő), and a face that has the letter lists nothing.
    const lacking = HANDWRITING_STYLES.filter(
      (s) => handwritingMissing(s, "ő").length,
    );
    expect(lacking.length).toBeGreaterThan(0);
    for (const s of lacking)
      expect(handwritingMissingLabels(s, "Erdős"), s).toEqual(["ő"]);
  });
});

/*
 * Review of sign-pdf#1: a typed signature's box was size x 1.2 tall in every
 * face, and Homemade Apple's descenders hung ~15 pt below it — so a box the
 * export accepted at the page's bottom edge lost a quarter of its ink.
 */
describe("a typed signature's box holds all of its ink", () => {
  it("HANDWRITING_REACH is each TTF's own head box and line-box metrics", async () => {
    for (const face of HANDWRITING_FACE_LIST) {
      const font = (await openNotoFont(readNotoTtf(face))) as unknown as {
        unitsPerEm: number;
        ascent: number;
        descent: number;
        bbox: { minY: number; maxY: number };
        "OS/2": { winAscent: number; winDescent: number };
      };
      const em = (u: number) => u / font.unitsPerEm;
      const derived = {
        ink: { above: em(font.bbox.maxY), below: em(-font.bbox.minY) },
        lineBox: {
          above: em(Math.max(font.ascent, font["OS/2"].winAscent)),
          below: em(Math.max(-font.descent, font["OS/2"].winDescent)),
        },
      };
      const recorded = HANDWRITING_REACH[face.id];
      for (const k of ["ink", "lineBox"] as const)
        for (const side of ["above", "below"] as const) {
          const d = derived[k][side];
          const r = recorded[k][side];
          // Recorded to 0.001, rounded UP: never short of the face.
          expect(r, `${face.id} ${k}.${side}`).toBeGreaterThanOrEqual(d);
          expect(r - d, `${face.id} ${k}.${side}`).toBeLessThan(0.001);
        }
    }
  });

  it("each handwriting style's line height clears its ink with the baseline where the export puts it", () => {
    for (const style of HANDWRITING_STYLES) {
      const L = handwritingLineHeight(style);
      const { above, below } = HANDWRITING_REACH[style].ink;
      const baseline = lineBaseline(0, { size: 1, lineHeight: L });
      expect(baseline, style).toBeGreaterThanOrEqual(above);
      expect(L - baseline, style).toBeGreaterThanOrEqual(below);
      expect(
        typedSignatureObject("t", 0, 0, 0, 100, "Ada", style).lineHeight,
      ).toBe(L);
    }
    // Health check: at least one face needs more than every other box gets.
    expect(
      Math.max(...HANDWRITING_STYLES.map(handwritingLineHeight)),
    ).toBeGreaterThan(1.2);
  });

  /** Rows (1 px = 1 pt) that hold ink, as [first, last]. */
  function inkRows(page: RenderedPage): [number, number] | null {
    const bits = ink(page);
    let first = -1;
    let last = -1;
    for (let y = 0; y < page.height; y++) {
      for (let x = 0; x < page.width; x++) {
        if (bits[y * page.width + x]) {
          if (first < 0) first = y;
          last = y;
          break;
        }
      }
    }
    return first < 0 ? null : [first, last];
  }

  const DEEP = "Jágy Pöqfly Jeffrey ÅÉ";

  for (const style of SIGNATURE_STYLES) {
    it(`${style}: every row of ink is inside the box the export accepted`, async () => {
      const blank = await PDFDocument.create();
      blank.addPage([600, 300]);
      const obj = typedSignatureObject("t", 0, 20, 120, 560, DEEP, style);
      const { bytes } = await exportEditedPdf(await blank.save(), [obj]);
      const [page] = await renderPdfPages(bytes, 600);
      expect(page!.width).toBe(600);
      const rows = inkRows(page!);
      expect(rows, style).not.toBeNull();
      const top = obj.y;
      const bottom = obj.y + obj.size * obj.lineHeight;
      // One pixel of antialiasing either side.
      expect(rows![0], `${style} ink top`).toBeGreaterThanOrEqual(
        Math.floor(top) - 1,
      );
      expect(rows![1], `${style} ink bottom`).toBeLessThanOrEqual(
        Math.ceil(bottom) + 1,
      );
    }, 60_000);
  }

  it("a box touching the page's bottom edge keeps all its ink (the reviewer's case)", async () => {
    for (const style of HANDWRITING_STYLES) {
      const at = async (pageHeight: number) => {
        const probe = typedSignatureObject(
          "p",
          0,
          0,
          0,
          560,
          "Jeffrey Pyg",
          style,
        );
        const h = probe.size * probe.lineHeight;
        const blank = await PDFDocument.create();
        blank.addPage([600, pageHeight]);
        const obj = typedSignatureObject(
          "c",
          0,
          20,
          100 - h,
          560,
          "Jeffrey Pyg",
          style,
        );
        const { bytes } = await exportEditedPdf(await blank.save(), [obj]);
        const [page] = await renderPdfPages(bytes, Math.max(600, pageHeight));
        return count(ink(page!));
      };
      const short = await at(100);
      const tall = await at(200);
      expect(short, style).toBeGreaterThan(200);
      // The short page cuts nothing the tall page shows (antialiasing aside).
      expect(short / tall, style).toBeGreaterThan(0.99);
    }
  }, 120_000);
});
