"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, ShieldAlert } from "lucide-react";
import { useToolContext } from "@/components/tools/tool-context";
import { usePageTarget } from "@/components/upload/use-page-target";
import { takesByAccept } from "@/lib/intent/accept-match";
import { formatBytes } from "@/lib/utils";
import { Dropzone, ErrorNote, Spinner } from "./runner-kit";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { useSinglePdf, type LoadedPdf, type PdfReader } from "./use-single-pdf";
import { useToolHandoff, type ToolHandoff } from "./use-tool-handoff";

/** What the open editor's "replace" target takes: a PDF, by type or by name. */
const takesPdf = takesByAccept("application/pdf,.pdf");

/**
 * Handles the shared "load one PDF" lifecycle — dropzone, reading state, and
 * errors — then renders an editor for the loaded document. The editor subtree is
 * keyed by the file so a fresh file always gets fresh editor state, which lets
 * each editor initialize its state directly from props (no syncing effects).
 *
 * Handoff-aware: pass `handoffSlug` to let this runner claim a workspace hand-off
 * for that tool and pre-load its first PDF, or pass an already-claimed `handoff`
 * (when a parent decided single-vs-batch). Direct visits with no hand-off behave
 * exactly as before — a plain file picker.
 *
 * REPLACE. While a document is open, the editor is its page's drop target
 * (`@/lib/intent/page-target`, verb "replace"): a PDF dropped or pasted
 * anywhere on the page opens in its place, through the same `open` a pick
 * uses — after `confirmLeave()`, so unsaved work is asked about first
 * (the editors that register it are WP-08's; the question is fetched with
 * the file, not with the page). It is registered after the
 * drop zone it replaced unmounted and before any secondary zone the editor
 * renders, and secondary zones never register (`Dropzone`'s `pageTarget`
 * is opt-in), so Sign PDF's signature-image zone cannot take the page's
 * drops from it. It does not take a file while a run is in flight — read
 * from the editor's own `aria-busy`, the statement a screen reader hears
 * — and a file that is not a PDF goes to the ticket dialog rather than
 * closing the editor on an error.
 *
 * A REPLACE IS SAID, AND FOCUS SURVIVES IT — "Replaced alpha.pdf with
 * beta.pdf in Rotate PDF.", and focus that was inside the old editor moves
 * into the new one (`./replace-open-file`, fetched with the file, not with
 * the page; `replace-target.test.tsx`).
 *
 * A file that already carries digital signatures gets a notice above the
 * editor, before Run: every PDF a client tool saves is a full pdf-lib rewrite,
 * so those signatures stop verifying in the copy. Tools whose output is not a
 * PDF (text, images, Markdown) pass `writesPdf={false}` — there is no copy of
 * the file for the warning to be about. `signed-input-notice.test.tsx` holds
 * every runner to the catalog's own `outputs`.
 */
