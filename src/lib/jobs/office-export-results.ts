/**
 * Client-facing result metadata for PDF to Word / Excel / PowerPoint: **which
 * pages had text to export.**
 *
 * The export reads a PDF's selectable text and nothing else. A page that is a
 * scan has none, and it used to vanish without a word: measured with the
 * production engine and poppler, a five-page document whose pages were images
 * apart from a 34-character stamp on page 1 came back `ok: true` with a
 * one-line DOCX, and the page said "Your DOCX file is ready." The only OCR hint
 * fired when the WHOLE document had no text, so a partly scanned one — a signed
 * contract, a fax with a typed header — lost pages silently.
 *
 * Two page lists, because they are different claims:
 *  - `pagesWithoutText` — no selectable text at all. Certain: nothing from
 *    these pages is in the file.
 *  - `pagesWithLittleText` — some text, under {@link LITTLE_TEXT_CHARS}
 *    characters. A stamp, a Bates number or a fax header on an otherwise
 *    scanned page reads as "has text", which is the blind spot of counting
 *    empty pages alone. It is also what a title slide looks like, so the UI
 *    says "if these are scans", never "these are scans".
 *
 * The counts are exact; the lists are capped at {@link MAX_LISTED_PAGES} so a
 * 2,000-page scan cannot write an unbounded array onto a job record — the UI
 * says how many it is not naming. A missing block means "this worker did not
 * report" (the worker image deploys by hand and can be older than the web tier),
 * never "every page had text".
 */

/** Pages with fewer normalized characters than this are reported as sparse. */
export const LITTLE_TEXT_CHARS = 40;
/** The most page numbers a block lists; the counts stay exact beyond it. */
export const MAX_LISTED_PAGES = 50;

export interface OfficeExportResultMeta {
  /** Pages in the source PDF. */
  pageCount: number;
  /** Pages with any selectable text — the ones that reached the file. */
  textPageCount: number;
  /** 1-based page numbers with no selectable text, ascending, capped. */
  pagesWithoutText: number[];
  /** How many pages have some text but under {@link LITTLE_TEXT_CHARS}. */
  littleTextPageCount: number;
  /** 1-based page numbers of those pages, ascending, capped. */
  pagesWithLittleText: number[];
  /**
   * PDF to PowerPoint since 2026-10-10, and PDF to Word since 2026-10-17:
   * how many pages have no text and are in the file as PICTURES only (a
   * scan, a screenshot), so their words are not editable. Before those dates
   * a page with no text reached the deck as an empty slide, and the document
   * not at all, and this field is absent from those results — the panel then
   * says what that engine did, not what this one does.
   */
  picturePageCount?: number;
  /** 1-based page numbers of those pages, ascending, capped. */
  pagesAsPictures?: number[];
  /**
   * PDF to PowerPoint since 2026-10-11, and PDF to Word since 2026-10-17:
   * pictures the pages paint that are NOT in the file — too large for the
   * worker's memory budget, or
   * data pdf.js could not decode. Before that date such a picture left no
   * trace, and a page that held only a full-page scan was reported as having
   * "nothing on it". Absent from older results: that engine did not count,
   * and the panel must not read the absence as zero lost.
   */
  picturesNotCarried?: number;
  /** Of those, how many were too large (the rest could not be decoded). */
  picturesTooLarge?: number;
  /**
   * PDF to Word only, since the review of 2026-10-17: of those, how many
   * were left out to keep the document inside what one conversion carries —
   * its size, its number of pictures, its decoding, its time. Until then a
   * document past any of them was refused whole, text and all.
   */
  picturesOverBudget?: number;
  /** 1-based page numbers with such pictures, ascending, capped. */
  pagesMissingPictures?: number[];
  /**
   * PDF to PowerPoint only, since 2026-10-11: slides with nothing on them
   * because their page has nothing — no text, nothing drawn, no picture
   * lost. Reported, not derived: "pages without text minus picture pages"
   * also counted pages whose picture was lost.
   */
  emptySlideCount?: number;
  /**
   * PDF to Word only, since the review of 2026-10-17: pages with nothing in
   * the document because the page reader SAW nothing on them — no text, no
   * picture carried, none lost or left out, none it may have missed — and
   * their numbers. Reported, not derived, as {@link emptySlideCount} is:
   * until then the notice subtracted (pages without text, less the pages
   * that came through as pictures) and said "no selectable text and no
   * picture" of a page whose picture could not be decoded.
   */
  emptyPageCount?: number;
  /** 1-based page numbers of those pages, ascending, capped. */
  pagesEmpty?: number[];
  /**
   * PDF to PowerPoint only, since 2026-10-11: pages drawn as ONE picture,
   * their text in invisible boxes over it, because rebuilding their drawing
   * piece by piece in paint order would have taken too many layers.
   */
  flattenedPageCount?: number;
  /** 1-based page numbers of those pages, ascending, capped. */
  pagesFlattened?: number[];
  /**
   * PDF to PowerPoint since 2026-10-11, and PDF to Word since 2026-10-17:
   * the page reader could not read
   * the PDF ahead (it looked damaged), so the worker rebuilt it the way
   * Repair PDF does and converted the rebuilt copy. Present only as `true`.
   */
  repairedBeforeConversion?: true;
}

