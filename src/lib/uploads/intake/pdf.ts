/**
 * Bounded, content-free **PDF structural sniff**.
 *
 * The only byte-level check the intake layer performs, and only ever inside two
 * small fixed windows: the leading bytes (for the `%PDF-` header) and the trailing
 * bytes (for the `%%EOF` marker). It answers a single question — "does this even
 * look like a PDF envelope?" — and nothing about the document's contents:
 *
 *  - It scans for two fixed ASCII signatures. It never decodes, decompresses,
 *    parses objects, counts pages, or reads text. There is no path by which a
 *    document's contents influence the output beyond the presence of two markers.
 *  - Both scans are bounded by the policy's window sizes, so cost is O(window),
 *    independent of file size — a 100 MB file is inspected as cheaply as a 1 KB
 *    one, and a decompression/parse "bomb" is never triggered here. Stream
 *    decompression and page-count/complexity analysis are deliberately left to the
 *    worker, which runs them under its own resource limits (see
 *    docs/WORKER_ARCHITECTURE.md and docs/SECURITY.md).
 *
 * The PDF spec places the header within the first 1024 bytes and the file's last
 * line as `%%EOF` (possibly followed by trailing whitespace/newlines); the default
 * windows cover both with margin while staying strict enough to reject a file that
 * is plainly not a PDF.
 */

/** The `%PDF-` header signature. */
const PDF_HEADER = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
/** The `%%EOF` end-of-file marker. */
const PDF_EOF = Uint8Array.from([0x25, 0x25, 0x45, 0x4f, 0x46]); // "%%EOF"

/**
 * Does `needle` occur in `haystack` within the half-open byte range `[start, end)`?
 * A tiny, allocation-free scan; `end` is clamped to the buffer so callers can pass
 * a window larger than the data without special-casing short files.
 */
function containsWithin(
  haystack: Uint8Array,
  needle: Uint8Array,
  start: number,
  end: number,
): boolean {
  const stop = Math.min(end, haystack.length) - needle.length;
  for (let i = Math.max(0, start); i <= stop; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** Why a buffer failed the PDF structural sniff. `null` reasons never surface. */
export type PdfSniffReason = "empty" | "missing_header" | "missing_eof";

/** The structural findings for a buffer, over bounded windows only. */
export interface PdfSniff {
  /** The buffer has no bytes at all. */
  readonly empty: boolean;
  /** A `%PDF-` header was found within the leading window. */
  readonly hasHeader: boolean;
  /** A `%%EOF` marker was found within the trailing window. */
  readonly hasEof: boolean;
}

/** Window sizes for the two scans; both are clamped against the buffer length. */
export interface PdfSniffWindows {
  readonly pdfHeaderScanBytes: number;
  readonly pdfTrailerScanBytes: number;
}

/**
 * Inspect `bytes` for the two PDF structural markers within the policy windows.
 * Pure and total: any input yields a verdict, never a throw. Reads at most
 * `pdfHeaderScanBytes + pdfTrailerScanBytes` bytes regardless of file size.
 */
export function sniffPdf(bytes: Uint8Array, windows: PdfSniffWindows): PdfSniff {
  if (bytes.length === 0) {
    return { empty: true, hasHeader: false, hasEof: false };
  }
  const hasHeader = containsWithin(
    bytes,
    PDF_HEADER,
    0,
    windows.pdfHeaderScanBytes,
  );
  const trailerStart = Math.max(0, bytes.length - windows.pdfTrailerScanBytes);
  const hasEof = containsWithin(bytes, PDF_EOF, trailerStart, bytes.length);
  return { empty: false, hasHeader, hasEof };
}
