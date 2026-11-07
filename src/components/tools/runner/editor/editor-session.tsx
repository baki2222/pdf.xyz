"use client";

import { RunReason } from "@/components/tools/runner/run-reason";
import {
  Suspense,
  lazy,
  useId,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { Download, FileDown, Info, ShieldCheck } from "lucide-react";
import { downloadBytes } from "@/lib/pdf/browser";
import type { EditorExportResult } from "@/lib/pdf/editor-export";
import type { MarkupMode } from "@/lib/pdf/editor/comments";
import { isCommentObject } from "@/lib/pdf/editor/model";
import type { SignatureCheck } from "@/lib/pdf/editor/append-update";
import {
  REMOVALS,
  listRemovals,
  removalsIn,
  type Removal,
} from "@/lib/pdf/editor/signed-edit";
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
  /** Beside the greyed-out Apply while nothing is on a page yet. */
  emptyReason: string;
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
      signedNotice={(pdf) =>
        appendsToSigned(pdf) ? (
          <AppendedSignedNotice
            count={pdf.digitalSignatures}
            toolName={config.toolName}
          />
        ) : null
      }
    >
      {(pdf, reset) => (
        <EditorSession pdf={pdf} onReset={reset} config={config} />
      )}
    </SinglePdfRunner>
  );
}

/**
 * Can this file's edit be APPENDED (audit sign-pdf#5)? An unencrypted file
 * that carries certificate signatures: an edit that only adds or changes
 * goes on the end as an incremental update (`@/lib/pdf/editor/append-update`),
 * so the bytes each signature covers stay as they were. An edit that takes
 * something out (`@/lib/pdf/editor/signed-edit`) still rewrites the file, or
 * what it removed would stay readable in the earlier revision. An encrypted
 * file opened with its author's grant is the protection's own business (its
 * decrypted copy is not the file that was signed).
 */
function appendsToSigned(pdf: LoadedPdf): boolean {
  return pdf.protection === undefined && pdf.digitalSignatures > 0;
}

/** Before Apply, in place of the runner's "will no longer verify" warning. */
function AppendedSignedNotice({
  count,
  toolName,
}: {
  count: number;
  toolName: string;
}) {
  const one = count === 1;
  return (
    <div
      role="note"
      data-signed-input-notice="appended"
      className="border-line bg-wash text-fg rounded-panel flex items-start gap-3 border px-4 py-3 text-sm"
    >
      <ShieldCheck className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        This PDF is digitally signed — it carries {count} certificate signature
        {one ? "" : "s"}. {toolName} adds your changes to the end of the file
        and leaves the signed bytes exactly as they were, so{" "}
        {one
          ? "that signature still verifies"
          : "those signatures still verify"}{" "}
        for the version that was signed. Readers such as Acrobat also show that
        the document changed after signing, and a signature certified to allow
        no changes reports your change as breaking that. An edit that takes
        something out of the file — {listRemovals(REMOVALS, "disjunction")} — is
        the exception: the whole file is rewritten so it is really gone, and
        then{" "}
        {one ? "the signature no longer verifies" : "they no longer verify"}.
      </span>
    </div>
  );
}

/**
 * Beside Apply, while the edit of a signed file takes something out: it
 * will be rewritten, not appended, and the signatures will not verify.
 */
function SignedRewriteNote({
  removals,
  count,
  toolName,
}: {
  removals: readonly Removal[];
  count: number;
  toolName: string;
}) {
  const one = count === 1;
  return (
    <p
      role="note"
      data-signed-rewrite=""
      className="border-line bg-wash text-fg rounded-panel border px-4 py-3 text-sm"
    >
      Your edit includes {listRemovals(removals, "conjunction")}, which takes
      something out of the file. So {toolName} rewrites the whole file instead
      of adding to its end, and {one ? "its" : `its ${count}`} certificate
      signature{one ? "" : "s"} will no longer verify. Keep the signed original
      if {one ? "that signature matters" : "those signatures matter"}.
    </p>
  );
}

