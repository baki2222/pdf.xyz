/**
 * How much of an AI or text result the page draws, as the result views
 * (`./ai-result-views`) apply it and the tool copy states it. A module of its
 * own, with no "use client" and no imports, so the server-rendered FAQ can
 * read the same numbers the lazy views enforce without importing them.
 */

/** The most characters of one text the page puts in the DOM. */
export const PAGE_TEXT_LIMIT = 50_000;
/** The most rows (or, for one record, fields) the extraction table draws. */
export const PAGE_ROW_LIMIT = 100;
/** The most columns the extraction table draws. */
export const PAGE_COLUMN_LIMIT = 50;
/** The most characters of one table cell the page draws. */
export const PAGE_CELL_LIMIT = 500;
