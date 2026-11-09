"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import type { ViewerPdf } from "@/lib/pdf/viewer";
import { Spinner } from "./runner-kit";
import { SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * The viewer itself (`./viewer/pdf-viewer`) is fetched with the first file,
 * never with the page: this runner rides the PDF Viewer page's first load
 * (the dispatcher preloads it), and the viewer's toolbar, page column,
 * search and print code are a visit's cost only once a PDF is open.
 */
const PdfViewer = lazy(() =>
  import("./viewer/pdf-viewer").then((m) => ({ default: m.PdfViewer })),
);

/**
 * PDF Viewer: open one PDF and read it. pdf.js reads it (`reader="pdfjs"`),
 * so a file whose author restricted editing opens as it does in any
 * viewer; one that needs a password to open gets the typed refusal and
 * its remedy, Unlock PDF. Nothing is written (`writesPdf={false}`): there
 * is no copy of the file for a signed-file warning to be about.
 */
export function ViewerRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF, opened in your browser: nothing is uploaded"
      handoffSlug="pdf-viewer"
      toolName="PDF Viewer"
      writesPdf={false}
      reader="pdfjs"
    >
      {(pdf, reset) => <ViewerHost pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

const FALLBACK = (
  <div className="border-line bg-wash text-muted rounded-panel flex h-[min(78vh,56rem)] min-h-[28rem] items-center justify-center gap-2 border text-sm">
    <Spinner />
    Loading the PDF viewer
  </div>
);

/**
 * Starts the document's open as the viewer's chunk is fetched, not after it
 * (a chained `await import()` is a round trip each), and releases it when
 * the viewer goes.
 */
function ViewerHost({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  const [opening, setOpening] = useState<Promise<ViewerPdf> | null>(null);
  useEffect(() => {
    const held = pdf.bytes;
    const doc = acquireViewerPdf(pdf.bytes);
    queueMicrotask(() => setOpening(doc));
    return () => releaseViewerPdf(held);
  }, [pdf.bytes]);
  return (
    <Suspense fallback={FALLBACK}>
      <PdfViewer pdf={pdf} onReset={onReset} opening={opening} />
    </Suspense>
  );
}

/** One open per file, shared by every holder, destroyed after the last lets go. */
const held = new WeakMap<
  Uint8Array,
  {
    doc: Promise<ViewerPdf>;
    holders: number;
    timer: ReturnType<typeof setTimeout> | null;
  }
>();

/**
 * The open document for `bytes`, opened once however often a holder mounts
 * (React mounts an effect twice in development; a remount must not reopen,
 * and must not get a document the first unmount destroyed).
 */
export function acquireViewerPdf(bytes: Uint8Array): Promise<ViewerPdf> {
  let entry = held.get(bytes);
  if (!entry) {
    entry = { doc: openViewer(bytes), holders: 0, timer: null };
    held.set(bytes, entry);
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.holders += 1;
  return entry.doc;
}

/** Let go of `bytes`' document; the last holder's release destroys it. */
function releaseViewerPdf(bytes: Uint8Array): void {
  const entry = held.get(bytes);
  if (!entry) return;
  entry.holders -= 1;
  if (entry.holders > 0) return;
  entry.timer = setTimeout(() => {
    held.delete(bytes);
    entry.doc.then(
      (d) => d.destroy(),
      () => {},
    );
  }, 0);
}

/** pdf.js's open for the viewer, in its own chunk (`@/lib/pdf/viewer`). */
async function openViewer(bytes: Uint8Array): Promise<ViewerPdf> {
  const { openViewerPdf } = await import("@/lib/pdf/viewer");
  return openViewerPdf(bytes);
}
