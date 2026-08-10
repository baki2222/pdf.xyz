"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileArchive,
  ImageDown,
  Images,
  ShieldCheck,
} from "lucide-react";
import { rasterizePdf, type RasterPage } from "@/lib/pdf/render";
import {
  DEFAULT_RESOLUTION_ID,
  RASTER_MIME,
  RASTER_RESOLUTIONS,
  pageImageName,
  resolutionById,
  shouldZipPages,
  zipOutputName,
  type RasterFormat,
} from "@/lib/pdf/pdf-to-image";
import { downloadBlob, downloadBytes, zipFiles } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  ChipButton,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  UndecodedImagesNotice,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";

/** Cap on how many page previews render in the grid; the ZIP still holds all. */
const PREVIEW_LIMIT = 24;

interface RasterResult {
  pages: RasterPage[];
  /** Sum of encoded image bytes across every page. */
  totalBytes: number;
  /** True when the output is delivered as a ZIP (more than one page). */
  zip: boolean;
  /** Human label of the resolution the pages were rendered at. */
  resolutionLabel: string;
}

export function PdfToImageRunner({ format }: { format: RasterFormat }) {
  const label = format.toUpperCase();
  return (
    <SinglePdfRunner
      hint={`One PDF · every page becomes a ${label} image, rendered locally in your browser`}
      handoffSlug={format === "png" ? "pdf-to-png" : "pdf-to-jpg"}
      toolName={`PDF to ${label}`}
    >
      {(pdf, reset) => (
        <PdfToImageEditor pdf={pdf} format={format} onReset={reset} />
      )}
    </SinglePdfRunner>
  );
}

