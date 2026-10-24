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

describe("a typed signature is described as the face it is drawn in", () => {
  it("every offered style embeds a standard face (health check: the faces were read)", () => {
    expect(faces.size).toBe(SIGNATURE_STYLES.length);
    for (const [style, face] of faces) {
      expect(STANDARD_14.has(face), `${style}: ${face}`).toBe(true);
    }
  });

  it("the pattern catches the sentence that shipped, and not the drawn-signature one", () => {
    for (const s of SHIPPED)
      expect(TYPED_LOOKS_HANDWRITTEN.test(s), s).toBe(true);
    expect(
      TYPED_LOOKS_HANDWRITTEN.test(
        "Drawing produces a mark that looks like your handwriting.",
      ),
    ).toBe(false);
  });

  it("no sentence says typing looks handwritten", () => {
    const all = sentences();
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((s) => TYPED_LOOKS_HANDWRITTEN.test(s))).toEqual([]);
  });

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
