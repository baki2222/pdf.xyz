"use client";

import { Suspense, lazy, useReducer } from "react";
import Link from "next/link";
import {
  Download,
  FileDown,
  Info,
  Layers,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { getToolBySlug } from "@/lib/tools";
import { downloadBytes } from "@/lib/pdf/browser";
import { editedOutputName } from "@/lib/pdf/edit";
import type { EditorExportResult } from "@/lib/pdf/editor-export";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { SinglePdfRunner } from "./single-pdf-runner";
import { PrivacyLine } from "./stamp-controls";
import { useUnsavedGuard } from "./use-unsaved-guard";
import type { LoadedPdf } from "./use-single-pdf";
import { INITIAL_STATE, editorReducer } from "./editor/editor-state";

/**
 * The editor itself (page view, overlay, toolbar, panels) is its own chunk,
 * fetched while the first file opens (`prepare`, which `useSinglePdf` awaits
 * before the editor draws) — not with the tool page. Measured 2026-10-24:
 * imported statically it put tools/edit-pdf.html at 873 KB raw / 282.4 KB gz,
 * over the every-tool-page ceiling (851 KB / 276.1 KB).
 */
const loadEditor = () => import("./editor/wysiwyg-editor");
const WysiwygEditor = lazy(() =>
  loadEditor().then((m) => ({ default: m.WysiwygEditor })),
);
const prepareEditor = async () => {
  await loadEditor();
};

/**
 * Edit PDF — the WYSIWYG editor (`./editor/`): every page drawn by pdf.js,
 * objects placed by clicking on the page, moved and resized by hand, and
 * written into the file where they were drawn (`@/lib/pdf/editor-export`).
 *
 * HISTORY. Until 2026-10-24 this file was a FORM: X and Y typed in points
 * from the bottom-left, a blank 180 px box for a preview, nothing movable
 * after it was added, no undo. Its scope note said so — "no drag handles,
 * and no click-to-place canvas" — and that sentence, true of the form, would
 * have been false of this editor the day it shipped; the note below says
 * what the editor does now and, as before, what it does NOT (it still cannot
 * change the words already in the file).
 */
export function EditRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · edited locally in your browser"
      handoffSlug="edit-pdf"
      toolName="Edit PDF"
      prepare={prepareEditor}
    >
      {(pdf, reset) => <EditEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

/**
 * The run around the editor: its state (kept here, so the objects survive
 * the result panel and "adjust" goes back to them), the Apply row, and the
 * result.
 */
function EditEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  const [state, dispatch] = useReducer(editorReducer, INITIAL_STATE);
  const { busy, error, result, run, reset, setError } =
    useAsyncRun<EditorExportResult>();
  const name = editedOutputName(pdf.file.name);
  // Placed but not yet applied, the objects are lost by leaving; applied,
  // they are in the result.
  useUnsavedGuard(state.objects.length > 0 && !result, "your edits");

  const onApply = () => {
    // A box still being typed in counts: finish it, and export what that
    // finishing produces (the reducer is pure, so this IS the next state).
    const objects = editorReducer(state, { type: "endEdit" }).objects;
    dispatch({ type: "endEdit" });
    if (objects.length === 0) {
      setError("Add something to a page first.");
      return;
    }
    void run(async () => {
      const { exportEditedPdf } = await import("@/lib/pdf/editor-export");
      const out = await exportEditedPdf(pdf.bytes, objects);
      // Downloaded INSIDE the run, before it settles. `downloadBlob` clicks
      // a hidden anchor, and the runner stage's hold (`./stage-hold`) gives
      // its band back at the first click after the run settles — measured
      // 2026-10-24 with the download after the run: that synthetic click
      // released the band and the About section jumped up, CLS 0.43 at
      // 1280 x 900 (`continue-chain.spec.ts`). Before the settle, the hold
      // ignores clicks.
      downloadBytes(out.bytes, name);
      return out;
    });
  };

  if (result) {
    return (
      <ResultPanel
        title="Edited PDF ready"
        summary={`${result.objectCount} item${result.objectCount === 1 ? "" : "s"} written into ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() => downloadBytes(result.bytes, name)}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download edited PDF
        </button>
      </ResultPanel>
    );
  }

  const empty = state.objects.length === 0 && !state.editing?.text.trim();
  return (
    <Suspense fallback={null}>
      <WysiwygEditor
        pdf={pdf}
        state={state}
        dispatch={dispatch}
        footer={<EditorFooter />}
        runBar={
          <>
            {error && <ErrorNote message={error} />}
            <RunBar>
              <div className="flex justify-end">
                <RunButton
                  onClick={onApply}
                  busy={busy}
                  disabled={empty}
                  busyLabel="Applying…"
                >
                  <FileDown className="size-4" aria-hidden />
                  Apply &amp; download
                </RunButton>
              </div>
            </RunBar>
          </>
        }
      />
    </Suspense>
  );
}

/** What sits under the editor while it is open: what it does, and does not. */
function EditorFooter() {
  return (
    <div className="flex flex-col gap-5">
      <HonestScopeNote />
      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={Layers}
          title="Adds to the page"
          body="Text, pictures, signatures, shapes, highlights, drawings and notes are written into the page as real text, vector and image content — the page itself is kept, not turned into a picture."
        />
        <InfoTile
          icon={Lock}
          title="Flattened on export"
          body="What you add becomes part of the page, not a comment layer. Whiteout covers what is under it; the covered content stays in the file — use Redact PDF when it must be removed."
        />
        <InfoTile
          icon={ShieldCheck}
          title="Local only"
          body="Pages are drawn and the file is written in your browser — your PDF and pictures are never uploaded."
        />
      </div>
      <PrivacyLine>
        Edits are applied on your device — your PDF never leaves the browser.
      </PrivacyLine>
    </div>
  );
}

/**
 * A link to the tool that does what this one cannot, named as the catalogue
 * names it — a typed "Redact" stayed plain text on the page for months, and a
 * reader told to go elsewhere was given no way to get there.
 */
function ToolLink({ slug }: { slug: string }) {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`edit-runner links unknown tool "${slug}"`);
  return (
    <Link href={`/tools/${tool.slug}`} className="font-semibold underline">
      {tool.name}
    </Link>
  );
}

/**
 * The load-bearing honesty of this tool: new content, placed by hand — not
 * editing of the text already there. Exported so `tool-page-content.test.ts`
 * can render it and read the links a reader actually receives.
 */
export function HonestScopeNote() {
  return (
    <div className="border-info/40 bg-info/10 text-info rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm">
      <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="leading-relaxed">
        <span className="font-semibold">This adds new content.</span> Click on a
        page to place text, pictures, signatures, shapes, highlights, drawings
        and notes, then move and resize them. It does{" "}
        <span className="font-semibold">not</span> change, move or delete the
        words and pictures already in your PDF. To rework the existing text,
        convert the file with <ToolLink slug="pdf-to-word" />. Whiteout covers
        content but doesn&apos;t remove it — use <ToolLink slug="redact-pdf" />{" "}
        to delete data.
      </p>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}) {
  return (
    <div className="border-line bg-wash rounded-panel border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}
