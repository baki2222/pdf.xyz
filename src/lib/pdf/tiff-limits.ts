/**
 * What JPG / PNG to PDF's TIFF reader (`tiff.ts`) takes and refuses, as a
 * LEAF: the tool facts and copy state these, and must not pull the reader
 * (and `utif`) into the catalogue to learn them. `tiff.ts` reads its limits
 * from here, so the number a page states is the number that refuses.
 */
import { MAX_DECODED_PIXELS } from "./pixel-ceiling";

/** The most pages one TIFF may bring: a long fax batch, not a book scan. */
export const MAX_TIFF_PAGES = 500;

/** The most pixels one TIFF page may have — the shared decode ceiling. */
export const MAX_TIFF_PAGE_PIXELS = MAX_DECODED_PIXELS;

/** The compressions the reader reads, by their TIFF code, by the names copy uses. */
export const TIFF_COMPRESSIONS = {
  1: "uncompressed",
  3: "CCITT Group 3",
  4: "CCITT Group 4",
  5: "LZW",
  7: "JPEG",
  8: "Deflate",
  32946: "Deflate",
  32773: "PackBits",
} as const satisfies Record<number, string>;

/** Compressions met in the wild that this does NOT read, named for the refusal. */
const UNREAD_COMPRESSIONS: Record<number, string> = {
  2: "CCITT modified Huffman",
  6: "old-style JPEG",
  34661: "JBIG",
  34712: "JPEG 2000",
  34925: "LZMA",
  50000: "Zstandard",
  50001: "WebP",
};
const megapixels = (n: number) => Math.round(n / 1_000_000);
const thousands = (n: number) => n.toLocaleString("en-US");

/** Refusals, worded once: each names the file and, where it can, the page. */
export const tiffRefusal = {
  damaged: (name: string, page?: number) =>
    page === undefined
      ? `"${name}" is a damaged TIFF and could not be read.`
      : `"${name}" page ${page} is damaged and could not be read.`,
  tooManyPages: (name: string) =>
    `"${name}" has more than ${MAX_TIFF_PAGES} pages, the most one TIFF can bring here. Split it into smaller TIFFs first.`,
  tooLarge: (name: string, page: number, width: number, height: number) =>
    `"${name}" page ${page} is ${thousands(width)} × ${thousands(height)} pixels, more than the ${megapixels(MAX_TIFF_PAGE_PIXELS)} megapixels a page can have here.`,
  tooMuchData: (name: string, page: number) =>
    `"${name}" page ${page} holds more image data than a page can have here.`,
  compression: (name: string, page: number, code: number) =>
    `"${name}" page ${page} uses ${UNREAD_COMPRESSIONS[code] ?? `compression type ${code}`} compression, which this tool cannot read.`,
  colours: (name: string, page: number, detail: string) =>
    `"${name}" page ${page} stores its pixels in a way this tool cannot read (${detail}).`,
  bigTiff: (name: string) =>
    `"${name}" is a BigTIFF, which this tool cannot read.`,
};
