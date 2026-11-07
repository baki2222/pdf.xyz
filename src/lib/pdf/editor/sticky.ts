/**
 * Comment (sticky note): a Note with `sticky: true`. On the page it is an
 * icon; its words live in a popup that a PDF reader opens on a click. It is
 * written as a /Text annotation with a /Popup (ISO 32000-1 §12.5.6.4 and
 * §12.5.6.14) — always, even when the other markups are flattened, because
 * a popup cannot be drawn into a page (`comments.ts`, `editor-export.ts`).
 *
 * Feature-scoped (the bundle budget, 2026-11-07): the editor's chunk and
 * its export import this; first-load code does not.
 */

/** The icon's side, viewer points — overlay, hit box and /Rect alike. */
export const STICKY_ICON = 20;
/** Gap between the icon and the popup it opens, points. */
export const STICKY_GAP = 4;

/** What the toolbar button is called. */
export const STICKY_LABEL = "Comment";

/** The popup's top-left: right of the icon, level with its top. */
export function stickyPopupOrigin(obj: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return { x: obj.x + STICKY_ICON + STICKY_GAP, y: obj.y };
}

/**
 * The name typed for comments' author (/T), kept in this browser only —
 * read and written through try/catch, since storage can be blocked.
 */
export const COMMENT_AUTHOR_KEY = "pdfxyz:comment-author";

export function readCommentAuthor(): string {
  try {
    return globalThis.localStorage?.getItem(COMMENT_AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeCommentAuthor(name: string): void {
  try {
    if (name.trim()) globalThis.localStorage?.setItem(COMMENT_AUTHOR_KEY, name);
    else globalThis.localStorage?.removeItem(COMMENT_AUTHOR_KEY);
  } catch {
    // Blocked storage: the name still applies to this export.
  }
}
