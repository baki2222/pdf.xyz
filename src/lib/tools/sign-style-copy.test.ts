// @vitest-environment node
/**
 * What the Sign pages say a TYPED signature looks like, held to the face the
 * engine draws it in.
 *
 * WHAT SHIPPED. The Sign guide said the “Script” style "gives a typed name a
 * handwritten look without any drawing at all", and the tool page counted five
 * ways to sign, one of them a "print-and-scan style" the runner never had
 * (fixed earlier: the count is now built from SIGNATURE_SOURCES). The Script
 * style is `signature.ts`' `serif-italic` face — Times-Italic on the path every
 * Latin name takes — which is an italic serif, not handwriting.
 *
 * The check RUNS `signPdf` with a typed Latin name in every offered style and
 * reads the BaseFont out of the file it writes. The copy may say "italic serif"
 * only while the Script style embeds an italic Times face, and no sentence may
 * say typing gives a handwritten look while no offered style embeds anything
 * but a standard PDF face. Drawn signatures DO look like handwriting; the
 * pattern is scoped to sentences about typing, and the shipped sentence is its
 * corpus. No automatic exit: shipping a handwriting face means deciding, here,
 * what the copy may then say.
 *
 * DECIDED 2026-11-09 (audit sign-pdf#1): handwriting faces shipped. The
 * styles are DISCOVERED from `SIGNATURE_STYLES`, and which of them are
 * handwriting from `isHandwritingStyle` / `HANDWRITING_FACES` — nothing here
 * names a face. What the copy may now say, each half tied to the file the
 * export writes:
 *  - typing MAY be said to look handwritten, but only in a sentence that
 *    gives that look to the handwriting faces, by name, and only while every
 *    handwriting style embeds its own face (`/BaseFont` = the face's
 *    PostScript name, never a standard-14 font);
 *  - the Script style may still NEVER be said to look handwritten: it is
 *    still Times Italic. The sentence that shipped saying so stays the
 *    corpus of that ban, and the ban must not catch the sentence that now
 *    ships;
 *  - every handwriting style is NAMED by the page and its guides, by its
 *    label, so a face added to the panel cannot go unmentioned.
 * The tests that pinned "only Script and Print" are inverted below, with
 * their history, not deleted.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { exportEditedPdf } from "@/lib/pdf/editor-export";
import { typedSignatureObject } from "@/lib/pdf/editor/model";
import {
  SIGNATURE_STYLES,
  SIGNATURE_STYLE_LABEL,
  type SignatureStyle,
} from "@/lib/pdf/offered-kinds";
import { isHandwritingStyle } from "@/lib/pdf/signature-style";
import { HANDWRITING_FACES } from "@/lib/pdf/handwriting";
import { SUPPORTED_SCRIPTS } from "@/lib/pdf/font-packs";
import { guides } from "@/lib/guides/catalog";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

/** The fourteen fonts every PDF reader has; none of them is handwriting. */
const STANDARD_14 = new Set([
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
  "Symbol",
  "ZapfDingbats",
]);

