/**
 * The alphabet pdf-lib's built-in fonts can encode, in one place.
 *
 * The fourteen standard PDF fonts are WinAnsi (CP1252): ASCII, Latin-1, and
 * twenty-seven scattered code points above it. Ask one to draw anything else
 * and it throws. That is the whole reason `unicode-font.ts` exists, and this
 * predicate is the fork between the free path (a standard face, no download)
 * and the expensive one (a real Unicode face, fetched and subset).
 *
 * It lived inside `annotate.ts` until Unicode embedding arrived and five other
 * modules needed the same question answered. One definition, because two
 * copies of an alphabet are two chances to disagree about the euro sign.
 */

/**
 * The exact code points above Latin-1 that WinAnsi can encode — smart quotes,
 * dashes, the euro sign, and friends. Kept precise so the fork matches the
 * encoder: a code point wrongly listed here reaches pdf-lib and throws an
 * unhandled library error, and one wrongly missing sends an English watermark
 * through a font download it never needed.
 */
const WINANSI_EXTRA: ReadonlySet<number> = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013,
  0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021,
  0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);

/** Can a built-in standard font encode this code point without throwing? */
export function isWinAnsiEncodable(codePoint: number): boolean {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    WINANSI_EXTRA.has(codePoint)
  );
}

/**
 * The distinct characters in `text` a standard font cannot encode.
 *
 * Empty for ordinary Western text — which is the common case and the reason
 * this is checked before anything is downloaded. Tabs and newlines are layout,
 * not glyphs, and never appear here.
 */
export function nonWinAnsiCharacters(text: string): string[] {
  const seen = new Set<string>();
  for (const ch of text) {
    if (ch === "\t" || ch === "\n" || ch === "\r") continue;
    const cp = ch.codePointAt(0);
    if (cp === undefined || !isWinAnsiEncodable(cp)) seen.add(ch);
  }
  return [...seen];
}

/** True when every character in every string can be drawn by a standard font. */
export function allWinAnsi(texts: Iterable<string>): boolean {
  for (const text of texts) {
    if (nonWinAnsiCharacters(text).length > 0) return false;
  }
  return true;
}
