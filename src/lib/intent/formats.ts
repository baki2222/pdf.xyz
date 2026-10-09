/**
 * What a file IS, decided one way for every surface that asks.
 *
 * Until 2026-10-09 the question had four answers, each written beside the code
 * that needed it: the hand-off gate branched per tool (a regex for text, one
 * for Markdown, a MIME list for the two image tools, `isLikelyPdf` for the
 * rest), the home picker admitted WebP and GIF that no tool takes, and the
 * guides folded JPEG into JPG with a private ternary. Now there is one order
 * of evidence:
 *
 *  1. the file's EXTENSION, when it names a format we know (supported or not);
 *  2. otherwise the TYPE the browser declared;
 *  3. and, when the caller has read the first bytes, the BYTES — which win,
 *     with the name's claim kept as `renamedFrom` so a surface can say
 *     "report.pdf is really a PNG image".
 *
 * The formats themselves are not typed here from memory: `FORMATS` must equal
 * the labels of `MIME_BY_FORMAT` (the table the server validates uploads
 * with), every tool's `accept` must name one of them, and every one of them
 * must be accepted somewhere — `formats.test.ts` holds all three, both ways.
 *
 * Dependency-free apart from two import-free leaves, so any chunk can afford
 * it: it never imports the catalogue; the one function that needs tools takes
 * them as an argument.
 */
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
  normalizeFormatLabel,
} from "@/lib/jobs/mime-by-format";
import {
  extensionOf,
  normalizeContentType,
} from "@/lib/uploads/intake/families";

/** Every format some tool takes, one spelling each (JPEG is JPG). */
export const FORMATS = [
  "PDF",
  "DOC",
  "DOCX",
  "XLS",
  "XLSX",
  "CSV",
  "PPT",
  "PPTX",
  "JPG",
  "PNG",
  "HTML",
  "MD",
  "TXT",
] as const;
export type Format = (typeof FORMATS)[number];

/**
 * Formats people bring that no tool here opens. The site says so in writing
 * ("No tool here opens HEIC photos."), so no tool may accept one of these —
 * held by `formats.test.ts`.
 */
export const UNSUPPORTED_FORMATS = [
  "HEIC",
  "HEIF",
  "WEBP",
  "GIF",
  "TIFF",
  "BMP",
  "SVG",
  "AVIF",
  "ODT",
  "ODS",
  "ODP",
  "RTF",
  "EPUB",
  "ZIP",
] as const;
export type UnsupportedFormat = (typeof UNSUPPORTED_FORMATS)[number];

export type FileFormat = Format | UnsupportedFormat;

/** How an unsupported format is recognised by name and by declared type. */
const UNSUPPORTED_SIGNS: Record<
  UnsupportedFormat,
  { readonly extensions: readonly string[]; readonly mimes: readonly string[] }
> = {
  HEIC: { extensions: ["heic"], mimes: ["image/heic", "image/heic-sequence"] },
  HEIF: { extensions: ["heif"], mimes: ["image/heif", "image/heif-sequence"] },
  WEBP: { extensions: ["webp"], mimes: ["image/webp"] },
  GIF: { extensions: ["gif"], mimes: ["image/gif"] },
  TIFF: { extensions: ["tif", "tiff"], mimes: ["image/tiff"] },
  BMP: { extensions: ["bmp"], mimes: ["image/bmp", "image/x-ms-bmp"] },
  SVG: { extensions: ["svg"], mimes: ["image/svg+xml"] },
  AVIF: { extensions: ["avif"], mimes: ["image/avif"] },
  ODT: {
    extensions: ["odt"],
    mimes: ["application/vnd.oasis.opendocument.text"],
  },
  ODS: {
    extensions: ["ods"],
    mimes: ["application/vnd.oasis.opendocument.spreadsheet"],
  },
  ODP: {
    extensions: ["odp"],
    mimes: ["application/vnd.oasis.opendocument.presentation"],
  },
  RTF: { extensions: ["rtf"], mimes: ["application/rtf", "text/rtf"] },
  EPUB: { extensions: ["epub"], mimes: ["application/epub+zip"] },
  ZIP: {
    extensions: ["zip"],
    mimes: ["application/zip", "application/x-zip-compressed"],
  },
};

/**
 * Types browsers send that `MIME_BY_FORMAT` does not list because the server
 * never needs to accept them as a declaration — the Markdown runner opens
 * `text/x-markdown`, so recognising it here keeps the two in step.
 */
const EXTRA_MIMES: Readonly<Record<string, Format>> = {
  "text/x-markdown": "MD",
};

const isFormat = (label: string): label is Format =>
  (FORMATS as readonly string[]).includes(label);

