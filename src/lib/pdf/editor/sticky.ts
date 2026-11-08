/**
 * Comment (sticky note): a Note with `sticky: true`. On the page it is an
 * icon; its words live in a popup that a PDF reader opens on a click. It is
 * written as a /Text annotation with a /Popup (ISO 32000-1 §12.5.6.4 and
 * §12.5.6.14) — always, even when the other markups are flattened, because
 * a popup cannot be drawn into a page (`comments.ts`, `editor-export.ts`).
 *
 * A feature-scoped module of its own (the bundle budget, 2026-11-07).
 * Importers today: the editor's lazy chunk and session, Annotate PDF's
 * runner (its footer), the export (`comments.ts`), the editor model
 * (`model.ts`, and through it Create Forms' runner, Create Forms' and Edit
 * PDF's content and the guides catalogue), the tool facts, and Annotate and
 * Edit PDF's content directly.
 */

/** How wide a new comment's popup is, points. */
export const STICKY_POPUP_WIDTH = 200;

/** The icon's side, viewer points — overlay, hit box and /Rect alike. */
export const STICKY_ICON = 20;
/** Gap between the icon and the popup it opens, points. */
export const STICKY_GAP = 4;

/** What the toolbar button is called. */
export const STICKY_LABEL = "Comment";

/**
 * The exception every sentence about flattening names (the review of
 * 62aa1808, 2026-11-08): a Comment is a comment even in flatten mode.
 * `sticky-exception-copy.test.ts` finds the sentences that need it.
 */
export const STICKY_STAYS_COMMENT = `A ${STICKY_LABEL} is always saved as a PDF comment, even when the rest is flattened, because a popup cannot be drawn into a page.`;

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

/** What the name field beside Apply & download is called. */
export const COMMENT_AUTHOR_LABEL = "Your name on comments (optional)";

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
