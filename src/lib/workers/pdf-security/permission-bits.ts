/**
 * Read the /P (permissions) integer of an encrypted PDF from its bytes, with
 * no password and no decryption.
 *
 * Why this can work without a password: the encryption dictionary itself is
 * never encrypted, nor is the trailer or the cross-reference stream that
 * points at it (ISO 32000-1 §7.6.1, §7.5.8.2), and the dictionary may not
 * live inside an object stream. So /P sits in plain text in every file qpdf
 * writes. pdf-lib cannot be asked: it does not decrypt, and on an encrypted
 * file with object streams it cannot even reach the page tree.
 *
 * Why it exists: Protect PDF tells qpdf which permissions to withhold, and
 * argv tests can only show that we asked. This is the read-back, run by the
 * engine on every restricted job and by both proofs, of the file the user
 * downloads.
 *
 * Returns `null` when no /Encrypt can be followed to a /P — never a guess.
 */

const LATIN1 = new TextDecoder("latin1");

/** The last match of a global regex in `text`, or null. */
function lastMatch(text: string, re: RegExp): RegExpExecArray | null {
  let last: RegExpExecArray | null = null;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) last = m;
  return last;
}

/** /P in a dictionary's text; `/P` must not be the start of a longer name. */
function pIn(dictText: string): number | null {
  const m = /\/P(?![A-Za-z0-9#])\s*(-?\d+)/.exec(dictText);
  if (!m) return null;
  const n = Number(m[1]);
  // A 32-bit field. Some writers store it unsigned; fold to signed.
  if (!Number.isInteger(n) || n < -0x80000000 || n > 0xffffffff) return null;
  return n | 0;
}

/** The text of `<< … >>` starting at `start`, honouring nesting. */
function dictAt(text: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "<" && text[i + 1] === "<") {
      depth += 1;
      i += 1;
    } else if (text[i] === ">" && text[i + 1] === ">") {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function readEncryptPermissions(bytes: Uint8Array): number | null {
  const text = LATIN1.decode(bytes);
  // The LAST /Encrypt wins: an incremental update's trailer comes after the
  // one it supersedes.
  const ref = lastMatch(text, /\/Encrypt\s+(\d+)\s+(\d+)\s+R/g);
  const direct = lastMatch(text, /\/Encrypt\s*<</g);
  if (direct && (!ref || direct.index > ref.index)) {
    const dict = dictAt(text, direct.index + direct[0].length - 2);
    return dict ? pIn(dict) : null;
  }
  if (!ref) return null;
  const [, num, gen] = ref;
  const obj = lastMatch(
    text,
    new RegExp(`(?:^|[^0-9])${num}\\s+${gen}\\s+obj\\b`, "g"),
  );
  if (!obj) return null;
  const open = text.indexOf("<<", obj.index);
  const end = text.indexOf("endobj", obj.index);
  if (open < 0 || (end >= 0 && open > end)) return null;
  const dict = dictAt(text, open);
  return dict ? pIn(dict) : null;
}
