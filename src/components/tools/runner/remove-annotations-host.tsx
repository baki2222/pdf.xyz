"use client";

import { SinglePdfRunner } from "./single-pdf-runner";
import { lazyPanel } from "./lazy-panel";

/**
 * Remove Annotations' runner, mounted by `metadata-runner.tsx` for its slug.
 * Only this drop box is in the `metadata` kind's chunk; the editor
 * (`remove-annotations-editor.tsx`) and the engine it imports lazily are
 * fetched when a file opens, together and beside its parse, so Edit PDF
 * Metadata's and Edit PDF Bookmarks' pages load none of it
 * (`src/deploy/variant-panels.test.ts`).
 */
const removeAnnotations = lazyPanel(
  () =>
    import("./remove-annotations-editor").then(
      ({ RemoveAnnotationsEditor }) => RemoveAnnotationsEditor,
    ),
  "Opening the annotation list…",
  () => import("@/lib/pdf/remove-annotations"),
);

export function RemoveAnnotationsRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · annotations listed and removed locally in your browser"
      handoffSlug="remove-annotations"
      toolName="Remove Annotations"
      prepare={removeAnnotations.prepare}
    >
      {(pdf, reset) => <removeAnnotations.Panel pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}