const BY_EXTENSION = new Map<string, FileFormat>();
const BY_MIME = new Map<string, FileFormat>();
for (const [label, extensions] of Object.entries(EXTENSIONS_BY_FORMAT)) {
  const format = normalizeFormatLabel(label);
  if (!isFormat(format)) continue;
  for (const ext of extensions) BY_EXTENSION.set(ext, format);
}
// Canonical (first) types first, so `text/plain` — which MD also tolerates —
// reads as TXT, the format whose own type it is.
for (const pass of [0, 1]) {
  for (const [label, mimes] of Object.entries(MIME_BY_FORMAT)) {
    const format = normalizeFormatLabel(label);
    if (!isFormat(format)) continue;
    const list = pass === 0 ? mimes.slice(0, 1) : mimes.slice(1);
    for (const mime of list) if (!BY_MIME.has(mime)) BY_MIME.set(mime, format);
  }
}
for (const [mime, format] of Object.entries(EXTRA_MIMES)) {
  BY_MIME.set(mime, format);
}
for (const [format, signs] of Object.entries(UNSUPPORTED_SIGNS) as [
  UnsupportedFormat,
  (typeof UNSUPPORTED_SIGNS)[UnsupportedFormat],
][]) {
  for (const ext of signs.extensions) BY_EXTENSION.set(ext, format);
  for (const mime of signs.mimes) BY_MIME.set(mime, format);
}

/** Formats recognised by extension only, and only when the bytes are text. */
const TEXT_FORMATS: ReadonlySet<FileFormat> = new Set<FileFormat>([
  "TXT",
  "MD",
  "CSV",
  "HTML",
  "SVG",
]);

/** The format a typed word names — "jpeg", "HTM", "heic" — or null. */
export function formatForToken(word: string): FileFormat | null {
  const lower = word.trim().toLowerCase();
  const byExt = BY_EXTENSION.get(lower);
  if (byExt) return byExt;
  const upper = normalizeFormatLabel(lower);
  if (isFormat(upper)) return upper;
  return (UNSUPPORTED_FORMATS as readonly string[]).includes(upper)
    ? (upper as UnsupportedFormat)
    : null;
}

/** What a file is, and on what evidence. */
export interface FormatVerdict {
  /** The format, or null when nothing recognises the file. */
  readonly format: FileFormat | null;
  /** What the name (or declared type) claimed, when the bytes disagree. */
  readonly renamedFrom: FileFormat | null;
  readonly by: "extension" | "type" | "bytes" | null;
}

/** The minimal file shape: a `File`, or its metadata. */
export interface FileLike {
  readonly name: string;
  readonly type?: string;
}

function byName(file: FileLike): FormatVerdict {
  const ext = extensionOf(file.name);
  const byExt = ext === null ? undefined : BY_EXTENSION.get(ext);
  if (byExt) return { format: byExt, renamedFrom: null, by: "extension" };
  const mime = normalizeContentType(file.type ?? "");
  const byType = mime === null ? undefined : BY_MIME.get(mime);
  if (byType) return { format: byType, renamedFrom: null, by: "type" };
  return { format: null, renamedFrom: null, by: null };
}

/**
 * What `file` is. Without `head` this reads the name, then the declared type.
 * With `head` (the file's first bytes; 4 KB is plenty) the bytes win wherever
 * they carry a signature, and the name's claim is kept in `renamedFrom`.
 * Bytes with no signature cannot overrule a name — a damaged PDF is still
 * called a PDF, and the tool that opens it says what is wrong — except that
 * a "text" file whose bytes hold NULs is not text.
 */
export function formatOf(file: FileLike, head?: Uint8Array): FormatVerdict {
  const named = byName(file);
  if (!head) return named;
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
  const ext = extensionOf(name);
  const named = ext === null ? undefined : BY_EXTENSION.get(ext);
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
    const ext = extensionOf(name);
    const named = ext === null ? undefined : BY_EXTENSION.get(ext);
    return named === "DOC" || named === "XLS" || named === "PPT" ? named : null;
  }
  const ext = extensionOf(name);
  const named = ext === null ? undefined : BY_EXTENSION.get(ext);
  if (named && TEXT_FORMATS.has(named)) {
    const window = head.subarray(0, TEXT_WINDOW);
    return window.includes(0) ? null : named;
  }
  return null;
}

/** Does an `accept` row (catalogue labels, any spelling) take `format`? */
export function toolAcceptsFormat(
  accept: readonly string[],
  format: FileFormat | null,
): boolean {
  if (format === null) return false;
  return accept.some((label) => normalizeFormatLabel(label) === format);
}

/** The tool fields the converter rule reads. */
export interface ConvertingTool {
  readonly slug: string;
  readonly accept: readonly string[];
  readonly outputs: readonly string[];
}

/**
 * The tool that turns a file of `format` into a PDF: one that outputs PDF,
 * does not itself take PDF, and accepts the format. Several can (JPG to PDF
 * and PNG to PDF each take both image formats); the tool whose OWN format it
 * is — first in its `accept` — wins, and catalogue order decides the rest.
 */
export function converterToPdf<T extends ConvertingTool>(
  format: FileFormat | null,
  tools: readonly T[],
): T | undefined {
  if (format === null) return undefined;
  const converters = tools.filter(
    (t) =>
      t.outputs.includes("PDF") &&
      !toolAcceptsFormat(t.accept, "PDF") &&
      toolAcceptsFormat(t.accept, format),
  );
  return (
    converters.find(
      (t) => t.accept[0] && normalizeFormatLabel(t.accept[0]) === format,
    ) ?? converters[0]
  );
}
