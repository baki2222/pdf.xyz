/**
 * Edit PDF Bookmarks' numbers, as ONE leaf: the engine (`bookmarks.ts`), the
 * panel (`bookmarks-editor.tsx`) and the tool page's prose
 * (`content/edit-pdf-bookmarks.ts`) all read them from here, so a limit
 * changed here is enforced, drawn and described in one change.
 *
 * The control LABELS are not here: they are written in the panel, where
 * `tool-page-substance.test.ts` reads the strings it draws and fails a page
 * that quotes one it does not.
 *
 * No pdf-lib, no DOM: the page's copy imports it without the engine.
 */

import { outputName } from "./files";

/**
 * The most bookmarks a file may hold for this tool to open it, and the most
 * the panel lets a reader build. Past it the engine REFUSES, typed and with
 * the count (`too-many-bookmarks`); it never truncates the list. A rendered
 * list of 5,000 rows is already slow on a phone; this is the honest ceiling.
 */
export const BOOKMARK_EDIT_MAX = 5000;

/**
 * The longest title a reader may TYPE, in characters. A title already in the
 * file is not held to it: an unedited title is written back as the very
 * string the file had, whatever its length.
 */
export const BOOKMARK_TITLE_MAX = 500;

/**
 * The deepest nesting read or written. A deeper outline is refused as
 * damaged (`damaged-outline`): no reader shows 64 levels usefully, and a
 * walk that stops anywhere short of the bottom would drop what is below.
 */
export const BOOKMARK_DEPTH_MAX = 64;

/** The download's name: `report.pdf` -> `report-bookmarks.pdf`. */
export function bookmarksOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "bookmarks");
}

/** "1 bookmark", "2,000 bookmarks". */
export function bookmarkCount(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "bookmark" : "bookmarks"}`;
}
