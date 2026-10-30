"use client";

import { Info } from "lucide-react";
import { annotatedOutputName } from "@/lib/pdf/annotate";
import { PrivacyLine } from "./stamp-controls";
import { EditorRunner } from "./editor/editor-session";

/**
 * Annotate PDF — the shared editor (`./editor/`), opened on its Mark-up
 * group with Highlight active: drag over the page to highlight, then
 * whiteout, draw or add notes, and every other editor tool besides.
 *
 * HISTORY. Until 2026-10-24 this was a form of its own: four markup kinds
 * (highlight, box, note, line) placed by typed X/Y points from the lower-left
 * corner, a blank outline for a preview, no moving or resizing after a markup
 * was added. The page's title and its search copy are still its own.
 */
export function AnnotateRunner() {
  return (
    <EditorRunner
      slug="annotate-pdf"
      toolName="Annotate PDF"
      hint="One PDF · marked up locally in your browser"
      initialTool="highlight"
      firstStep={
        <>
          <span className="font-semibold">Mark up:</span> Highlight is ready —
          drag across the page where it goes. Whiteout, Draw and Note are beside
          it in the toolbar.
        </>
      }
      resultTitle="Annotated PDF ready"
      downloadLabel="Download annotated PDF"
      outputName={annotatedOutputName}
      footer={<AnnotateFooter />}
    />
  );
}

/**
 * The load-bearing honesty of this tool: how markups are saved. Flattened
 * (the default) they are page content; saved as comments they are PDF
 * annotations another app can delete — so whiteout never is one.
 */
function AnnotateFooter() {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-info/40 bg-info/10 text-info rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm">
        <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="leading-relaxed">
          <span className="font-semibold">
            Flattened into the page, or saved as comments.
          </span>{" "}
          Choose beside Apply &amp; download. Flattened, the default,
          highlights, drawings, notes and shapes are drawn as page content where
          you place them. Saved as comments, they are standard PDF annotations
          that other PDF apps can select, edit or delete. Whiteout is always
          drawn into the page, and there are no reply threads here.
        </p>
      </div>
      <PrivacyLine>
        Markups are applied on your device — your PDF never leaves the browser.
      </PrivacyLine>
    </div>
  );
}
