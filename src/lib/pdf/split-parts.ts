import { sanitizeSegment } from "./files";
import { rangeToIndices } from "./ranges";
import type { PageRange, SplitPart } from "./types";

/*
 * Split PDF's part names, kept OUT of ranges.ts (2026-11-07): ranges.ts is in
 * every tool page's first load (the page-range parser), and these are read
 * only by Split PDF. By-bookmark titles and the odd/even mode had grown that
 * shared chunk by about 150 B gz on every page.
 */

/** The longest part of a file name a title may take (audit split-pdf#5). */
export const SPLIT_TITLE_MAX_CHARS = 60;

/**
 * A bookmark title as a file-name segment: the characters no file system
 * takes removed (as {@link sanitizeSegment} does), control characters and
 * trailing dots or spaces dropped, at most {@link SPLIT_TITLE_MAX_CHARS}
 * long. Empty when nothing usable is left, so the caller keeps its own name.
 */
function titleSegment(title: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SPLIT_TITLE_MAX_CHARS);
  return cleaned.replace(/[.\s]+$/, "");
}

/**
 * Build named split parts from ranges. Names are zero-padded and carry the page
 * range so a folder of outputs sorts and reads sensibly. The base goes through
 * the same {@link sanitizeSegment} as every other output name, so a source
 * called "Q3: plan?.pdf" cannot write a ZIP entry Windows refuses to extract.
 *
 * `titles` (By bookmarks, since 2026-11-07: audit split-pdf#5) replaces a
 * part's page span with its title, made safe the same way; the sequence
 * number stays first, so the folder still sorts in page order and two parts
 * with one title cannot collide. A part with no usable title keeps its span.
 */
export function buildSplitParts(
  base: string,
  ranges: PageRange[],
  titles?: readonly (string | undefined)[],
): SplitPart[] {
  const safeBase = sanitizeSegment(base);
  const pad = String(ranges.length).length;
  return ranges.map((range, i) => {
    const seq = String(i + 1).padStart(pad, "0");
    const titled = titles?.[i] ? titleSegment(titles[i]!) : "";
    const label =
      titled ||
      (range.start === range.end
        ? `page-${range.start + 1}`
        : `pages-${range.start + 1}-${range.end + 1}`);
    return {
      name: `${safeBase}-${seq}-${label}.pdf`,
      indices: rangeToIndices(range),
    };
  });
}

/**
 * Split PDF's "odd and even pages" mode (audit split-pdf#6, 2026-11-07):
 * pages 1, 3, 5 … in one part and 2, 4, 6 … in another — the fronts and
 * backs of a double-sided scan. A one-page document has no even part. The
 * base is sanitised like every other part name.
 */
export function oddEvenParts(base: string, pageCount: number): SplitPart[] {
  const safeBase = sanitizeSegment(base);
  const every = (first: number) =>
    Array.from(
      { length: Math.max(0, Math.ceil((pageCount - first) / 2)) },
      (_, i) => first + i * 2,
    );
  const parts: SplitPart[] = [
    { name: `${safeBase}-odd-pages.pdf`, indices: every(0) },
    { name: `${safeBase}-even-pages.pdf`, indices: every(1) },
  ];
  return parts.filter((part) => part.indices.length > 0);
}
