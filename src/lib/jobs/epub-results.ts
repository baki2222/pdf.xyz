/**
 * Client-facing result metadata for `epub-to-pdf`: **what of the book the
 * PDF holds beyond its reading order, and which of its fonts it could use.**
 * Counts only, never a title, a file name or a word of the book.
 *
 * The engine counted these from the day it shipped (`fontsLeftOut`), but
 * only into the worker's log, so the page could not say "two of the book's
 * fonts were left out" for the job that left them out — and a static
 * sentence on the page cannot know (audit epub-to-pdf#3 and #4, 2026-11-06).
 * The note beside the download is built from this block and nothing else.
 *
 * Imported by `./results` (the sanitizer) and by the EPUB result note.
 */

export interface EpubResultMeta {
  /** Chapter files printed, the extra sections included. */
  chapters: number;
  /**
   * Sections the book keeps outside its reading order (spine items marked
   * `linear="no"`: endnotes, answer keys), printed after the last chapter.
   */
  extraSections: number;
  /**
   * Extra sections NOT printed: the book reached the chapter cap
   * (`EPUB_MAX_SPINE_ITEMS`) with its reading order. Absent from a worker
   * older than the wave 3 review, read as 0 (that worker refused such a
   * book instead).
   */
  extraSectionsLeftOut?: number;
  /**
   * Obfuscated fonts RESTORED and served. Restored is not used: a restored
   * font Chromium refuses still prints in a fallback font, unreported, so
   * the note and the FAQ speak of fonts that could not be RESTORED only.
   */
  fontsRestored: number;
  /** Obfuscated fonts that could not be restored, so were never served. */
  fontsLeftOut: number;
}

/** True when a value plausibly came from the real contract. */
export function isEpubResultMeta(value: unknown): value is EpubResultMeta {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as EpubResultMeta).chapters === "number" &&
    typeof (value as EpubResultMeta).fontsLeftOut === "number"
  );
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

/** Re-bound an untrusted block for persistence: non-negative integers. */
export function buildEpubResultMeta(raw: EpubResultMeta): EpubResultMeta {
  const chapters = count(raw.chapters);
  return {
    chapters,
    extraSections: Math.min(count(raw.extraSections), chapters),
    extraSectionsLeftOut: count(raw.extraSectionsLeftOut),
    fontsRestored: count(raw.fontsRestored),
    fontsLeftOut: count(raw.fontsLeftOut),
  };
}
