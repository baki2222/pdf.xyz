/**
 * The handwriting faces a typed signature can be set in, and which letters
 * each one can draw (audit sign-pdf#1, 2026-11-09).
 *
 * Pure: no pdf-lib, no DOM, no fetch — the signature panel, the overlay, the
 * export, the copy step and the guards all read this one table.
 *
 * WHY THESE ARE NOT FONT PACKS. A pack (`font-packs.ts`) is chosen by the
 * LETTERS of a string — Bengali text goes to the Bengali face whatever the
 * caller asked for. A handwriting face is chosen by the STYLE a signer picked
 * and by nothing else, so it must never enter that routing: a Polish
 * watermark set in Alex Brush because Alex Brush happens to have an Ł would
 * be a typeface nobody asked for. They share only the delivery — an npm package,
 * copied into `public/fonts/<version>/` by `scripts/copy-noto-fonts.ts`,
 * fetched from our own origin on demand (`ShippedFace`).
 *
 * THE TWO BOUNDS, as for the packs:
 *  1. Coverage is not typed here. `handwriting-coverage.generated.ts` is
 *     derived from each TTF's own cmap, and `handwriting.test.ts` re-derives
 *     it from the installed files and fails on any difference.
 *  2. A cmap hit is not a drawn glyph. The export shapes the real text after
 *     the bytes arrive and falls back on any `.notdef`
 *     (`embedFaceIfDrawable` in `unicode-font.ts`).
 *
 * WHAT A FACE THAT CANNOT DRAW A NAME DOES. It is never asked to: the name is
 * set exactly as the Script style sets it (Times Italic for Western European
 * letters, the upright Noto face for any other script — `faceFor` in
 * `editor/text.ts`), and the panel says which letters the face lacks. No
 * `.notdef` box, no dropped letter, no refusal for a name Script can draw.
 */
import {
  HANDWRITING_STYLES,
  SIGNATURE_STYLE_LABEL,
  type HandwritingStyle,
} from "./offered-kinds";
import type { ShippedFace } from "./font-packs";
import { HANDWRITING_COVERAGE } from "./handwriting-coverage.generated";

export interface HandwritingFace extends ShippedFace {
  readonly id: HandwritingStyle;
  /**
   * The face's PostScript name (its `name` table, read back by
   * `handwriting.test.ts`). pdf-lib writes it, behind a subset tag, as the
   * embedded font's `/BaseFont`, which is how a test of the saved PDF knows
   * WHICH face was embedded.
   */
  readonly postscriptName: string;
  /**
   * The licence the package ships the face under, read back from the
   * package's `LICENSE_FONT` by `handwriting.test.ts`. Only these two are
   * allowed: both permit redistributing the font and embedding it in a
   * document.
   */
  readonly license: "OFL-1.1" | "Apache-2.0";
}

const face = (
  id: HandwritingStyle,
  pkg: string,
  file: string,
  version: string,
  bytes: number,
  postscriptName: string,
  license: HandwritingFace["license"],
): HandwritingFace => ({
  id,
  label: SIGNATURE_STYLE_LABEL[id],
  pkg,
  dir: "400Regular",
  file,
  version,
  bytes,
  postscriptName,
  license,
});

export const HANDWRITING_FACES: Record<HandwritingStyle, HandwritingFace> = {
  "dancing-script": face(
    "dancing-script",
    "@expo-google-fonts/dancing-script",
    "DancingScript_400Regular.ttf",
    "0.4.2",
    81140,
    "DancingScript-Regular",
    "OFL-1.1",
  ),
  "alex-brush": face(
    "alex-brush",
    "@expo-google-fonts/alex-brush",
    "AlexBrush_400Regular.ttf",
    "0.4.1",
    115420,
    "AlexBrush-Regular",
    "OFL-1.1",
  ),
  "mr-dafoe": face(
    "mr-dafoe",
    "@expo-google-fonts/mr-dafoe",
    "MrDafoe_400Regular.ttf",
    "0.4.1",
    46620,
    "MrDafoe-Regular",
    "OFL-1.1",
  ),
  "homemade-apple": face(
    "homemade-apple",
    "@expo-google-fonts/homemade-apple",
    "HomemadeApple_400Regular.ttf",
    "0.4.1",
    109044,
    "HomemadeApple-Regular",
    "Apache-2.0",
  ),
};

/** Every handwriting face, in the order the panel offers them. */
export const HANDWRITING_FACE_LIST: readonly HandwritingFace[] =
  HANDWRITING_STYLES.map((s) => HANDWRITING_FACES[s]);

/** Line breaks and tabs are layout, not glyphs (as in `embedDrawingFont`). */
function drawnText(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ");
}

function covers(style: HandwritingStyle, cp: number): boolean {
  const ranges = HANDWRITING_COVERAGE[style];
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * The distinct characters of `text` the face has no glyph for, in the order
 * they first appear — empty when the face can draw all of it.
 */
export function handwritingMissing(
  style: HandwritingStyle,
  text: string,
): string[] {
  const missing: string[] = [];
  for (const ch of drawnText(text)) {
    if (!covers(style, ch.codePointAt(0)!) && !missing.includes(ch))
      missing.push(ch);
  }
  return missing;
}

/** Can this face draw every character of `text`? */
export function handwritingCanDraw(
  style: HandwritingStyle,
  text: string,
): boolean {
  return handwritingMissing(style, text).length === 0;
}