export function SinglePdfRunner({
  hint,
  children,
  handoffSlug,
  handoff: providedHandoff,
  toolName = "this tool",
  writesPdf = true,
  reader = "pdf-lib",
}: {
  hint?: string;
  children: (pdf: LoadedPdf, reset: () => void) => ReactNode;
  /** Tool slug to self-claim a workspace hand-off for. */
  handoffSlug?: string;
  /** A hand-off already claimed by a parent (skips self-claiming). */
  handoff?: ToolHandoff;
  /** Tool name for honest hand-off error copy. */
  toolName?: string;
  /**
   * Whether the tool saves a PDF made from this file. Defaults to true — the
   * safe direction: a needless warning costs a sentence, a missing one costs
   * someone's counterparty signature.
   */
  writesPdf?: boolean;
  /**
   * `"pdfjs"` only for tools that never hand the bytes to pdf-lib — see
   * {@link PdfReader}.
   */
  reader?: PdfReader;
}) {
  const { pdf, loading, error, open, clear } = useSinglePdf({ reader });
  // Self-claim only when a parent hasn't already provided a claimed hand-off.
  const selfHandoff = useToolHandoff(providedHandoff ? undefined : handoffSlug);
  const handoff = providedHandoff ?? selfHandoff;
  const tool = useToolContext();
  const editorRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const name = tool?.name ?? toolName;

  usePageTarget(
    pdf
      ? {
          name,
          verb: "replace",
          current: pdf.file.name,
          canReceive: () =>
            !editorRef.current?.querySelector('[aria-busy="true"]'),
          takes: takesPdf,
          receive: (files) => {
            const next = files.find((file) => takesPdf(file));
            if (!next) return;
            const from = pdf.file.name;
            void import("./replace-open-file").then(({ replaceOpenFile }) =>
              replaceOpenFile({
                next,
                from,
                name,
                open,
                editor: () => editorRef.current,
              }),
            );
          },
          arm: setArmed,
          element: () => editorRef.current,
        }
      : null,
  );

  // Pre-load the first handed-off PDF exactly once.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    const first = handoff.status === "ready" ? handoff.files[0] : undefined;
    if (first) {
      openedRef.current = true;
      void open(first);
    }
  }, [handoff.status, handoff.files, open]);

  if (pdf) {
    const key = `${pdf.file.name}:${pdf.file.size}:${pdf.file.lastModified}`;
    return (
      <div
        key={key}
        ref={editorRef}
        data-single-pdf-runner="loaded"
        data-page-drop-target=""
        data-armed={armed || undefined}
        className="flex flex-col gap-4"
      >
        {handoff.status === "ready" && (
          <HandoffLoadedBadge
            origin={handoff.origin}
            count={1}
            skipped={handoff.skipped}
          />
        )}
        {writesPdf && pdf.digitalSignatures > 0 && (
          <SignedInputNotice
            count={pdf.digitalSignatures}
            toolName={toolName}
          />
        )}
        {children(pdf, clear)}
      </div>
    );
  }

  // While claiming a hand-off, or reading the file it delivered, show a
  // dedicated "bringing your files over" block rather than the empty picker.
  if (handoff.status === "loading" || (handoff.status === "ready" && loading)) {
    return <HandoffLoading />;
  }

  return (
    <div data-single-pdf-runner="empty" className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName={toolName} />
      {loading ? (
        <div className="border-line bg-wash text-muted flex items-center justify-center gap-2 rounded-[4px] border px-6 py-12 text-sm">
          <Spinner />
          Reading your PDF…
        </div>
      ) : (
        <Dropzone
          pageTarget
          onFiles={(files) => files[0] && open(files[0])}
          multiple={false}
          hint={hint}
        />
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}

/**
 * The file is already digitally signed, and the copy this tool saves will not
 * keep those signatures valid. Shown before Run, not after: by the download it
 * is too late to choose a different route for a signed contract.
 */
export function SignedInputNotice({
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
      data-signed-input-notice
      className="border-warn/40 bg-warn/10 text-warn flex items-start gap-3 rounded-[4px] border px-4 py-3 text-sm"
    >
      <ShieldAlert className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        This PDF is digitally signed — it carries {count} certificate signature
        {one ? "" : "s"}. Saving from {toolName} writes a new copy of the file,
        and in it {one ? "that signature" : "those signatures"} will no longer
        verify: Acrobat and other readers show {one ? "it" : "them"} as invalid
        or report the document as altered. Keep the signed original for anything
        that relies on {one ? "it" : "them"}.
      </span>
    </div>
  );
}

/** Consistent file header shown at the top of each single-file editor. */
export function FileHeader({
  pdf,
  aside,
}: {
  /** Only the name, size and page count are shown, so only they are required. */
  pdf: Pick<LoadedPdf, "file" | "pageCount">;
  aside?: ReactNode;
}) {
  return (
    <div
      data-file-header=""
      className="bg-panel border-line flex items-center gap-3 rounded-[4px] border px-3.5 py-3"
    >
      <FileText className="text-accent size-4 shrink-0" aria-hidden />
      <span className="text-fg min-w-0 flex-1 truncate text-sm">
        {pdf.file.name}
      </span>
      {aside}
      <span className="text-muted shrink-0 text-xs">
        {pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"} ·{" "}
        {formatBytes(pdf.file.size)}
      </span>
    </div>
  );
}
