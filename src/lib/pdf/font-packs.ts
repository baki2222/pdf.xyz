/**
 * Which alphabets pdf.xyz can DRAW, and which face draws each one.
 *
 * WHY THIS EXISTS
 * pdf-lib's fourteen standard fonts encode WinAnsi (CP1252) and nothing else,
 * so every tool that stamps text — watermark, page numbers, header/footer,
 * annotate, edit, sign, text-to-PDF, markdown-to-PDF — could not put a single
 * character of Chinese, Japanese, Korean or Bengali into a document, while the
 * product advertised OCR in 21 languages and named those four. The gap was not
 * cosmetic: it told a user we read their document and then could not write one
 * word of their language onto it.
 *
 * This module is the ROUTING half — given a string, which face has to arrive.
 * It is pure: no pdf-lib, no DOM, no fetch, so the copy script, the guards and
 * the browser all read one table.
 *
 * THE TWO THINGS THAT KEEP IT HONEST
 *
 *  1. Coverage is not written here. `font-coverage.generated.ts` is derived
 *     from the cmap of the exact TTFs `scripts/copy-noto-fonts.ts` ships, and
 *     `font-coverage.test.ts` re-derives it from those files and fails when the
 *     two disagree. A hand-kept block table is the shape that goes stale; this
 *     one cannot, because nothing in it was typed.
 *
 *  2. Coverage still only says a code point is in the cmap. The promise that a
 *     glyph will actually be DRAWN is kept later, after the bytes arrive, by
 *     shaping the text and rejecting any `.notdef` (see `unicode-font.ts`).
 *     Two independent bounds: one on the font we chose, one on the glyphs the
 *     shaper produced.
 *
 * WHAT IS DELIBERATELY ABSENT
 * Right-to-left scripts (Arabic, Hebrew, Syriac, Thaana) have no pack. Not for
 * want of a Noto face — they exist — but because pdf-lib draws a run left to
 * right from a fixed origin and nothing here reorders a bidirectional
 * paragraph. Shipping an Arabic face would produce a page that looks like
 * Arabic and reads backwards, which is the silent-corruption class this module
 * exists to avoid. {@link UNSUPPORTED_SCRIPTS} names them so a refusal can say
 * *why*, and so the day a bidi layout lands there is one list to update.
 */

/** A face we ship. */
export type FontPackId =
  "latin" | "bengali" | "mono" | "japanese" | "korean" | "chinese";

/**
 * The built-in faces our tools ask for. Western text is drawn in exactly this
 * face; anything else is routed to a shipped pack by {@link packsForFace}.
 */
export type StandardFace =
  "sans" | "sans-bold" | "sans-oblique" | "mono" | "serif-italic";

/** A closed, inclusive Unicode code-point range. */
export type CodePointRange = readonly [number, number];

/**
 * What a pack is FOR.
 *
 * - `script` — the face for an alphabet, used by every caller whatever face it
 *   asked for. These are what {@link SUPPORTED_SCRIPTS} and every refusal
 *   describe.
 * - `monospace` — a face used ONLY where a caller asked for `"mono"`, and
 *   preferred there over every script pack that could also draw the text.
 *   Text to PDF promises monospace typography and Markdown sets code in it;
 *   before this role existed, one arrow or `tree` connector sent the whole
 *   document to Noto Sans JP — proportional for Latin (i=275, W=878) and
 *   5.4 MB — because it was the only shipped face with those glyphs. Kept out
 *   of every other face deliberately: it is smaller than Noto Sans and covers
 *   Cyrillic, so without the gate it would win the size tiebreak and set every
 *   Cyrillic watermark and page number in a typewriter face.
 */
export type FontPackRole = "script" | "monospace";

