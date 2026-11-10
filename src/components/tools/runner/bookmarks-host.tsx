"use client";

import { lazy, Suspense } from "react";
import { Spinner } from "./runner-kit";
import { SinglePdfRunner } from "./single-pdf-runner";

/**
 * Edit PDF Bookmarks' runner, mounted by `metadata-runner.tsx` for its slug.
 * Only this shell is in the `metadata` kind's runner chunk — the drop box,
 * server-rendered like every runner's — so Edit PDF Metadata's and Remove
 * Annotations' first load carry a few hundred bytes for it, not the
 * editor. The editor (`bookmarks-editor.tsx`) and the engine are fetched
 * when a file opens, together and alongside its parse (`prepare`): no
 * request waits on another.
 */

const editorModule = () => import("./bookmarks-editor");

const BookmarksEditor = lazy(() =>
  editorModule().then(({ BookmarksEditor }) => ({ default: BookmarksEditor })),
);

const prepare = async () => {
  await Promise.all([editorModule(), import("@/lib/pdf/bookmarks")]);
};

export function BookmarksRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · bookmarks read and changed locally in your browser"
      handoffSlug="edit-pdf-bookmarks"
      toolName="Edit PDF Bookmarks"
      prepare={prepare}
    >
      {(pdf, reset) => (
        <Suspense
          fallback={
            <p className="text-muted inline-flex items-center gap-2 text-sm">
              <Spinner /> Opening the bookmark editor…
            </p>
          }
        >
          <BookmarksEditor pdf={pdf} onReset={reset} />
        </Suspense>
      )}
    </SinglePdfRunner>
  );
}
