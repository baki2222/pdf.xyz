/**
 * A typed signature as the editor places it, and the one rule that takes a
 * box out of its handwriting face.
 *
 * Kept out of `model.ts` on purpose: that module is in the FIRST load of
 * Sign PDF, Edit PDF, Annotate and Create Forms (the history labels and the
 * object kinds are read before a file is open), while the only caller here
 * is the editor itself (`wysiwyg-editor.tsx`), which loads lazily once a
 * file is opened. In `model.ts` the NFC normalisation, the style predicates
 * and each face's ink reach (`handwriting-metrics.ts`) rode along in that
 * first load on four pages, +480 B gzip on Sign PDF, for code nothing runs
 * until a signature is placed. `src/deploy/bundle-budget.test.ts` holds the
 * pages' weight, not this comment.
 */
import { type SignatureStyle } from "../offered-kinds";
import { isHandwritingStyle, typedSignatureText } from "../signature-style";
import {
  DEFAULT_LINE_HEIGHT,
  handwritingLineHeight,
} from "../handwriting-metrics";
import {
  SIGNATURE_INK,
  TYPED_SIGNATURE_SIZE,
  type TextBoxObject,
} from "./model";

/**
 * A typed signature as the editor places it: a one-line text box in the
 * style's face — a handwriting style is its own face (`hand`), Script is
 * Times Italic, Print is Helvetica, the faces Sign PDF's copy names
 * (`sign-style-copy.test.ts` reads them back out of the export). A
 * handwriting box carries Script's font and slant underneath, so a name the
 * face cannot draw is set exactly as Script would set it. Text in another
 * script takes the one upright Noto face, as every text box does. `color` is
 * the ink chosen in the signature panel (`./signature-ink`); left out, it is
 * the ink Sign PDF has always used.
 */
export function typedSignatureObject(
  id: string,
  page: number,
  x: number,
  y: number,
  width: number,
  text: string,
  style: SignatureStyle,
  color: string = SIGNATURE_INK,
): TextBoxObject {
  return {
    id,
    kind: "text",
    page,
    x,
    y,
    width,
    // NFC with plain spaces, so a pasted "e + U+0301" or no-break space is
    // checked, embedded and drawn as the one letter it is.
    text: typedSignatureText(text),
    font: style === "print" ? "helvetica" : "times",
    italic: style !== "print",
    bold: false,
    size: TYPED_SIGNATURE_SIZE,
    color,
    align: "left",
    // A handwriting face's box is as tall as its ink, so a signature whose
    // box sits inside the page has every descender inside it too.
    lineHeight: isHandwritingStyle(style)
      ? handwritingLineHeight(style)
      : DEFAULT_LINE_HEIGHT,
    ...(isHandwritingStyle(style) ? { hand: style } : {}),
  };
}

/**
 * Whether a style patch takes a text box out of its handwriting face: any
 * choice of font, weight or slant is a choice of a face the Font menu names,
 * and the box must then be drawn in it.
 */
export function withoutHandwritingFor(patch: object): boolean {
  return "font" in patch || "bold" in patch || "italic" in patch;
}