export interface FontPack {
  readonly id: FontPackId;
  readonly role: FontPackRole;
  /** Shown to a user in a message: "Bengali", "Chinese", "monospace". */
  readonly label: string;
  /** The scripts a reader would say this face is for. */
  readonly scripts: readonly string[];
  /** npm package the TTF is copied out of. */
  readonly pkg: string;
  /** Directory inside the package that holds the TTF. */
  readonly dir: string;
  /** The TTF's basename, inside `<pkg>/<dir>/`. */
  readonly file: string;
  /**
   * Version stamped into the served URL, pinned to the npm package version so
   * a bump lands on a fresh immutably-cacheable path instead of poisoning the
   * old one — and so `copy-noto-fonts.ts` fails when source and table drift.
   */
  readonly version: string;
  /** Measured bytes of the TTF, checked against the file by the copy step. */
  readonly bytes: number;
  /**
   * Code points that make this pack the FIRST choice rather than merely a
   * possible one. Three CJK faces overlap heavily — Noto Sans SC carries 100%
   * of CJK Unified, JP 61%, KR 39% (measured) — so "can draw it" would send a
   * Chinese watermark to the Japanese face and back again. Kana means Japanese,
   * Hangul means Korean, bare Han means Chinese.
   */
  readonly signals: readonly CodePointRange[];
}

/**
 * Ordered smallest-first, which is also the order ties break in. The `bytes`
 * are what a user downloads once, on the first document that needs the script.
 */
