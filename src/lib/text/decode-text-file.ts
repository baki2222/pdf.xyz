/**
 * Turning the bytes of a user's .txt or .md file into the text they wrote.
 *
 * WHY THIS EXISTS
 * The Text to PDF and Markdown to PDF runners read a picked file with
 * `file.text()`, which ALWAYS decodes as UTF-8 and swaps every invalid byte for
 * U+FFFD. Two ordinary files came out wrong and were reported as a success:
 *
 *   - a Windows-1252 note, `63 61 66 E9 20 93 71 94` ("café “q”"), became
 *     "caf� �q�" — Noto Sans has a real glyph for U+FFFD, so the font check
 *     downstream had nothing to refuse and the PDF shipped the diamonds;
 *   - a Notepad "Unicode" save (UTF-16LE with a byte-order mark) became two
 *     leading U+FFFD and a NUL between every letter, which breaks copy and
 *     search in the PDF, and any non-ASCII letter in it became garbage.
 *
 * WHAT IT DOES, in order — a DECLARED encoding beats a guessed one:
 *   1. a byte-order mark names the encoding (UTF-8, UTF-16LE, UTF-16BE);
 *   2. no mark, but NUL bytes fill one parity of the first few KB: UTF-16
 *      without a mark (ASCII-heavy UTF-16 is half zeros, real text never is);
 *   3. the bytes are valid UTF-8: UTF-8 — the common case, decided strictly;
 *   4. otherwise Windows-1252, which maps every byte to something and is what
 *      "ANSI" means on a Western Windows machine.
 * Only 2 and 4 are guesses, and {@link describeDecoding} says so to the user.
 *
 * WHAT IT DOES NOT DO: detect other legacy code pages. A Cyrillic cp1251 or a
 * Shift-JIS file still decodes under step 4 and comes out wrong. The note the
 * runner shows names the encoding it ASSUMED, so the user can see it did not
 * fit, rather than claiming detection it does not have.
 *
 * Control characters are removed only AFTER decoding, and counted. Stripping
 * NULs first would have made a UTF-16 file decode "cleanly" as UTF-8, hiding
 * the wrong guess instead of fixing it; counting them keeps the removal
 * visible.
 */

/** The encodings this reader can produce. */
export type TextFileEncoding =
  "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/** How the encoding was decided: declared by the file, or inferred by us. */
export type DecodeBasis = "bom" | "valid-utf-8" | "nul-pattern" | "fallback";

export interface DecodedTextFile {
  readonly text: string;
  readonly encoding: TextFileEncoding;
  readonly basis: DecodeBasis;
  /**
   * Control characters (C0 other than tab, line feed and carriage return; DEL;
   * C1) removed after decoding. No face draws them: left in, they either
   * refuse the whole document or reach the page as boxes.
   */
  readonly removedControls: number;
}

/** U+FFFD, built from its code so no tool in the chain can rewrite a literal. */
export const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

/** How much of the file the UTF-16 sniff reads. Plenty for a verdict, cheap. */
const SNIFF_BYTES = 4096;

function isStrippedControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function stripControls(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isStrippedControl(code)) {
      removed++;
      continue;
    }
    out += text[i];
  }
  return { text: removed === 0 ? text : out, removed };
}

function bomEncoding(
  bytes: Uint8Array,
): "utf-8" | "utf-16le" | "utf-16be" | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

/**
 * UTF-16 without a byte-order mark, told apart by where the zero bytes sit.
 *
 * Latin text in UTF-16LE is `H 00 i 00`: zeros in the ODD positions, almost
 * none in the even ones; big-endian is the mirror. Text in any 8-bit encoding
 * has no NUL at all. The thresholds are wide on purpose — a file that is 30%
 * zeros in one parity and nearly none in the other is not ambiguous.
 *
 * UTF-16 is two bytes a unit, so a file of odd length is not UTF-16 whatever
 * its zeros say — without that rule the three bytes `61 00 62` ("a", NUL, "b"
 * in UTF-8) read as one UTF-16 letter and a dangling half.
 */
