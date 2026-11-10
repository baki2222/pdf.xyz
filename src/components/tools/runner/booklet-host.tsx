"use client";

import { SinglePdfRunner } from "./single-pdf-runner";
import { lazyPanel } from "./lazy-panel";

/**
 * PDF Booklet Maker's runner, mounted by `n-up-runner.tsx` for its slug.
 * Only this drop box is in the `n-up` kind's chunk; the editor
 * (`booklet-editor.tsx`, with `booklet.ts`) is fetched when a file opens,
 * beside its parse, so Multiple Pages per Sheet's page loads none of it
 * (`src/deploy/variant-panels.test.ts`).
 */
const booklet = lazyPanel(
  () => import("./booklet-editor").then(({ BookletEditor }) => BookletEditor),
  "Opening the booklet editor…",
);

export function BookletRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · pages put in booklet order locally in your browser"
      handoffSlug="booklet-pdf"
      toolName="PDF Booklet Maker"
      prepare={booklet.prepare}
    >
      {(pdf, reset) => <booklet.Panel pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}
