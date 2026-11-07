/**
 * Carry a PDF's title, author, subject and keywords into its PDF/A copy
 * (audit pdf-to-pdfa#3, 2026-11-08). WORKER-ONLY: pdf-lib is loaded here.
 *
 * Measured on production (gs 10.00.0, 2026-08-11): Ghostscript prints
 * "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1,
 * discarding DOCINFO" for essentially every PDF that carries producer or
 * creator text, and the copy comes back without the original's title and
 * author. Archives and repositories index on exactly those two fields.
 *
 * The fix is Ghostscript's own recipe: its `lib/PDFA_def.ps` sets the title
 * with a `/DOCINFO pdfmark` in the prefix that runs before the document. So
 * the worker reads the four fields with pdf-lib BEFORE Ghostscript runs and
 * writes them into that prefix (`pdfaDefinition` in `./native`) as one
 * pdfmark, which pdfwrite puts in the copy's Info dictionary and, for PDF/A,
 * its XMP metadata. The original's own DOCINFO still reaches Ghostscript as
 * before, so its "discarding DOCINFO" notice can still appear; it is about
 * that copy of the fields, not the one written here.
 *
 * Only what can be written faithfully is written. A PostScript string in a
 * pdfmark lands in the Info dictionary as PDFDocEncoding bytes, so a field is
 * carried only when every character is printable ASCII or a Latin-1 letter
 * or sign (U+00A1 to U+00FF, less the soft hyphen): the range where
 * PDFDocEncoding and Latin-1 are the same byte, so no reader can decode it
 * differently. A field holding anything else (curly quotes, a dash, another
 * script) is NOT carried rather than rewritten, and neither is one longer
 * than {@link MAX_CARRIED_FIELD_CHARS}. Line breaks and tabs become spaces.
 *
 * An encrypted input (one with only an owner password still opens) is not
 * read at all: pdf-lib does not decrypt, so its strings would be ciphertext.
 */
import { PDFDocument } from "pdf-lib";

import {
  CARRIED_DOCINFO_FIELDS,
  MAX_CARRIED_FIELD_CHARS,
} from "./docinfo-words";

export { CARRIED_DOCINFO_FIELDS, MAX_CARRIED_FIELD_CHARS };
export type CarriedDocInfoField = (typeof CARRIED_DOCINFO_FIELDS)[number];
export type CarriedDocInfo = Partial<Record<CarriedDocInfoField, string>>;

/** True when every character has the same byte in PDFDocEncoding and Latin-1. */
function faithfullyWritable(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const ascii = code >= 0x20 && code <= 0x7e;
    const latin1 = code >= 0xa1 && code <= 0xff && code !== 0xad;
    if (!ascii && !latin1) return false;
  }
  return true;
}

/** The value as it will be written, or undefined when it is not carried. */
export function carriedValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const text = raw.replace(/[\t\r\n]+/g, " ").trim();
  if (text.length === 0 || text.length > MAX_CARRIED_FIELD_CHARS)
    return undefined;
  return faithfullyWritable(text) ? text : undefined;
}

/**
 * Read the carried fields from the input. Never throws and never fails the
 * job: an unreadable or encrypted input simply carries nothing, which is the
 * conversion exactly as it ran before.
 */
export async function readCarriedDocInfo(
  input: Uint8Array,
): Promise<CarriedDocInfo> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    return {};
  }
  if (doc.isEncrypted) return {};
  const read: Record<CarriedDocInfoField, () => string | undefined> = {
    Title: () => doc.getTitle(),
    Author: () => doc.getAuthor(),
    Subject: () => doc.getSubject(),
    Keywords: () => doc.getKeywords(),
  };
  const info: CarriedDocInfo = {};
  for (const field of CARRIED_DOCINFO_FIELDS) {
    let value: string | undefined;
    try {
      value = carriedValue(read[field]());
    } catch {
      value = undefined;
    }
    if (value !== undefined) info[field] = value;
  }
  return info;
}

/** A PostScript literal string: `\`, `(`, `)` escaped, any byte above 0x7E as octal. */
function postscriptLatin1(text: string): string {
  let out = "(";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else if (code > 0x7e) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return `${out})`;
}

/** The prefix line that sets the carried fields, or null when there are none. */
export function docInfoPdfmark(info: CarriedDocInfo): string | null {
  const pairs = CARRIED_DOCINFO_FIELDS.flatMap((field) => {
    const value = info[field];
    return value === undefined ? [] : [`/${field} ${postscriptLatin1(value)}`];
  });
  return pairs.length > 0 ? `[${pairs.join(" ")} /DOCINFO pdfmark` : null;
}
