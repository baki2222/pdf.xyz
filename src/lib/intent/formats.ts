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
 *     "report.pdf is really a PNG image". That half is `./sniff`, a module of
 *     its own because every tool page loads this one (the hand-off gate reads
 *     it) and none of them reads bytes to decide where a file can go.
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

/**
 * How an unsupported format is recognised by name and by declared type.
 * Exported for `capability.test.ts`, which builds its corpus from every table
 * that decides what a file is.
 */
export const UNSUPPORTED_SIGNS: Record<
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
export const EXTRA_MIMES: Readonly<Record<string, Format>> = {
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

/**
 * What `file` is, by its name, then its declared type. With the file's first
 * bytes in hand, `formatFromBytes` (`./sniff`) lets the signature win.
 */
export function formatOf(file: FileLike): FormatVerdict {
  const ext = extensionOf(file.name);
  const byExt = ext === null ? undefined : BY_EXTENSION.get(ext);
  if (byExt) return { format: byExt, renamedFrom: null, by: "extension" };
  const mime = normalizeContentType(file.type ?? "");
  const byType = mime === null ? undefined : BY_MIME.get(mime);
  if (byType) return { format: byType, renamedFrom: null, by: "type" };
  return { format: null, renamedFrom: null, by: null };
}

/** The format a file NAME's extension names, or null. */
export function formatOfName(name: string): FileFormat | null {
  const ext = extensionOf(name);
  return (ext === null ? undefined : BY_EXTENSION.get(ext)) ?? null;
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