async function typedFace(
  style: SignatureStyle,
  text = "Ada Lovelace",
): Promise<string> {
  const blank = await PDFDocument.create();
  blank.addPage([400, 300]);
  // Until 2026-10-24 this ran `signPdf`, the Sign PDF form's engine. The
  // page now places a typed signature as the editor's text object
  // (`typedSignatureObject`) and writes it with `exportEditedPdf`, so the
  // face is read out of THAT file.
  const { bytes } = await exportEditedPdf(await blank.save(), [
    typedSignatureObject("t", 0, 20, 200, 360, text, style),
  ]);
  const out = await PDFDocument.load(bytes);
  const fonts = out
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("Font"), PDFDict);
  const names = fonts
    .entries()
    .map(([, ref]) =>
      String((out.context.lookup(ref) as PDFDict).get(PDFName.of("BaseFont"))),
    )
    .map((n) => n.replace(/^\//, ""));
  expect(names, style).toHaveLength(1);
  return names[0]!;
}

/** A typed name outside the Western European alphabet. */
const BENGALI_NAME = "আডা লভলেস";

let pages: Map<string, RenderedToolPage>;
const faces = new Map<SignatureStyle, string>();
const nonLatinFaces = new Map<SignatureStyle, string>();

beforeAll(async () => {
  pages = renderToolPages();
  for (const style of SIGNATURE_STYLES) {
    faces.set(style, await typedFace(style));
    nonLatinFaces.set(style, await typedFace(style, BENGALI_NAME));
  }
}, 180_000);

/** Every sentence a reader meets about Sign PDF: the served page and its guides. */
function sentences(): string[] {
  const served = pages.get("sign-pdf");
  if (!served) throw new Error("sign-pdf was not rendered");
  const guideText = guides
    .filter((g) => g.tools.includes("sign-pdf"))
    .flatMap((g) => [
      ...g.intro,
      ...g.steps,
      ...g.sections.flatMap((s) => s.body),
      ...g.faq.map((f) => f.answer),
    ]);
  return [served.text, ...served.faq.map((e) => e.answer), ...guideText]
    .flatMap((t) => t.split(/(?<=[.!?])\s+/))
    .filter(Boolean);
}

const SHIPPED = [
  "Typing is the fastest option, and it comes in two styles — script, which gives a typed name a handwritten look without any drawing at all, and print, a plain printed name.",
];
const TYPED_LOOKS_HANDWRITTEN =
  /\b(?:typ(?:e|ed|ing)|script)\b[^.]*\bhandwrit/i;

/**
 * The Script STYLE (not "Dancing Script") given a handwritten look. Its
 * corpus is the sentence that shipped (`SHIPPED`); it must not catch the
 * sentence that ships now, which names Script right after the faces that do
 * look handwritten.
 */
const SCRIPT_LOOKS_HANDWRITTEN =
  /(?<!Dancing )\bscript\b,?\s+which\b[^.;]*\bhandwrit/i;

const handwritingStyles = SIGNATURE_STYLES.filter(isHandwritingStyle);
const standardStyles = SIGNATURE_STYLES.filter((s) => !isHandwritingStyle(s));

describe("a typed signature is described as the face it is drawn in", () => {
  /*
   * INVERTED 2026-11-09. Was "every offered style embeds a standard face":
   * true while Script and Print were the only styles, and the premise of the
   * old "no sentence says typing looks handwritten" ban. Now the standard
   * styles still embed a standard-14 face, and every handwriting style embeds
   * ITS face, read from the file.
   */
  it("each style embeds its own face: standard-14 for Script and Print, the handwriting face for the rest (health check: the faces were read)", () => {
    expect(faces.size).toBe(SIGNATURE_STYLES.length);
    expect(handwritingStyles.length).toBeGreaterThanOrEqual(3);
    expect(standardStyles.length).toBe(2);
    for (const style of standardStyles) {
      const face = faces.get(style)!;
      expect(STANDARD_14.has(face), `${style}: ${face}`).toBe(true);
    }
    for (const style of handwritingStyles) {
      const face = faces.get(style)!;
      expect(STANDARD_14.has(face), `${style}: ${face}`).toBe(false);
      expect(face, style).toContain(HANDWRITING_FACES[style].postscriptName);
    }
  });

  it("the patterns catch the sentence that shipped, and not the drawn-signature one", () => {
    for (const s of SHIPPED) {
      expect(TYPED_LOOKS_HANDWRITTEN.test(s), s).toBe(true);
      expect(SCRIPT_LOOKS_HANDWRITTEN.test(s), s).toBe(true);
    }
    for (const re of [TYPED_LOOKS_HANDWRITTEN, SCRIPT_LOOKS_HANDWRITTEN])
      expect(
        re.test("Drawing produces a mark that looks like your handwriting."),
      ).toBe(false);
  });

  /*
   * INVERTED 2026-11-09. Was "no sentence says typing looks handwritten",
   * whose premise (no style embeds anything but a standard face) the test
   * above now refutes from the file. A sentence MAY say it, if it gives the
   * look to the handwriting faces by name, and at least one must, or the
   * panel's best feature goes unmentioned.
   */
  it("a sentence that says typing looks handwritten gives that look to the handwriting faces, by name", () => {
    const all = sentences();
    expect(all.length).toBeGreaterThan(20);
    const claims = all.filter((s) => TYPED_LOOKS_HANDWRITTEN.test(s));
    expect(
      claims.length,
      "no sentence says typing can look handwritten",
    ).toBeGreaterThan(0);
    for (const s of claims) {
      expect(s, "a handwritten claim that is not about the faces").toMatch(
        /handwriting (?:face|font|style)/i,
      );
      for (const style of handwritingStyles)
        expect(s).toContain(SIGNATURE_STYLE_LABEL[style]);
    }
  });

  it("the Script style is never said to look handwritten: it is still an italic serif", () => {
    expect(sentences().filter((s) => SCRIPT_LOOKS_HANDWRITTEN.test(s))).toEqual(
      [],
    );
  });

  it("the page and its guides name every handwriting style the panel offers", () => {
    const text = sentences().join(" ");
    for (const style of handwritingStyles)
      expect(text, style).toContain(SIGNATURE_STYLE_LABEL[style]);
  });

  it("a name in any other script takes the one upright Noto face in every handwriting style too, for a real name per script", async () => {
    // A sample per non-Latin script the product draws, keyed by the script
    // so a script added to SUPPORTED_SCRIPTS with no sample fails here.
    const SAMPLE: Record<string, string> = {
      Greek: "Αλέξανδρος Παππάς",
      Cyrillic: "Анна Павлова",
      Devanagari: "अनन्या शर्मा",
      Bengali: BENGALI_NAME,
      Hiragana: "さくら",
      Katakana: "サクラ",
      Kanji: "山田花子",
      Hangul: "김민준",
      Han: "王小明",
    };
    const others = SUPPORTED_SCRIPTS.filter((s) => s !== "Latin");
    expect(others.length).toBeGreaterThan(4);
    for (const script of others) {
      const name = SAMPLE[script];
      expect(name, `no sample name for ${script}`).toBeDefined();
      for (const style of handwritingStyles) {
        const face = await typedFace(style, name!);
        expect(face, `${script} in ${style}`).toMatch(/Noto/);
      }
    }
  }, 300_000);

  it("where the copy describes the Script style's face, it is the face embedded", () => {
    const script = SIGNATURE_STYLES.find(
      (s) => SIGNATURE_STYLE_LABEL[s] === "Script",
    )!;
    const face = faces.get(script)!;
    const described = sentences().filter((s) => /italic serif/i.test(s));
    expect(
      described.length,
      "no sentence names the Script face",
    ).toBeGreaterThan(0);
    expect(face).toMatch(/^Times-.*Italic$/);
  });

  /*
   * HISTORY: the guide said script "sets your typed name in an italic serif
   * face", and the check above typed only "Ada Lovelace". A name outside the
   * Western European alphabet takes the Unicode path, where every style
   * resolves to the same upright Noto face — so the sentence was true of the
   * one name the test tried. Run with a Bengali name, it must now say so.
   */
  it("a name in another script: one upright face in every style, and the copy scopes its italic claim", () => {
    // Health check: the Unicode path ran, and it is not the Latin face.
    for (const [style, face] of nonLatinFaces) {
      expect(face, style).toMatch(/Noto/);
      expect(face, style).not.toMatch(/Italic/i);
    }
    expect(new Set(nonLatinFaces.values()).size).toBe(1);
    const described = sentences().filter((s) => /italic serif/i.test(s));
    expect(described.length).toBeGreaterThan(0);
    for (const s of described) expect(s).toMatch(/Western European alphabet/);
    expect(
      sentences().some((s) => /other script[^.]*upright face/i.test(s)),
      "no sentence says what a name in another script looks like",
    ).toBe(true);
  });
});
