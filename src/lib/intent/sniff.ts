/**
 * What a file's first bytes say it is — the third, strongest kind of evidence
 * after its name and its declared type (`./formats`).
 *
 * Kept apart from `./formats` so the pages that only route files by name (every
 * tool page, through the hand-off gate) do not load signature tables they
 * never use. No page imports it yet; it is the recogniser the file facts
 * behind a suggestion will read bytes with, held meanwhile to the engine that
 * already reads them.
 *
 * Bound to the image engine by `formats.test.ts`: a file this calls a PNG or
 * a JPEG is one `sniffRasterFormat` decodes as that, and an image it names
 * unsupported is named the same way by the image tools' own refusal.
 */
import {
  formatOf,
  formatOfName,
  type FileFormat,
  type FileLike,
  type FormatVerdict,
} from "./formats";

/** Formats recognised by extension only, and only when the bytes are text. */
const TEXT_FORMATS: ReadonlySet<FileFormat> = new Set<FileFormat>([
  "TXT",
  "MD",
  "CSV",
  "HTML",
  "SVG",
]);

function ascii(head: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...head.subarray(offset, offset + length));
}

function startsWith(head: Uint8Array, signature: readonly number[]): boolean {
  return (
    head.length >= signature.length &&
    signature.every((byte, i) => head[i] === byte)
  );
}

function findAscii(head: Uint8Array, needle: string, end: number): boolean {
  const stop = Math.min(end, head.length) - needle.length;
  outer: for (let i = 0; i <= stop; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (head[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** The PDF header may sit anywhere in the first 1024 bytes (ISO 32000). */
const PDF_HEADER_WINDOW = 1024;
/** Text is judged on this many leading bytes: no NUL, or it is not text. */
const TEXT_WINDOW = 4096;

/** A ZIP container's real format: Office by name, ODF/EPUB by `mimetype`. */
function zipFormat(head: Uint8Array, name: string): FileFormat {
  const named = formatOfName(name);
  if (
    named === "DOCX" ||
    named === "XLSX" ||
    named === "PPTX" ||
    named === "ODT" ||
    named === "ODS" ||
    named === "ODP" ||
    named === "EPUB"
  ) {
    return named;
  }
  // ODF and EPUB store an uncompressed `mimetype` entry first, by spec.
  if (ascii(head, 30, 8) === "mimetype") {
    const type = ascii(head, 38, 60);
    if (type.startsWith("application/epub+zip")) return "EPUB";
    if (type.startsWith("application/vnd.oasis.opendocument.text"))
      return "ODT";
    if (type.startsWith("application/vnd.oasis.opendocument.spreadsheet"))
      return "ODS";
    if (type.startsWith("application/vnd.oasis.opendocument.presentation"))
      return "ODP";
  }
  return "ZIP";
}

/**
 * The format the bytes declare by their signature, or null. `name` only
 * resolves containers that cannot be told apart by their first bytes (an
 * Office ZIP or OLE file) and the text formats, which have no signature and
 * are read by extension — and only when the leading bytes hold no NUL.
 */
export function sniffFormat(head: Uint8Array, name = ""): FileFormat | null {
  if (head.length === 0) return null;
  if (findAscii(head, "%PDF-", PDF_HEADER_WINDOW)) return "PDF";
  if (startsWith(head, PNG_SIGNATURE)) return "PNG";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "JPG";
  if (ascii(head, 0, 4) === "GIF8") return "GIF";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") {
    return "WEBP";
  }
  if (ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    if (/^(?:hei[cx]|hev[cx])$/.test(brand)) return "HEIC";
    if (/^(?:mif1|msf1|heim|heis)$/.test(brand)) return "HEIF";
    if (/^avi[fs]$/.test(brand)) return "AVIF";
  }
  if (
    startsWith(head, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "TIFF";
  }
  // "BM", then a size, then four reserved bytes that are always zero — so a
  // text file that begins "BMW…" is not a bitmap.
  if (
    ascii(head, 0, 2) === "BM" &&
    head.length >= 10 &&
    head[6] === 0 &&
    head[7] === 0 &&
    head[8] === 0 &&
    head[9] === 0
  ) {
    return "BMP";
  }
  if (ascii(head, 0, 5) === "{\\rtf") return "RTF";
  if (startsWith(head, ZIP_SIGNATURE)) return zipFormat(head, name);
  if (startsWith(head, OLE_SIGNATURE)) {
    const named = formatOfName(name);
    return named === "DOC" || named === "XLS" || named === "PPT" ? named : null;
  }
  const named = formatOfName(name);
  if (named && TEXT_FORMATS.has(named)) {
    const window = head.subarray(0, TEXT_WINDOW);
    return window.includes(0) ? null : named;
  }
  return null;
}

/**
 * What `file` is, with its first bytes in hand (4 KB is plenty): the bytes win
 * wherever they carry a signature, and the name's claim is kept in
 * `renamedFrom`. Bytes with no signature cannot overrule a name — a damaged
 * PDF is still called a PDF, and the tool that opens it says what is wrong —
 * except that a "text" file whose bytes hold NULs is not text.
 */
export function formatFromBytes(
  file: FileLike,
  head: Uint8Array,
): FormatVerdict {
  const named = formatOf(file);
  const sniffed = sniffFormat(head, file.name);
  if (sniffed === null) {
    if (named.format !== null && TEXT_FORMATS.has(named.format)) {
      return { format: null, renamedFrom: named.format, by: "bytes" };
    }
    return named;
  }
  return {
    format: sniffed,
    renamedFrom: named.format === sniffed ? null : named.format,
    by: "bytes",
  };
}
