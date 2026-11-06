/**
 * EPUB to PDF options — the paper a reflowable book is printed on, and its
 * margins. Pure data plus one strict parser, like `./html-render-options`,
 * whose tables these are: the same sizes (less "As the page sets it", which
 * a book's chapters do not), and the same margins.
 *
 * A fixed-layout (pre-paginated) page ignores both: it is printed at the
 * size its own viewport declares, edge to edge (`@/lib/workers/epub/engine`).
 */
import { HTML_MARGINS, HTML_PAGE_SIZES } from "./html-render-options";
import { apiError, type ParseResult } from "./responses";

/** HTML to PDF's sizes less "auto" (`satisfies` below holds the two together). */
export type EpubPageSize = "A4" | "Letter" | "Legal" | "A3" | "A5";
/** HTML to PDF's margins. */
export type EpubMargin = "none" | "small" | "normal";

/** The sizes offered, in the HTML tables' order. */
export const EPUB_PAGE_SIZES = HTML_PAGE_SIZES.filter(
  (s): s is (typeof HTML_PAGE_SIZES)[number] & { id: EpubPageSize } =>
    s.id !== "auto",
);
export const EPUB_MARGINS = HTML_MARGINS satisfies readonly {
  id: EpubMargin;
}[];

export interface EpubRenderOptions {
  pageSize: EpubPageSize;
  margin: EpubMargin;
}

/**
 * A5 (148 × 210 mm) by default: about the page of a paperback, so a
 * chapter's lines run at a book's length rather than across a Letter sheet.
 */
export const DEFAULT_EPUB_RENDER_OPTIONS: EpubRenderOptions = {
  pageSize: "A5",
  margin: "normal",
};

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

/** Parse an `epub-to-pdf` job's options; an unknown value is refused. */
export function parseEpubRenderOptions(
  options: Record<string, unknown>,
): ParseResult<EpubRenderOptions> {
  const size = options.pageSize ?? DEFAULT_EPUB_RENDER_OPTIONS.pageSize;
  const pageSize = EPUB_PAGE_SIZES.find((s) => s.id === size);
  if (!pageSize)
    return invalid(
      `\`options.pageSize\` must be one of ${EPUB_PAGE_SIZES.map((s) => `"${s.id}"`).join(", ")}.`,
      "options.pageSize",
    );
  const m = options.margin ?? DEFAULT_EPUB_RENDER_OPTIONS.margin;
  const margin = EPUB_MARGINS.find((x) => x.id === m);
  if (!margin)
    return invalid(
      `\`options.margin\` must be one of ${EPUB_MARGINS.map((x) => `"${x.id}"`).join(", ")}.`,
      "options.margin",
    );
  return { ok: true, value: { pageSize: pageSize.id, margin: margin.id } };
}

/** Only what differs from the defaults travels. */
export function epubRenderOptionsBag(
  options: EpubRenderOptions,
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  if (options.pageSize !== DEFAULT_EPUB_RENDER_OPTIONS.pageSize)
    bag.pageSize = options.pageSize;
  if (options.margin !== DEFAULT_EPUB_RENDER_OPTIONS.margin)
    bag.margin = options.margin;
  return bag;
}
