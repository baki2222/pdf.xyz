/**
 * How much of each table Extract Tables' result card previews (competitor
 * audit #22, 2026-11-17): rows per table, the first row included, and the
 * most tables shown, past which the first table on each page is shown (up to
 * that many pages) and the card says so.
 *
 * A leaf of its own, imported by the preview's lazy chunk and by the tool
 * page's copy (server-rendered). Not in `./extract-tables-options`: that
 * module is in the Extract Tables page's first load (the panel imports it),
 * and a new export there, or a second importer from a lazy chunk, can cost
 * that first load bytes.
 */
export const TABLE_PREVIEW_ROWS = 5;
export const MAX_PREVIEW_TABLES = 6;
