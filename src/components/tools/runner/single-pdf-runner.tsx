"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { Dropzone, ErrorNote, Spinner } from "./runner-kit";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { useSinglePdf, type LoadedPdf } from "./use-single-pdf";
import { useToolHandoff, type ToolHandoff } from "./use-tool-handoff";

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
 */
export function SinglePdfRunner({
  hint,
  children,
  handoffSlug,
  handoff: providedHandoff,
  toolName = "this tool",
}: {
  hint?: string;
  children: (pdf: LoadedPdf, reset: () => void) => ReactNode;
  /** Tool slug to self-claim a workspace hand-off for. */
  handoffSlug?: string;
  /** A hand-off already claimed by a parent (skips self-claiming). */
  handoff?: ToolHandoff;
  /** Tool name for honest hand-off error copy. */
  toolName?: string;
}) {
  const { pdf, loading, error, open, clear } = useSinglePdf();
  // Self-claim only when a parent hasn't already provided a claimed hand-off.
  const selfHandoff = useToolHandoff(providedHandoff ? undefined : handoffSlug);
  const handoff = providedHandoff ?? selfHandoff;

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
      <div key={key} className="flex flex-col gap-4">
        {handoff.status === "ready" && (
          <HandoffLoadedBadge count={1} skipped={handoff.skipped} />
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
    <div className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName={toolName} />
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-12 text-sm text-slate-400">
          <Spinner />
          Reading your PDF…
        </div>
      ) : (
        <Dropzone
          onFiles={(files) => files[0] && open(files[0])}
          multiple={false}
          hint={hint}
        />
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}

/** Consistent file header shown at the top of each single-file editor. */
export function FileHeader({ pdf, aside }: { pdf: LoadedPdf; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-surface-2 px-3.5 py-3">
      <FileText className="size-4 shrink-0 text-violet-300" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
        {pdf.file.name}
      </span>
      {aside}
      <span className="shrink-0 text-xs text-slate-400">
        {pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"} ·{" "}
        {formatBytes(pdf.file.size)}
      </span>
    </div>
  );
}
