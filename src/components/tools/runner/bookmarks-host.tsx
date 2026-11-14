"use client";

import { SinglePdfRunner } from "./single-pdf-runner";
import { lazyPanel } from "./lazy-panel";

/**
 * Edit PDF Bookmarks' runner, mounted by `metadata-runner.tsx` for its slug.
 * Only this shell is in the `metadata` kind's runner chunk — the drop box,
 * server-rendered like every runner's — so Edit PDF Metadata's and Remove
 * Annotations' first load carry a few hundred bytes for it, not the
 * editor. The editor (`bookmarks-editor.tsx`) and the engine are fetched
 * when a file opens, together and alongside its parse (`prepare`): no
 * request waits on another. Through `lazyPanel`, like its siblings, so a
 * chunk that fails to arrive is an inline message with a retry rather than
 * the error boundary (it was its own `React.lazy` until 2026-11-14).
 */
const bookmarks = lazyPanel(
  () =>
    import("./bookmarks-editor").then(({ BookmarksEditor }) => BookmarksEditor),
  "Opening the bookmark editor…",
  () => import("@/lib/pdf/bookmarks"),
);

export function BookmarksRunner() {
  bookmarks.useIntent();
  return (
    <SinglePdfRunner
      hint="One PDF · bookmarks read and changed locally in your browser"
      handoffSlug="edit-pdf-bookmarks"
      toolName="Edit PDF Bookmarks"
      prepare={bookmarks.prepare}
    >
      {(pdf, reset) => <bookmarks.Panel pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}