function nulPatternEncoding(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  if (bytes.length % 2 !== 0) return null;
  const length = Math.min(bytes.length, SNIFF_BYTES) & ~1;
  const pairs = length / 2;
  if (pairs < 2) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < length; i += 2) {
    if (bytes[i] === 0) evenNul++;
    if (bytes[i + 1] === 0) oddNul++;
  }
  if (oddNul >= pairs * 0.3 && evenNul <= pairs * 0.05) return "utf-16le";
  if (evenNul >= pairs * 0.3 && oddNul <= pairs * 0.05) return "utf-16be";
  return null;
}

function finish(
  raw: string,
  encoding: TextFileEncoding,
  basis: DecodeBasis,
): DecodedTextFile {
  const { text, removed } = stripControls(raw);
  return { text, encoding, basis, removedControls: removed };
}

/** Decode a text file's bytes into the text its author wrote. */
export function decodeTextBytes(bytes: Uint8Array): DecodedTextFile {
  const declared = bomEncoding(bytes);
  if (declared) {
    // `ignoreBOM: false` (the default) consumes the mark itself. Not fatal: the
    // file NAMED its encoding, so a stray bad sequence is the file's defect,
    // and the U+FFFD it becomes is surfaced by the runner's second check.
    return finish(new TextDecoder(declared).decode(bytes), declared, "bom");
  }

  const utf16 = nulPatternEncoding(bytes);
  if (utf16) {
    return finish(new TextDecoder(utf16).decode(bytes), utf16, "nul-pattern");
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return finish(text, "utf-8", "valid-utf-8");
  } catch {
    // Not UTF-8. Windows-1252 decodes every byte, so this cannot throw; the
    // five bytes it leaves undefined become C1 controls and are stripped and
    // counted above.
    return finish(
      new TextDecoder("windows-1252").decode(bytes),
      "windows-1252",
      "fallback",
    );
  }
}

/** Read a picked file through {@link decodeTextBytes}. */
export async function decodeTextFile(file: Blob): Promise<DecodedTextFile> {
  return decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
}

const GUESSED: Record<TextFileEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 (little-endian)",
  "utf-16be": "UTF-16 (big-endian)",
  "windows-1252": "Windows-1252 (Western European)",
};

/**
 * What to tell the user about how their file was read, or null when there is
 * nothing to say (a declared or valid encoding, nothing removed).
 *
 * It names what was ASSUMED, not what was detected: the fallback cannot tell
 * Windows-1252 from Windows-1251 or Shift-JIS, and a sentence claiming it
 * could would be false for exactly the users who most need to re-save.
 */
export function describeDecoding(decoded: DecodedTextFile): string | null {
  const parts: string[] = [];
  if (decoded.basis === "fallback") {
    parts.push(
      `This file is not UTF-8, so it was read as ${GUESSED[decoded.encoding]}. ` +
        "If any characters look wrong, re-save the file as UTF-8 and upload it again.",
    );
  } else if (decoded.basis === "nul-pattern") {
    parts.push(
      `This file has no byte-order mark, so it was read as ${GUESSED[decoded.encoding]}. ` +
        "If the text looks wrong, re-save the file as UTF-8 and upload it again.",
    );
  }
  if (decoded.removedControls > 0) {
    const n = decoded.removedControls;
    parts.push(
      `${n.toLocaleString()} control character${n === 1 ? " was" : "s were"} removed — they have no printable shape.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/** How many U+FFFD replacement characters `text` carries. */
export function countReplacementCharacters(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) count++;
  }
  return count;
}

/**
 * The second, independent bound: whatever path the text came by — a decoder
 * this module has not met, a paste of already-damaged text — U+FFFD in the box
 * means a letter was lost before we saw it, and the PDF would print the
 * diamond. Warned about rather than refused: the user can see and fix it in
 * the editor, and a document that really does contain U+FFFD is theirs to
 * convert.
 */
export function describeReplacementCharacters(text: string): string | null {
  const n = countReplacementCharacters(text);
  if (n === 0) return null;
  return (
    `${n.toLocaleString()} character${n === 1 ? "" : "s"} in this text could not be read and ` +
    `show${n === 1 ? "s" : ""} as ${REPLACEMENT_CHARACTER}. ` +
    `The PDF will print ${REPLACEMENT_CHARACTER} there, not the original letter${n === 1 ? "" : "s"}. ` +
    "Re-save the file as UTF-8, or correct the text above."
  );
}
