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

/* ------------------------------------------------------------------ *
 *  The author's grant in the terms qpdf writes it (2026-11-17).
 * ------------------------------------------------------------------ */

/** qpdf's `--print` levels: /P bit 3 off; bit 3 without 12; both. */
export type QpdfPrintLevel = "none" | "low" | "full";

/**
 * What a restricted PDF's author grants without the owner password, as the
 * seven switches qpdf 11 writes for R3 and later (`--print`,
 * `--modify-other`, `--extract`, `--annotate`, `--form`, `--accessibility`,
 * `--assemble`). OCR PDF re-encrypts its searchable copy of a restricted
 * file with these (competitor-audit backlog #11), and reads them back from
 * what qpdf wrote.
 */
export interface QpdfGrant {
  /** Bits 3 and 12. */
  print: QpdfPrintLevel;
  /** Bit 4: change the document in ways the others do not cover. */
  modify: boolean;
  /** Bit 5: copy text and images. */
  copy: boolean;
  /** Bit 6: add or change comments (and fill forms). */
  annotate: boolean;
  /** Bit 9: fill existing form fields even when bit 6 is off. */
  fillForms: boolean;
  /** Bit 10: extract for accessibility (deprecated in PDF 2.0, see below). */
  accessibility: boolean;
  /** Bit 11: insert, rotate or delete pages. */
  assemble: boolean;
}

/** The grant's switches, in the order the argv writes them. */
export const QPDF_GRANT_KEYS = [
  "print",
  "modify",
  "copy",
  "annotate",
  "fillForms",
  "accessibility",
  "assemble",
] as const satisfies readonly (keyof QpdfGrant)[];

const bitOn = (p: number, n: number): boolean => (p & (1 << (n - 1))) !== 0;

/**
 * The grant a /P value states, read the way its revision defines the bits
 * (ISO 32000-1 Table 22). Revision 2 has no bits 9-12: printing there is
 * full-quality printing, form filling is bit 6's, accessibility extraction
 * is bit 5's and page assembly is bit 4's — so an R2 file's grant becomes
 * the R3+ switches that mean the same thing, never a raw copy of bits that
 * R2 leaves undefined.
 */
export function qpdfGrantFromP(p: number, r: number): QpdfGrant {
  if (r < 3)
    return {
      print: bitOn(p, 3) ? "full" : "none",
      modify: bitOn(p, 4),
      copy: bitOn(p, 5),
      annotate: bitOn(p, 6),
      fillForms: bitOn(p, 6),
      accessibility: bitOn(p, 5),
      assemble: bitOn(p, 4),
    };
  return {
    print: !bitOn(p, 3) ? "none" : bitOn(p, 12) ? "full" : "low",
    modify: bitOn(p, 4),
    copy: bitOn(p, 5),
    annotate: bitOn(p, 6),
    fillForms: bitOn(p, 9),
    accessibility: bitOn(p, 10),
    assemble: bitOn(p, 11),
  };
}
