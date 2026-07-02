"use client";

import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { Dropzone, ErrorNote, Spinner } from "./runner-kit";
import { useSinglePdf, type LoadedPdf } from "./use-single-pdf";

/**
 * Handles the shared "load one PDF" lifecycle — dropzone, reading state, and
 * errors — then renders an editor for the loaded document. The editor subtree is
 * keyed by the file so a fresh file always gets fresh editor state, which lets
 * each editor initialize its state directly from props (no syncing effects).
 */
export function SinglePdfRunner({
  hint,
  children,
}: {
  hint?: string;
  children: (pdf: LoadedPdf, reset: () => void) => ReactNode;
}) {
  const { pdf, loading, error, open, clear } = useSinglePdf();

  if (pdf) {
    const key = `${pdf.file.name}:${pdf.file.size}:${pdf.file.lastModified}`;
    return <div key={key}>{children(pdf, clear)}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
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
export function FileHeader({ pdf }: { pdf: LoadedPdf }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-surface-2 px-3.5 py-3">
      <FileText className="size-4 shrink-0 text-violet-300" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
        {pdf.file.name}
      </span>
      <span className="shrink-0 text-xs text-slate-500">
        {pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
