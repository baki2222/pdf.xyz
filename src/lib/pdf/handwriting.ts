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

/** A combining mark: drawn only where something positions it. */
const MARK = /\p{M}/u;

/**
 * The distinct characters of `text` the face cannot draw, in the order they
 * first appear — empty when the face can draw all of it.
 *
 * A combining mark (`\p{M}`) counts as one the face cannot draw even where
 * its cmap has it: pdf-lib draws glyph advances only and applies no mark
 * positioning, so Dancing Script's U+0301 (advance 0, ink to the RIGHT of
 * the pen) lands beside the letter, not over it (review of sign-pdf#1).
 * Callers pass `typedSignatureText`, whose NFC composes every mark that has
 * a precomposed letter; one that has none falls back to Script's rendering
 * rather than being misdrawn.
 */
export function handwritingMissing(
  style: HandwritingStyle,
  text: string,
): string[] {
  const missing: string[] = [];
  for (const ch of drawnText(text)) {
    const drawable = !MARK.test(ch) && covers(style, ch.codePointAt(0)!);
    if (!drawable && !missing.includes(ch)) missing.push(ch);
  }
  return missing;
}

/**
 * Scripts named in words when a face has none of their letters, as
 * `[Unicode script, what a reader calls it]`. A reader is told "no Bengali
 * letters", not a row of vowel signs that each render on a dotted circle.
 */
const NAMED_SCRIPTS: readonly (readonly [string, string])[] = [
  ["Arabic", "Arabic"],
  ["Armenian", "Armenian"],
  ["Bengali", "Bengali"],
  ["Cyrillic", "Cyrillic"],
  ["Devanagari", "Devanagari"],
  ["Ethiopic", "Ethiopic"],
  ["Georgian", "Georgian"],
  ["Greek", "Greek"],
  ["Gujarati", "Gujarati"],
  ["Gurmukhi", "Gurmukhi"],
  ["Han", "Chinese"],
  ["Hangul", "Korean"],
  ["Hebrew", "Hebrew"],
  ["Hiragana", "Japanese"],
  ["Katakana", "Japanese"],
  ["Kannada", "Kannada"],
  ["Khmer", "Khmer"],
  ["Lao", "Lao"],
  ["Malayalam", "Malayalam"],
  ["Myanmar", "Myanmar"],
  ["Oriya", "Odia"],
  ["Sinhala", "Sinhala"],
  ["Tamil", "Tamil"],
  ["Telugu", "Telugu"],
  ["Thai", "Thai"],
  ["Tibetan", "Tibetan"],
];
const scriptPattern = new Map<string, RegExp>();
function inScript(script: string, ch: string): boolean {
  let re = scriptPattern.get(script);
  if (!re) {
    re = new RegExp(`^\\p{Script=${script}}$`, "u");
    scriptPattern.set(script, re);
  }
  return re.test(ch);
}
const faceHasScript = new Map<string, boolean>();
function hasAnyOf(style: HandwritingStyle, script: string): boolean {
  const key = `${style}:${script}`;
  let has = faceHasScript.get(key);
  if (has === undefined) {
    has = HANDWRITING_COVERAGE[style].some(([a, b]) => {
      for (let cp = a; cp <= b; cp++)
        if (inScript(script, String.fromCodePoint(cp))) return true;
      return false;
    });
    faceHasScript.set(key, has);
  }
  return has;
}

const hex = (ch: string) =>
  `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * {@link handwritingMissing}, as a reader can read it: a script the face has
 * none of is named ("Bengali letters", once); a combining mark, a space
 * separator or another invisible character is written as its code point
 * ("U+0301", "U+00A0") instead of a blank or a dotted circle; any other
 * letter is itself. In first-appearance order, without repeats.
 */
export function handwritingMissingLabels(
  style: HandwritingStyle,
  text: string,
): string[] {
  const out: string[] = [];
  const add = (label: string) => {
    if (!out.includes(label)) out.push(label);
  };
  for (const ch of handwritingMissing(style, text)) {
    const named = NAMED_SCRIPTS.find(([script]) => inScript(script, ch));
    if (named && !hasAnyOf(style, named[0])) add(`${named[1]} letters`);
    else if (/[\p{M}\p{Z}\p{C}]/u.test(ch)) add(hex(ch));
    else add(ch);
  }
  return out;
}

/** Can this face draw every character of `text`? */
export function handwritingCanDraw(
  style: HandwritingStyle,
  text: string,
): boolean {
  return handwritingMissing(style, text).length === 0;
}

/**
 * The handwriting face a box's words are set in — a typed signature's
 * (`TextBoxObject.hand`) — or `null` when they are set as its font, weight
 * and slant say. `null` whenever the face lacks any letter of `text`: a name
 * the face cannot draw is set exactly as the box's underlying style sets it,
 * never with a blank box where a letter was. The overlay and the export both
 * ask this, so the screen and the file agree on which face drew the words.
 * Here rather than in `editor/text.ts`, the layout code Redact PDF's removal
 * shares: there it carried this table into that tool's lazy chunk.
 */
export function handwritingFor(
  obj: { readonly hand?: HandwritingStyle },
  text: string,
): HandwritingStyle | null {
  return obj.hand && handwritingCanDraw(obj.hand, text) ? obj.hand : null;
}
