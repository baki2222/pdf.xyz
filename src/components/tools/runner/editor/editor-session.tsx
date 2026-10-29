"use client";

import { Suspense, lazy, useReducer, useState, type ReactNode } from "react";
import { Download, FileDown, Info } from "lucide-react";
import { downloadBytes } from "@/lib/pdf/browser";
import type { EditorExportResult } from "@/lib/pdf/editor-export";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  outputFile,
  useAsyncRun,
} from "../runner-kit";
import { ProtectionBanner } from "../protection-banner";
import { RunBar } from "../run-bar";
import { SinglePdfRunner } from "../single-pdf-runner";
import { useUnsavedGuard } from "../use-unsaved-guard";
import type { LoadedPdf } from "../use-single-pdf";
import {
  editorReducer,
  hasEdits,
  initialEditorState,
  removedLinks,
  type Tool,
} from "./editor-state";

/**
 * The one editor, as a runner: Edit PDF, Annotate PDF and Sign PDF each
 * mount it (2026-10-24), differing only in the tool it opens on, the line
 * that says what to do first, and how their result and file are named.
 *
 * It owns the run around the editor: the editor's state (kept here, so the
 * objects survive the result panel and "adjust" goes back to them), the
 * Apply row, and the result.
 *
 * The editor itself (page view, overlay, toolbar, panels) is its own chunk,
 * fetched while the first file opens (`prepare`, which `useSinglePdf` awaits
 * before the editor draws) — not with the tool page. Measured 2026-10-24:
 * imported statically it put tools/edit-pdf.html at 873 KB raw / 282.4 KB gz,
 * over the every-tool-page ceiling (851 KB / 276.1 KB).
 */
const loadEditor = () => import("./wysiwyg-editor");
const WysiwygEditor = lazy(() =>
  loadEditor().then((m) => ({ default: m.WysiwygEditor })),
);
const prepareEditor = async () => {
  await loadEditor();
};

export interface EditorRunnerConfig {
  slug: string;
  toolName: string;
  /** The drop box's caption. */
  hint: string;
  /** The tool the editor opens on. */
  initialTool: Tool;
  /** One line above the pages: what to do first. */
  firstStep?: ReactNode;
  /** The result's heading, its download button, and the file it saves. */
  resultTitle: string;
  downloadLabel: string;
  outputName: (sourceName: string) => string;
  /** Under the editor while it is open: what this tool does, and does not. */
  footer: ReactNode;
  /**
   * Open a PDF its author restricted (it opens without a password) instead
   * of refusing it: the editor then allows only what the author allows,
   * until the owner password is entered (`../protection-banner`).
   */
  openProtected?: boolean;
}

export function EditorRunner(config: EditorRunnerConfig) {
  return (
    <SinglePdfRunner
      hint={config.hint}
      handoffSlug={config.slug}
      toolName={config.toolName}
      prepare={prepareEditor}
      openProtected={config.openProtected}
    >
      {(pdf, reset) => (
        <EditorSession pdf={pdf} onReset={reset} config={config} />
      )}
    </SinglePdfRunner>
  );
}

function EditorSession({
  pdf,
  onReset,
  config,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
  config: EditorRunnerConfig;
}) {
  const protection = pdf.protection;
  const [unlocked, setUnlocked] = useState(() => protection?.unlocked ?? false);
  const [state, dispatch] = useReducer(
    editorReducer,
    {
      tool: config.initialTool,
      pageCount: pdf.pageCount,
      locale: typeof navigator === "undefined" ? undefined : navigator.language,
      // A restricted PDF without its owner password: only what the author
      // allows, enforced by the reducer (and again by the writer).
      lock:
        protection && !protection.unlocked
          ? { fill: protection.canFillForms }
          : null,
    },
    initialEditorState,
  );
  const restricted = protection !== undefined && !unlocked;
  const { busy, error, result, run, reset, setError } =
    useAsyncRun<EditorExportResult>();
  const name = config.outputName(pdf.file.name);
  const edited = hasEdits(state, pdf.pageCount);
  // Placed but not yet applied, the edits are lost by leaving; applied,
  // they are in the result.
  useUnsavedGuard(edited && !result, "your edits");

  const onApply = () => {
    // A box still being typed in counts: finish it, and export what that
    // finishing produces (the reducer is pure, so this IS the next state).
    const next = editorReducer(state, { type: "endEdit" });
    const objects = next.objects;
    dispatch({ type: "endEdit" });
    if (!hasEdits(next, pdf.pageCount)) {
      setError("Add something to a page first.");
      return;
    }
    void run(async () => {
      const { exportEditedPdf } = await import("@/lib/pdf/editor-export");
      // Restricted: the fills only, written onto the decrypted copy, then
      // saved back as an incremental update under the author's encryption.
      // Unlocked (or never encrypted): the whole edit, an unencrypted file.
      const edited = restricted
        ? await exportEditedPdf(pdf.bytes, [], undefined, {
            fills: next.fills,
          })
        : await exportEditedPdf(pdf.bytes, objects, undefined, {
            pages: next.pages,
            removedLinks: removedLinks(next),
            fills: next.fills,
          });
      const out =
        restricted && protection
          ? {
              ...edited,
              bytes: (await protection.saveChanges(edited.bytes)).bytes,
            }
          : edited;
      // Downloaded INSIDE the run, before it settles. `downloadBlob` clicks
      // a hidden anchor, and the runner stage's hold (`../stage-hold`) gives
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
        title={config.resultTitle}
        summary={[
          `${result.objectCount} item${result.objectCount === 1 ? "" : "s"} written`,
          ...(result.filled > 0
            ? [
                `${result.filled} form field${result.filled === 1 ? "" : "s"} filled`,
              ]
            : []),
          `${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`,
          ...(restricted ? ["author's protection kept"] : []),
          formatBytes(result.bytes.byteLength),
        ].join(" · ")}
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        // The pages as arranged in the editor (inserted and deleted ones
        // counted), not the file's original count.
        expectedPages={state.pages.length}
      >
        <button
          type="button"
          onClick={() => downloadBytes(result.bytes, name)}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          {config.downloadLabel}
        </button>
      </ResultPanel>
    );
  }

  const empty = !edited && !state.editing?.text.trim();
  return (
    <Suspense fallback={null}>
      <WysiwygEditor
        pdf={pdf}
        state={state}
        dispatch={dispatch}
        notice={
          protection ? (
            <ProtectionBanner
              protection={protection}
              unlocked={unlocked}
              surface="editor"
              onUnlocked={() => {
                setUnlocked(true);
                dispatch({ type: "unlock" });
              }}
            />
          ) : null
        }
        firstStep={
          config.firstStep ? (
            <p
              data-first-step=""
              className="border-accent/30 bg-accent/5 text-fg rounded-panel flex items-start gap-2 border px-3.5 py-2.5 text-sm"
            >
              <Info
                className="text-accent mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <span>{config.firstStep}</span>
            </p>
          ) : null
        }
        footer={config.footer}
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
