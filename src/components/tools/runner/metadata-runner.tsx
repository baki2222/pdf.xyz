"use client";

import { SinglePdfRunner } from "./single-pdf-runner";
import { RemoveAnnotationsRunner } from "./remove-annotations-host";
import { BookmarksRunner } from "./bookmarks-host";
import { lazyPanel } from "./lazy-panel";
import { useToolRun } from "./tool-context";

/*
 * Edit PDF Metadata's editor, fetched when a file opens — beside its parse,
 * never after it — so the other pages on this kind load none of it
 * (`src/deploy/variant-panels.test.ts`).
 */
const metadata = lazyPanel(
  () =>
    import("./metadata-editor").then(({ MetadataEditor }) => MetadataEditor),
  "Opening the metadata editor…",
);

/**
 * The `metadata` runner kind's tools: Edit PDF Metadata
 * (`metadata-editor.tsx`), Remove Annotations
 * (`remove-annotations-host.tsx`) and Edit PDF Bookmarks
 * (`bookmarks-host.tsx`), which share the kind's rows — one PDF,
 * `MAX_PDF_BYTES`, read with pdf-lib, no mid-run fetch — and are told apart
 * here by their page's slug, not by a dispatcher arm. Only the drop boxes
 * are in the kind's chunk: each tool's editor loads with a file, on its own
 * page alone.
 */
export function MetadataRunner() {
  const slug = useToolRun()?.slug;
  if (slug === "remove-annotations") {
    return <RemoveAnnotationsRunner />;
  }
  if (slug === "edit-pdf-bookmarks") {
    return <BookmarksRunner />;
  }
  return (
    <SinglePdfRunner
      hint="One PDF · metadata read and changed locally in your browser"
      handoffSlug="edit-pdf-metadata"
      toolName="Edit PDF Metadata"
      prepare={metadata.prepare}
    >
      {(pdf, reset) => <metadata.Panel pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}