export const FONT_PACKS: readonly FontPack[] = [
  {
    id: "bengali",
    role: "script",
    label: "Bengali",
    scripts: ["Bengali"],
    pkg: "@expo-google-fonts/noto-sans-bengali",
    dir: "400Regular",
    file: "NotoSansBengali_400Regular.ttf",
    version: "0.4.4",
    bytes: 141064,
    signals: [[0x980, 0x9ff]],
  },
  {
    // Geist Mono, from the `geist` package the site already depends on for its
    // own typography (SIL Open Font License). Every glyph is 600 units wide
    // except combining marks — measured with fontkit, not taken from its
    // `isFixedPitch` flag. It draws PART of Latin, Cyrillic, the arrows and
    // math — not ⇒, not pinyin ǐ, not Greek, not ✓. Text needing those falls
    // through to a script pack, which draws it correctly but proportionally.
    // What the runner may promise is MONOSPACE_CLAIMS, checked member by
    // member; `scripts` below is not a promise that the whole script is drawn.
    id: "mono",
    role: "monospace",
    label: "monospace",
    scripts: ["Latin", "Cyrillic"],
    pkg: "geist",
    dir: "dist/fonts/geist-mono",
    file: "GeistMono-Regular.ttf",
    version: "1.7.2",
    bytes: 148516,
    signals: [],
  },
  {
    id: "latin",
    role: "script",
    label: "Latin, Greek, Cyrillic and Devanagari",
    scripts: ["Latin", "Greek", "Cyrillic", "Devanagari"],
    pkg: "@expo-google-fonts/noto-sans",
    dir: "400Regular",
    file: "NotoSans_400Regular.ttf",
    version: "0.4.2",
    bytes: 629024,
    signals: [
      [0x100, 0x24f], // Latin Extended-A and -B
      [0x370, 0x3ff], // Greek
      [0x400, 0x52f], // Cyrillic
      [0x900, 0x97f], // Devanagari
      [0x1e00, 0x1eff], // Latin Extended Additional (Vietnamese)
    ],
  },
  {
    id: "japanese",
    role: "script",
    label: "Japanese",
    scripts: ["Hiragana", "Katakana", "Kanji"],
    pkg: "@expo-google-fonts/noto-sans-jp",
    dir: "400Regular",
    file: "NotoSansJP_400Regular.ttf",
    version: "0.4.3",
    bytes: 5472784,
    signals: [
      [0x3040, 0x309f], // Hiragana
      [0x30a0, 0x30ff], // Katakana
    ],
  },
  {
    id: "korean",
    role: "script",
    label: "Korean",
    scripts: ["Hangul"],
    pkg: "@expo-google-fonts/noto-sans-kr",
    dir: "400Regular",
    file: "NotoSansKR_400Regular.ttf",
    version: "0.4.3",
    bytes: 6185868,
    signals: [
      [0x1100, 0x11ff], // Hangul Jamo
      [0x3130, 0x318f], // Hangul Compatibility Jamo
      [0xac00, 0xd7a3], // Hangul Syllables
    ],
  },
  {
    id: "chinese",
    role: "script",
    label: "Chinese",
    scripts: ["Han"],
    pkg: "@expo-google-fonts/noto-sans-sc",
    dir: "400Regular",
    file: "NotoSansSC_400Regular.ttf",
    version: "0.4.3",
    bytes: 10559284,
    signals: [
      [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
      [0x4e00, 0x9fff], // CJK Unified Ideographs
    ],
  },
];

/**
 * What the Text to PDF tile may promise is set in the monospace face — each
 * entry a label a reader sees, and the definition of its members that exists
 * WITHOUT our font, so a test can expand the label and check every member.
 *
 * It used to say "Latin and Cyrillic text, arrows and box drawing". Geist Mono
 * draws 21 of the 112 arrows (not ⇒ ⇐ ⇔) and misses 202 Latin letters Noto
 * Sans draws (pinyin ǐ ǔ ǒ ǚ), so "Step 1 ⇒ done" still went to the 5.4 MB
 * proportional Noto Sans JP under copy promising the opposite. A category the
 * face only partly draws cannot be named; these are the ones it draws whole:
 *
 * - `codePages`: a Windows code page is Microsoft's own definition of the
 *   letters a language group needs, and the WHATWG decoder is its member list.
 *   Geist Mono draws every graphic character of 1250, 1251, 1252, 1254 and
 *   1257 (measured 2026-09-27); NOT 1253 Greek, NOT 1258 Vietnamese (₫).
 * - `block`: a whole Unicode block.
 * - `characters`: exactly the characters printed, and nothing they resemble.
 *
 * Checked by `font-packs.test.ts` (every member routes to the monospace pack),
 * `text-to-pdf.test.ts` (every member lands on the page in one face at one
 * width) and `text-to-pdf-claim.test.tsx` (the rendered tile names no other
 * category and no other character).
 */
export interface MonospaceClaim {
  readonly label: string;
  readonly members:
    | { readonly codePages: readonly string[] }
    | { readonly block: CodePointRange }
    | { readonly characters: string };
}

export const MONOSPACE_CLAIMS: readonly MonospaceClaim[] = [
  { label: "Western European", members: { codePages: ["windows-1252"] } },
  { label: "Central European", members: { codePages: ["windows-1250"] } },
  { label: "Baltic", members: { codePages: ["windows-1257"] } },
  { label: "Turkish", members: { codePages: ["windows-1254"] } },
  {
    label: "Russian, Ukrainian, Bulgarian and Serbian",
    members: { codePages: ["windows-1251"] },
  },
  { label: "box drawing", members: { block: [0x2500, 0x257f] } },
  { label: "← → ↑ ↓ ↔ ↕", members: { characters: "←→↑↓↔↕" } },
];

/** The tile's sentence, built from {@link MONOSPACE_CLAIMS} and nothing else. */
export function monospaceClaimSentence(): string {
  const languages = MONOSPACE_CLAIMS.filter((c) => "codePages" in c.members);
  const others = MONOSPACE_CLAIMS.filter((c) => !("codePages" in c.members));
  return `${languages.map((c) => c.label).join(", ")} text, ${others
    .map((c) => c.label)
    .join(" and ")} are set in a monospace face.`;
}

/** Look a pack up by id; throws rather than returning undefined. */
export function fontPack(id: FontPackId): FontPack {
  const pack = FONT_PACKS.find((p) => p.id === id);
  if (!pack) throw new Error(`unknown font pack: ${id}`);
  return pack;
}

/**
 * The packs a caller asking for `face` may be given: every script pack, plus
 * the monospace pack only when `"mono"` was asked for.
 */
export function packsForFace(face: StandardFace): readonly FontPack[] {
  return FONT_PACKS.filter((pack) => pack.role === "script" || face === "mono");
}

/**
 * Every script any shipped SCRIPT pack can draw — the "what we DO cover" half
 * of a refusal. The monospace pack adds a typeface, not an alphabet, so it is
 * not counted: no script becomes drawable only because it exists.
 */
export const SUPPORTED_SCRIPTS: readonly string[] = [
  ...new Set(
    FONT_PACKS.filter((p) => p.role === "script").flatMap((p) => p.scripts),
  ),
];

/**
 * Scripts we can NAME but deliberately do not draw, and why.
 *
 * A refusal reading "unsupported characters" is a claim that goes stale the day
 * a font is added. One reading "Arabic is written right to left and pdf.xyz
 * lays every line out left to right" stays true until the capability itself
 * changes — which is the property, not the mechanism.
 */
export const UNSUPPORTED_SCRIPTS: readonly {
  readonly name: string;
  readonly ranges: readonly CodePointRange[];
  readonly reason: string;
}[] = [
  {
    name: "Arabic",
    ranges: [
      [0x600, 0x6ff],
      [0x750, 0x77f],
      [0x8a0, 0x8ff],
      [0xfb50, 0xfdff],
      // Presentation Forms-B stops at FEFE deliberately: U+FEFF is the byte
      // order mark, not an Arabic letter, and the CJK faces carry it. Naming it
      // "Arabic" would have put a wrong script in a refusal — caught by the
      // reverse direction of `font-packs.test.ts`, which is exactly what that
      // half of a ban list is for.
      [0xfe70, 0xfefe],
    ],
    reason:
      "it is written right to left and pdf.xyz lays every line out left to right, so it would come out reversed",
  },
  {
    name: "Hebrew",
    ranges: [
      [0x590, 0x5ff],
      [0xfb1d, 0xfb4f],
    ],
    reason:
      "it is written right to left and pdf.xyz lays every line out left to right, so it would come out reversed",
  },
  { name: "Thai", ranges: [[0xe00, 0xe7f]], reason: "no Thai face is shipped" },
  { name: "Lao", ranges: [[0xe80, 0xeff]], reason: "no Lao face is shipped" },
  {
    name: "Tamil",
    ranges: [[0xb80, 0xbff]],
    reason: "no Tamil face is shipped",
  },
  {
    name: "Telugu",
    ranges: [[0xc00, 0xc7f]],
    reason: "no Telugu face is shipped",
  },
  {
    name: "Kannada",
    ranges: [[0xc80, 0xcff]],
    reason: "no Kannada face is shipped",
  },
  {
    name: "Malayalam",
    ranges: [[0xd00, 0xd7f]],
    reason: "no Malayalam face is shipped",
  },
  {
    name: "Gujarati",
    ranges: [[0xa80, 0xaff]],
    reason: "no Gujarati face is shipped",
  },
  {
    name: "Gurmukhi",
    ranges: [[0xa00, 0xa7f]],
    reason: "no Gurmukhi face is shipped",
  },
  {
    name: "Oriya",
    ranges: [[0xb00, 0xb7f]],
    reason: "no Odia face is shipped",
  },
  {
    name: "Sinhala",
    ranges: [[0xd80, 0xdff]],
    reason: "no Sinhala face is shipped",
  },
  {
    name: "Myanmar",
    ranges: [[0x1000, 0x109f]],
    reason: "no Burmese face is shipped",
  },
  {
    name: "Khmer",
    ranges: [[0x1780, 0x17ff]],
    reason: "no Khmer face is shipped",
  },
  {
    name: "Georgian",
    ranges: [[0x10a0, 0x10ff]],
    reason: "no Georgian face is shipped",
  },
  {
    name: "Armenian",
    ranges: [[0x530, 0x58f]],
    reason: "no Armenian face is shipped",
  },
  {
    name: "Ethiopic",
    ranges: [[0x1200, 0x137f]],
    reason: "no Ethiopic face is shipped",
  },
  {
    name: "emoji",
    // The astral planes only. Miscellaneous Symbols and Dingbats
    // (U+2600–U+27BF) were listed here first and were WRONG: the CJK faces
    // carry a good part of that block, so ☀ and ✓ are drawable and were being
    // told they are emoji we do not embed. A refusal naming the wrong reason is
    // worse than a generic one, because it argues.
    ranges: [
      [0x1f000, 0x1faff],
      [0xfe0f, 0xfe0f],
    ],
    reason:
      "colour emoji are pictures rather than letters and are not embedded",
  },
];

function inRanges(cp: number, ranges: readonly CodePointRange[]): boolean {
  for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
  return false;
}

/** True when `cp` is one of the code points that makes `pack` the first choice. */
export function isSignalCodePoint(pack: FontPack, cp: number): boolean {
  return inRanges(cp, pack.signals);
}

/** The named script for a code point we refuse, or null when we cannot name it. */
export function unsupportedScriptFor(
  cp: number,
): { name: string; reason: string } | null {
  for (const entry of UNSUPPORTED_SCRIPTS) {
    if (inRanges(cp, entry.ranges)) {
      return { name: entry.name, reason: entry.reason };
    }
  }
  return null;
}

/** Where the browser fetches a pack from. Version-stamped, immutably cacheable. */
export function fontPackUrl(pack: FontPack): string {
  return `/fonts/${pack.version}/${pack.file}`;
}
