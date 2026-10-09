/**
 * The hand-off database's name — a leaf, so the browser-storage registry
 * (`src/lib/browser-storage.ts`, rendered by /privacy) can name it without
 * importing the IndexedDB code that opens it.
 */
export const HANDOFF_DB_NAME = "pdfxyz-handoff";

/** The one object store inside it, keyed by hand-off id. */
export const HANDOFF_STORE = "handoffs";
