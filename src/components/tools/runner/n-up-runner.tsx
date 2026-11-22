"use client";

import dynamic from "next/dynamic";
import { SinglePdfRunner, type SinglePdfBatch } from "./single-pdf-runner";
import { BookletRunner } from "./n-up/booklet-host";
import { lazyPanel } from "./lazy-panel";
import { useToolRun } from "./tool-context";

/*
 * Multiple Pages per Sheet's editor, fetched when a file opens — beside its
 * parse, never after it — so Booklet's page, on the same kind, loads none of
 * it (`src/deploy/variant-panels.test.ts`).
 */
const nUp = lazyPanel(
  () => import("./n-up/n-up-editor").then(({ NUpEditor }) => NUpEditor),
  "Opening the sheet editor…",
);

/**
 * Multiple Pages per Sheet, or Booklet on Booklet's page: both tools put
 * pages on new sheets with the same page drawings (`embedSourcePages`), so
 * they share this runner kind ('n-up') and the page picks the editor by its
 * own slug. One element in the dispatcher's case; no loader of its own.
 * Only the drop boxes are in the kind's chunk: each tool's editor
 * (`n-up/n-up-editor.tsx`, `n-up/booklet-editor.tsx`) loads with a file, on
 * its own page alone. They live in `n-up/` because a runner's own
 * components do: the guards that read "a runner's files"
 * (displayed-frame-claims) follow a runner into its subdirectory, not into
 * the shared siblings beside it.
 */
export function NUpRunner() {
  const slug = useToolRun()?.slug;
  if (slug === "booklet-pdf") return <BookletRunner />;
  return <NUpSheetsRunner />;
}

/**
 * Two or more PDFs: the batch (audit platform#1, 2026-11-22), its own chunk,
 * fetched only when they arrive — never with a visit to this page.
 */
const NUpBatch = dynamic(
  () => import("./batch/n-up-batch").then((m) => m.NUpBatch),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
const batch = (props: SinglePdfBatch) => <NUpBatch {...props} />;

/** Multiple Pages per Sheet's drop box; its editor comes with a file. */
function NUpSheetsRunner() {
  nUp.useIntent();
  return (
    <SinglePdfRunner
      hint="One or more PDFs · pages laid out on sheets locally in your browser"
      batch={batch}
      handoffSlug="n-up-pdf"
      toolName="Multiple Pages per Sheet"
      prepare={nUp.prepare}
    >
      {(pdf, reset) => <nUp.Panel pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}