/** What Apply produced: the export, and for a signed file what it kept. */
type SessionResult = EditorExportResult & {
  signed?: SignatureCheck & { reason?: "removes" | "unreadable" };
};

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
          ? { fill: protection.canFillForms, annotate: protection.canAnnotate }
          : null,
    },
    initialEditorState,
  );
  const restricted = protection !== undefined && !unlocked;
  // How highlights, drawings, notes, shapes and lines are saved. A
  // restricted PDF has no choice: comments are all its author allows.
  const [markups, setMarkups] = useState<MarkupMode>("flatten");
  const { busy, error, result, run, reset, setError } =
    useAsyncRun<SessionResult>();
  const name = config.outputName(pdf.file.name);
  const edited = hasEdits(state, pdf.pageCount);
  // Placed but not yet applied, the edits are lost by leaving; applied,
  // they are in the result.
  useUnsavedGuard(edited && !result, "your edits");
  // What this edit takes out of a signed file, which decides how it is saved.
  const removals = appendsToSigned(pdf)
    ? removalsIn(
        {
          objects: state.objects,
          pages: state.pages,
          removedLinks: removedLinks(state),
        },
        pdf.pageCount,
      )
    : [];

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
      // Restricted: the fills and the comments only (the lock lets nothing
      // else be placed), written onto the decrypted copy, then saved back as
      // an incremental update under the author's encryption.
      // Unlocked (or never encrypted): the whole edit, an unencrypted file.
      const edited = restricted
        ? await exportEditedPdf(
            pdf.bytes,
            objects.filter(isCommentObject),
            undefined,
            { fills: next.fills, markups: "comments" },
          )
        : await exportEditedPdf(pdf.bytes, objects, undefined, {
            pages: next.pages,
            removedLinks: removedLinks(next),
            fills: next.fills,
            markups,
          });
      // A certificate-signed file: an edit that only adds is appended, so
      // the bytes the signatures cover survive (audit sign-pdf#5); one that
      // takes something out is rewritten, decided from what Apply exports
      // (`next`), and what was kept is read back from the output.
      let out: SessionResult = edited;
      if (restricted && protection) {
        out = {
          ...edited,
          bytes: (await protection.saveChanges(edited.bytes)).bytes,
        };
      } else if (appendsToSigned(pdf)) {
        const { saveSignedEdit } =
          await import("@/lib/pdf/editor/append-update");
        const saved = await saveSignedEdit(
          pdf.bytes,
          edited.bytes,
          removalsIn(
            {
              objects,
              pages: next.pages,
              removedLinks: removedLinks(next),
            },
            pdf.pageCount,
          ),
        );
        out = {
          ...edited,
          bytes: saved.bytes,
          signed: {
            ...saved.signatures,
            ...(saved.reason ? { reason: saved.reason } : {}),
          },
        };
      }
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
          ...(result.comments > 0
            ? [
                `${result.comments} saved as comment${result.comments === 1 ? "" : "s"}`,
              ]
            : []),
          ...(result.filled > 0
            ? [
                `${result.filled} form field${result.filled === 1 ? "" : "s"} filled`,
              ]
            : []),
          `${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`,
          ...(restricted ? ["author's protection kept"] : []),
          ...(result.signed ? signedSummary(result.signed, pdf) : []),
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
  const hasMarkups = state.objects.some(isCommentObject);
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
          // A runner's first step names its tools; under the author's lock
          // some are off (Annotate PDF's names Whiteout), and the banner and
          // the locked help say what is allowed instead.
          config.firstStep && !state.lock ? (
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
            {removals.length > 0 && (
              <SignedRewriteNote
                removals={removals}
                count={pdf.digitalSignatures}
                toolName={config.toolName}
              />
            )}
            <RunBar>
              <div
                className={
                  hasMarkups
                    ? "flex flex-wrap items-end justify-between gap-3"
                    : "flex justify-end"
                }
              >
                {hasMarkups && (
                  <MarkupChoice
                    value={restricted ? "comments" : markups}
                    onChange={setMarkups}
                    fixed={restricted}
                  />
                )}
                <RunReason reason={empty ? config.emptyReason : null}>
                  {(describedBy) => (
                    <RunButton
                      onClick={onApply}
                      busy={busy}
                      describedBy={describedBy}
                      disabled={empty}
                      busyLabel="Applying…"
                    >
                      <FileDown className="size-4" aria-hidden />
                      Apply &amp; download
                    </RunButton>
                  )}
                </RunReason>
              </div>
            </RunBar>
          </>
        }
      />
    </Suspense>
  );
}

/**
 * The result's line about a signed file's signatures, from what the OUTPUT
 * carries (`signaturesKept`), not from the input's count: a signature whose
 * field the edit dropped is not "left intact" because its bytes survive.
 */
function signedSummary(
  signed: NonNullable<SessionResult["signed"]>,
  pdf: LoadedPdf,
): string[] {
  const lost = Math.max(0, pdf.digitalSignatures - signed.kept);
  const why =
    signed.reason === "removes"
      ? " (your edit takes content out, so the file was rewritten)"
      : signed.reason === "unreadable"
        ? " (the file's structure could not take an update, so it was rewritten)"
        : "";
  return [
    ...(signed.kept > 0
      ? [
          `${signed.kept} existing signature${signed.kept === 1 ? "" : "s"} left intact`,
        ]
      : []),
    ...(lost > 0
      ? [
          `${lost} existing signature${lost === 1 ? " no longer verifies" : "s no longer verify"}${why}`,
        ]
      : []),
  ];
}

/**
 * "Save markups as comments (editable in other PDF apps)" or "Flatten into
 * the page", beside Apply, once there is a markup to save. On a restricted
 * PDF it is fixed to comments and says why.
 */
function MarkupChoice({
  value,
  onChange,
  fixed,
}: {
  value: MarkupMode;
  onChange: (mode: MarkupMode) => void;
  fixed: boolean;
}) {
  const id = useId();
  if (fixed) {
    return (
      <p
        data-markup-mode="comments"
        className="text-muted max-w-md text-xs leading-relaxed"
      >
        Highlights, drawings, notes and shapes are saved as comments, the one
        change this PDF&apos;s author allows: other PDF apps can select, edit or
        delete them.
      </p>
    );
  }
  const options: { mode: MarkupMode; label: string }[] = [
    { mode: "flatten", label: "Flatten into the page" },
    {
      mode: "comments",
      label: "Save markups as comments (editable in other PDF apps)",
    },
  ];
  return (
    <fieldset
      data-markup-mode={value}
      className="flex min-w-0 flex-col gap-1.5"
    >
      <legend className="text-fg pb-1 text-xs font-semibold">
        Highlights, drawings, notes and shapes
      </legend>
      {options.map((o) => (
        <label
          key={o.mode}
          className="text-fg flex min-h-10 cursor-pointer items-center gap-2 text-xs"
        >
          <input
            type="radio"
            name={`${id}-markups`}
            value={o.mode}
            checked={value === o.mode}
            onChange={() => onChange(o.mode)}
            className="accent-accent size-4 shrink-0"
          />
          {o.label}
        </label>
      ))}
      {value === "comments" && (
        <p className="text-muted max-w-md text-[11px] leading-relaxed">
          Whiteout, redaction, text, pictures and signatures are still written
          into the page.
        </p>
      )}
    </fieldset>
  );
}