function PdfToImageEditor({
  pdf,
  format,
  onReset,
}: {
  pdf: LoadedPdf;
  format: RasterFormat;
  onReset: () => void;
}) {
  const label = format.toUpperCase();
  const { busy, error, result, run, reset } = useAsyncRun<RasterResult>();
  const [resolutionId, setResolutionId] = useState(DEFAULT_RESOLUTION_ID);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight render if this editor unmounts (e.g. "Start over").
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const onRun = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const resolution = resolutionById(resolutionId);
    setProgress({ done: 0, total: pdf.pageCount });
    void run(async () => {
      const pages = await rasterizePdf(pdf.bytes, {
        format,
        dpi: resolution.dpi,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (controller.signal.aborted) {
        // Editor is unmounting; surface nothing.
        throw new Error("Rendering was cancelled.");
      }
      if (pages.length === 0) {
        throw new Error("No pages could be rendered from this PDF.");
      }
      return {
        pages,
        totalBytes: pages.reduce((sum, p) => sum + p.bytes.byteLength, 0),
        zip: shouldZipPages(pages.length),
        resolutionLabel: resolution.label,
      } satisfies RasterResult;
    });
  };

  // Changing the resolution clears a finished render so the user can re-render.
  const changeResolution = (id: string) => {
    if (busy) return;
    setResolutionId(id);
    if (result) {
      reset();
      setProgress(null);
    }
  };

  if (result) {
    return (
      <ImageResult
        pdf={pdf}
        format={format}
        result={result}
        onReset={() => {
          reset();
          setProgress(null);
        }}
        onStartOver={onReset}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Resolution"
        aside={<span className="text-xs text-slate-400">{label} output</span>}
      >
        <div className="flex flex-wrap gap-2">
          {RASTER_RESOLUTIONS.map((res) => (
            <ChipButton
              key={res.id}
              onClick={() => changeResolution(res.id)}
              disabled={busy}
              active={res.id === resolutionId}
              title={`${res.dpi} DPI`}
            >
              {res.label}
              <span className="text-[10px] text-slate-400">{res.dpi} DPI</span>
            </ChipButton>
          ))}
        </div>
      </RunnerSection>

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={ShieldCheck}
          title="Private"
          body="Pages render locally in your browser — the PDF is never uploaded."
        />
        <InfoTile
          icon={Images}
          title="Every page"
          body={`All ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"} are exported as ${label} images.`}
        />
        <InfoTile
          icon={FileArchive}
          title={pdf.pageCount === 1 ? "Single image" : "One ZIP"}
          body={
            pdf.pageCount === 1
              ? `A single page downloads as one ${label} file.`
              : "Multiple pages are bundled into a single ZIP download."
          }
        />
      </div>

      {busy && progress && (
        <RenderProgress
          done={progress.done}
          total={progress.total}
          label={label}
        />
      )}
      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton
          onClick={onRun}
          busy={busy}
          busyLabel={`Rendering ${label}…`}
        >
          <ImageDown className="size-4" aria-hidden />
          Render {pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"}
        </RunButton>
      </div>
    </div>
  );
}

function ImageResult({
  pdf,
  format,
  result,
  onReset,
  onStartOver,
}: {
  pdf: LoadedPdf;
  format: RasterFormat;
  result: RasterResult;
  onReset: () => void;
  onStartOver: () => void;
}) {
  const label = format.toUpperCase();
  const mime = RASTER_MIME[format];
  const pageCount = result.pages.length;
  const [zipping, setZipping] = useState(false);

  // Object URLs for the (capped) preview grid, revoked on change/unmount. URLs
  // are created in a deferred microtask (never a synchronous setState in the
  // effect body) and skipped entirely if the effect is already torn down, so
  // StrictMode's double-invoke can't leak or revoke a live preview.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    queueMicrotask(() => {
      if (cancelled) return;
      for (const page of result.pages.slice(0, PREVIEW_LIMIT)) {
        created.push(
          URL.createObjectURL(new Blob([bufferOf(page.bytes)], { type: mime })),
        );
      }
      setPreviews(created);
    });
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [result.pages, mime]);

  const downloadOne = (page: RasterPage) => {
    downloadBytes(
      page.bytes,
      pageImageName(pdf.file.name, page.index, pageCount, format),
      mime,
    );
  };

  const downloadAll = async () => {
    if (!result.zip) {
      const first = result.pages[0];
      if (first) downloadOne(first);
      return;
    }
    setZipping(true);
    try {
      const blob = await zipFiles(
        result.pages.map((page) => ({
          name: pageImageName(pdf.file.name, page.index, pageCount, format),
          bytes: page.bytes,
        })),
        { compression: "STORE" },
      );
      downloadBlob(blob, zipOutputName(pdf.file.name, format));
    } finally {
      setZipping(false);
    }
  };

  const hiddenCount = pageCount - previews.length;

  return (
    <ResultPanel
      title={`${pageCount} ${label} image${pageCount === 1 ? "" : "s"} ready`}
      summary={`${result.resolutionLabel} · ${formatBytes(result.totalBytes)}${
        result.zip ? " · bundled as a ZIP" : ""
      }`}
      onReset={onStartOver}
    >
      <div className="flex w-full flex-col gap-5">
        <UndecodedImagesNotice
          count={result.pages.reduce((sum, p) => sum + p.undecodedImages, 0)}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            // `aria-disabled`, not `disabled`, so zipping does not blur the user
            // out of the button they just pressed. See `RunButton`.
            onClick={() => {
              if (zipping) return;
              void downloadAll();
            }}
            aria-disabled={zipping || undefined}
            aria-busy={zipping}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            {zipping ? (
              <>
                <Spinner />
                Preparing ZIP…
              </>
            ) : result.zip ? (
              <>
                <FileArchive className="size-4" aria-hidden />
                Download ZIP ({pageCount} images)
              </>
            ) : (
              <>
                <Download className="size-4" aria-hidden />
                Download {label}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onReset}
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
          >
            Change resolution
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {previews.map((url, i) => {
            const page = result.pages[i];
            if (!page) return null;
            return (
              <div
                key={page.index}
                className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Page ${page.index + 1}`}
                  className="h-40 w-full bg-black/30 object-contain"
                />
                <div className="flex items-center justify-between gap-2 p-2.5">
                  <span className="text-xs text-slate-400">
                    Page {page.index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadOne(page)}
                    title={`Download page ${page.index + 1}`}
                    className="inline-grid size-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
                  >
                    <Download className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {hiddenCount > 0 && (
          <p className="text-xs text-slate-400">
            Showing the first {previews.length} previews — all {pageCount} pages
            are included in the ZIP.
          </p>
        )}
      </div>
    </ResultPanel>
  );
}

function RenderProgress({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
        <Spinner className="size-3" />
        Rendering {label}… {done}/{total}
      </span>
      <span
        className="h-1 w-full overflow-hidden rounded-full bg-white/5"
        aria-hidden
      >
        <span
          className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </span>
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Icon className="size-4 text-violet-300" aria-hidden />
        {title}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}

/** Copy page bytes into a standalone ArrayBuffer for a Blob part. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