/** True when a value plausibly came from the real office-export contract. */
export function isOfficeExportResultMeta(
  value: unknown,
): value is OfficeExportResultMeta {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as OfficeExportResultMeta).pageCount === "number" &&
    typeof (value as OfficeExportResultMeta).textPageCount === "number"
  );
}

function count(value: unknown, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(max, Math.max(0, Math.floor(n)));
}

function pageList(value: unknown, pageCount: number): number[] {
  if (!Array.isArray(value)) return [];
  const pages = new Set<number>();
  for (const v of value)
    if (Number.isInteger(v) && v >= 1 && v <= pageCount) pages.add(v);
  return [...pages].sort((a, b) => a - b).slice(0, MAX_LISTED_PAGES);
}

/**
 * Re-bound an untrusted block for persistence: non-negative integer counts,
 * `textPageCount <= pageCount`, page numbers that exist, lists capped.
 */
export function buildOfficeExportResultMeta(
  raw: OfficeExportResultMeta,
): OfficeExportResultMeta {
  const pageCount = count(raw.pageCount, 100_000);
  const textPageCount = count(raw.textPageCount, pageCount);
  // The picture pages are a subset of the pages without text: a slide that
  // carries text is not "pictures only", whatever the block claims.
  const withoutText = pageCount - textPageCount;
  return {
    pageCount,
    textPageCount,
    pagesWithoutText: pageList(raw.pagesWithoutText, pageCount),
    littleTextPageCount: count(raw.littleTextPageCount, textPageCount),
    pagesWithLittleText: pageList(raw.pagesWithLittleText, pageCount),
    // Copied only when the worker reported them: an absent count means an
    // engine that did not keep pictures, and must not read as zero.
    ...(raw.picturePageCount !== undefined
      ? {
          picturePageCount: count(raw.picturePageCount, withoutText),
          pagesAsPictures: pageList(raw.pagesAsPictures, pageCount),
        }
      : {}),
    // The same rule for the losses: copied only when reported.
    ...(raw.picturesNotCarried !== undefined
      ? (() => {
          const lost = count(raw.picturesNotCarried, 1_000_000);
          return {
            picturesNotCarried: lost,
            picturesTooLarge: count(raw.picturesTooLarge, lost),
            pagesMissingPictures: pageList(raw.pagesMissingPictures, pageCount),
          };
        })()
      : {}),
    ...(raw.emptySlideCount !== undefined
      ? { emptySlideCount: count(raw.emptySlideCount, withoutText) }
      : {}),
    ...(raw.emptyPageCount !== undefined
      ? {
          emptyPageCount: count(raw.emptyPageCount, withoutText),
          pagesEmpty: pageList(raw.pagesEmpty, pageCount),
        }
      : {}),
    ...(raw.flattenedPageCount !== undefined
      ? {
          flattenedPageCount: count(raw.flattenedPageCount, pageCount),
          pagesFlattened: pageList(raw.pagesFlattened, pageCount),
        }
      : {}),
    // Only `true` is a claim; anything else is dropped, not coerced.
    ...(raw.repairedBeforeConversion === true
      ? { repairedBeforeConversion: true as const }
      : {}),
  };
}

/**
 * Measure a finished export from the per-page text that WENT INTO the file.
 *
 * It takes the same page texts the writer used, not a second extraction: a
 * count derived separately is how a notice ends up naming the wrong page.
 * Whitespace is collapsed before counting so layout padding cannot make a
 * stamp look like a page of text.
 */
export function measureOfficeExportPages(
  pageCount: number,
  pages: readonly { pageNumber: number; text: string }[],
): OfficeExportResultMeta {
  const chars = new Map<number, number>();
  for (const page of pages)
    chars.set(
      page.pageNumber,
      (chars.get(page.pageNumber) ?? 0) +
        page.text.replace(/\s+/g, " ").trim().length,
    );
  const without: number[] = [];
  const little: number[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    const c = chars.get(n) ?? 0;
    if (c === 0) without.push(n);
    else if (c < LITTLE_TEXT_CHARS) little.push(n);
  }
  return buildOfficeExportResultMeta({
    pageCount,
    textPageCount: pageCount - without.length,
    pagesWithoutText: without,
    littleTextPageCount: little.length,
    pagesWithLittleText: little,
  });
}

/**
 * Job error codes for the export failures that belong to the DOCUMENT, not the
 * run — a retry returns the same answer, and each has its own next step (OCR,
 * Unlock, Repair). Shared by the worker that sets them and the panel that links
 * the next step from them, so the link never keys on message text.
 */
export const OFFICE_EXPORT_ERROR_CODES = {
  noText: "pdf_no_text",
  passwordProtected: "pdf_password_protected",
  unreadable: "pdf_unreadable",
} as const;
