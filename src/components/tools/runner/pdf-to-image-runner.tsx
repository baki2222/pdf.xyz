"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileArchive,
  ImageDown,
  Images,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
// Type-only: the rasterizer loads when a run starts, not with the page.
import type { RasterPage } from "@/lib/pdf/render";
import { RASTER_MAX_DEVICE_PX } from "@/lib/pdf/render-utils";
import {
  DEFAULT_JPEG_QUALITY_ID,
  DEFAULT_RASTER_BACKGROUND,
  DEFAULT_RASTER_COLOR,
  DEFAULT_RESOLUTION_ID,
  JPEG_QUALITY_LABEL,
  RASTER_BACKGROUNDS,
  RASTER_BACKGROUND_LABEL,
  RASTER_COLORS,
  RASTER_JPEG_QUALITIES,
  jpegQualityById,
  type RasterBackgroundId,
  type RasterJpegQualityId,
  RASTER_MIME,
  RASTER_PREVIEW_LIMIT as PREVIEW_LIMIT,
  lowerResolutionThan,
  rasterCapInches,
  rasterCapNote,
  zipFailureFallback,
  skippedPagesNote,
  cancelledRunNote,
  RASTER_RESOLUTIONS,
  pageImageName,
  resolutionById,
  shouldZipPages,
  zipOutputName,
  rasterPageSelection,
  type RasterColorId,
  type RasterFormat,
  type RasterPageChoice,
} from "@/lib/pdf/pdf-to-image";
import { formatPageNumbers } from "@/lib/pdf/ranges";
import { downloadBytes } from "@/lib/pdf/browser";
import { loadRasterDefaults, rasterDefaults } from "./raster-defaults-chunk";
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
  NO_ADJUST,
  outputFile,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import {
  FileHeader,
  SinglePdfRunner,
  type SinglePdfBatch,
} from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";
import { useZipDownload } from "./use-zip-download";
import { LazyPagePicker } from "./page-picker-lazy";
import { pageListText, pagesInText } from "./page-picker-text";

export interface RasterResult {
  pages: RasterPage[];
  /** Sum of encoded image bytes across every page. */
  totalBytes: number;
  /** True when the output is delivered as a ZIP (more than one page). */
  zip: boolean;
  /** Preset id the pages were rendered at. */
  resolutionId: string;
  /** Human label of the resolution the pages were rendered at. */
  resolutionLabel: string;
  /** The DPI that preset asked for — what a capped page fell short of. */
  dpi: number;
  /** True when the pages were rendered in grayscale. */
  grayscale: boolean;
  /** Pages in the source document — what each file's page number is out of. */
  documentPages: number;
  /**
   * 0-based pages that failed to render and were left out (audit #37): the
   * rest are delivered, and the panel names these.
   */
  failedPages: number[];
  /**
   * Set when the reader pressed Cancel: the pages finished before it are the
   * result, out of `asked`.
   */
  cancelled?: { asked: number };
}

/**
 * Two or more PDFs: the batch (batch plan P2), its own chunk, fetched only
 * when they arrive — never with a visit to this page.
 */
const PdfToImageBatch = dynamic(
  () => import("./batch/pdf-to-image-batch").then((m) => m.PdfToImageBatch),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
const batchJpg = (props: SinglePdfBatch) => (
  <PdfToImageBatch {...props} format="jpg" />
);
const batchPng = (props: SinglePdfBatch) => (
  <PdfToImageBatch {...props} format="png" />
);

export function PdfToImageRunner({ format }: { format: RasterFormat }) {
  const label = format.toUpperCase();
  return (
    <SinglePdfRunner
      hint={`One or more PDFs · each page (or the pages you choose, for one file) becomes a ${label} image, rendered locally in your browser`}
      batch={format === "png" ? batchPng : batchJpg}
      handoffSlug={format === "png" ? "pdf-to-png" : "pdf-to-jpg"}
      toolName={`PDF to ${label}`}
      writesPdf={false}
      reader="pdfjs"
      prepare={loadRasterDefaults}
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
  const { busy, error, result, run, reset } =
    useAsyncRun<RasterResult | null>();
  // A long PDF opens at Screen, said with its reason (smart default);
  // otherwise at the resolution last chosen here (option memory).
  // Both fetched while the file opened (`raster-defaults-chunk`).
  const [prep] = useState(rasterDefaults);
  const [smart] = useState(
    () =>
      prep?.defaults.defaultResolution(pdf.pageCount, RASTER_RESOLUTIONS) ??
      null,
  );
  const [resolutionId, setResolutionId] = useState<string>(
    () =>
      smart?.id ??
      prep?.memory.recallOptions("pdf-to-image").resolution ??
      DEFAULT_RESOLUTION_ID,
  );
  // Only a resolution the reader picked is remembered, never one chosen
  // for them.
  const [picked, setPicked] = useState(false);
  // Colour is remembered too (option memory); the page range is typed text
  // and is never kept.
  const [color, setColor] = useState<RasterColorId>(
    () =>
      prep?.memory.recallOptions("pdf-to-image").color ?? DEFAULT_RASTER_COLOR,
  );
  const [colorPicked, setColorPicked] = useState(false);
  // PDF to JPG's Quality preset, remembered like Resolution once picked.
  const [qualityId, setQualityId] = useState<RasterJpegQualityId>(
    () =>
      prep?.memory.recallOptions("pdf-to-image").quality ??
      DEFAULT_JPEG_QUALITY_ID,
  );
  const [qualityPicked, setQualityPicked] = useState(false);
  // PDF to PNG's page background; not remembered — a transparent page is a
  // choice for one file (a logo, a signature), not a habit.
  const [background, setBackground] = useState<RasterBackgroundId>(
    DEFAULT_RASTER_BACKGROUND,
  );
  const [pageChoice, setPageChoice] = useState<RasterPageChoice>({
    mode: "all",
    range: "",
  });
  let selection: number[] = [];
  let rangeError: string | null = null;
  try {
    selection = rasterPageSelection(pageChoice, pdf.pageCount);
  } catch (err) {
    rangeError = err instanceof Error ? err.message : String(err);
  }
  const count = selection.length;
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The controller the reader stopped with Cancel — told apart from an
  // abort on unmount or a re-run, which keeps nothing.
  const cancelledRef = useRef<AbortController | null>(null);

  // Abort any in-flight render if this editor unmounts (e.g. "Start over").
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const onRun = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const resolution = resolutionById(resolutionId);
    const memory = prep?.memory;
    const kept = memory?.OPTION_SCHEMAS["pdf-to-image"].resolution.values.find(
      (id) => id === resolution.id,
    );
    if (rangeError || selection.length === 0) return;
    if (picked || colorPicked || qualityPicked) {
      const prior = memory?.recallOptions("pdf-to-image") ?? {};
      memory?.rememberOptions("pdf-to-image", {
        ...prior,
        ...(picked && kept ? { resolution: kept } : {}),
        ...(colorPicked ? { color } : {}),
        ...(qualityPicked ? { quality: qualityId } : {}),
      });
    }
    const pages = selection;
    const grayscale = color === "gray";
    setProgress({ done: 0, total: pages.length });
    void run(async () => {
      const { rasterizePdf } = await import("@/lib/pdf/render");
      const failedPages: number[] = [];
      let firstFailure = "";
      const rendered = await rasterizePdf(pdf.bytes, {
        format,
        dpi: resolution.dpi,
        // PNG is lossless: the encoder ignores a quality for it.
        ...(format === "jpg"
          ? { quality: jpegQualityById(qualityId).quality }
          : {}),
        ...(format === "png" && background === "transparent"
          ? { transparent: true }
          : {}),
        pages,
        grayscale,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
        // One bad page is named and left out; it no longer costs the pages
        // already rendered (audit #37).
        onPageFailed: ({ index, message }) => {
          failedPages.push(index);
          firstFailure ||= message;
        },
      });
      const cancelled = cancelledRef.current === controller;
      if (controller.signal.aborted && !cancelled) {
        // Editor is unmounting, or a new run replaced this one; surface nothing.
        throw new Error("Rendering was cancelled.");
      }
      if (rendered.length === 0) {
        if (cancelled) {
          // Stopped before a page finished: nothing to keep, nothing wrong.
          setProgress(null);
          return null;
        }
        throw new Error(
          `No pages could be rendered from this PDF.${firstFailure ? ` ${firstFailure}` : ""}`,
        );
      }
      return {
        pages: rendered,
        totalBytes: rendered.reduce((sum, p) => sum + p.bytes.byteLength, 0),
        zip: shouldZipPages(rendered.length),
        resolutionId: resolution.id,
        resolutionLabel: resolution.label,
        dpi: resolution.dpi,
        grayscale,
        documentPages: pdf.pageCount,
        failedPages,
        ...(cancelled ? { cancelled: { asked: pages.length } } : {}),
      } satisfies RasterResult;
    });
  };

  // Stop the run in hand and keep what it finished (audit #37). The engine
  // already resolves early with the pages so far on abort.
  const onCancel = () => {
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
    cancelledRef.current = controller;
    controller.abort();
  };

  // Changing the resolution clears a finished render so the user can re-render.
  const changeResolution = (id: string) => {
    if (busy) return;
    setResolutionId(id);
    setPicked(true);
    if (result) {
      reset();
      setProgress(null);
    }
  };

  // Any other option change also clears a finished render.
  const clearResult = () => {
    if (result) {
      reset();
      setProgress(null);
    }
  };
  const changeColor = (id: RasterColorId) => {
    if (busy) return;
    setColor(id);
    setColorPicked(true);
    clearResult();
  };
  const changeQuality = (id: RasterJpegQualityId) => {
    if (busy) return;
    setQualityId(id);
    setQualityPicked(true);
    clearResult();
  };
  const changeBackground = (id: RasterBackgroundId) => {
    if (busy) return;
    setBackground(id);
    clearResult();
  };
  const changePages = (next: RasterPageChoice) => {
    if (busy) return;
    setPageChoice(next);
    clearResult();
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
        aside={<span className="text-muted text-xs">{label} output</span>}
      >
        <div className="flex flex-wrap gap-2">
          {RASTER_RESOLUTIONS.map((res) => (
            <ChipButton
              key={res.id}
              onClick={() => changeResolution(res.id)}
              disabled={busy}
              active={res.id === resolutionId}
              title={`${res.dpi} DPI for pages up to ${rasterCapInches(
                res.dpi,
                RASTER_MAX_DEVICE_PX,
              )} in on a side; larger pages may render lower`}
            >
              {res.label}
              <span className="text-muted text-[10px]">{res.dpi} DPI</span>
            </ChipButton>
          ))}
        </div>
        {smart && resolutionId === smart.id && (
          <p data-smart-default="" className="text-muted text-xs">
            {smart.reason}
          </p>
        )}
      </RunnerSection>

      <RunnerSection title="Pages">
        <div className="flex flex-wrap gap-2">
          <ChipButton
            onClick={() => changePages({ ...pageChoice, mode: "all" })}
            disabled={busy}
            active={pageChoice.mode === "all"}
          >
            All pages
          </ChipButton>
          <ChipButton
            onClick={() => changePages({ ...pageChoice, mode: "range" })}
            disabled={busy}
            active={pageChoice.mode === "range"}
          >
            Select pages
          </ChipButton>
        </div>
        {pageChoice.mode === "range" && (
          <label className="flex flex-col gap-2">
            <span className="text-muted text-sm">
              Pages to render (of {pdf.pageCount})
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={pageChoice.range}
              onChange={(e) =>
                changePages({ mode: "range", range: e.target.value })
              }
              placeholder="e.g. 1-3, 5"
              spellCheck={false}
              aria-invalid={rangeError ? true : undefined}
              className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 rounded-ctl w-full max-w-xs border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
            />
            <span className="text-muted text-xs">
              Separate pages with commas; ranges are inclusive, e.g.{" "}
              <code className="text-muted">1-3, 5, 8-</code>.
            </span>
          </label>
        )}
        {pageChoice.mode === "range" &&
          rangeError &&
          pageChoice.range.trim() && <ErrorNote message={rangeError} />}
        {pageChoice.mode === "range" && (
          // The same choice on the pages themselves (audit pdf-to-png#7): a
          // press rewrites the box above, and typing redraws the pages.
          <LazyPagePicker
            bytes={pdf.bytes}
            pageCount={pdf.pageCount}
            rotations={pdf.rotations}
            mode="select"
            label="Pages — press a page to render it or leave it out"
            value={pagesInText(pageChoice.range, pdf.pageCount)}
            onChange={(next) =>
              changePages({ mode: "range", range: pageListText(next) })
            }
            disabled={busy}
          />
        )}
      </RunnerSection>

      <RunnerSection title="Colour">
        <div className="flex flex-wrap gap-2">
          {RASTER_COLORS.map((c) => (
            <ChipButton
              key={c.id}
              onClick={() => changeColor(c.id)}
              disabled={busy}
              active={c.id === color}
            >
              {c.label}
            </ChipButton>
          ))}
        </div>
      </RunnerSection>

      {format === "png" && (
        <RunnerSection title={RASTER_BACKGROUND_LABEL}>
          <div
            role="group"
            aria-label={RASTER_BACKGROUND_LABEL}
            className="flex flex-wrap gap-2"
          >
            {RASTER_BACKGROUNDS.map((b) => (
              <ChipButton
                key={b.id}
                onClick={() => changeBackground(b.id)}
                disabled={busy}
                active={b.id === background}
              >
                {b.label}
              </ChipButton>
            ))}
          </div>
        </RunnerSection>
      )}

      {format === "jpg" && (
        <RunnerSection title={JPEG_QUALITY_LABEL}>
          <div
            role="group"
            aria-label={JPEG_QUALITY_LABEL}
            className="flex flex-wrap gap-2"
          >
            {RASTER_JPEG_QUALITIES.map((q) => (
              <ChipButton
                key={q.id}
                onClick={() => changeQuality(q.id)}
                disabled={busy}
                active={q.id === qualityId}
              >
                {q.label}
                <span aria-hidden="true" className="text-muted text-[10px]">
                  {Math.round(q.quality * 100)}
                </span>
                <span className="sr-only">
                  , quality {Math.round(q.quality * 100)} out of 100
                </span>
              </ChipButton>
            ))}
          </div>
        </RunnerSection>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={ShieldCheck}
          title="Private"
          body="Pages render locally in your browser — the PDF is never uploaded."
        />
        <InfoTile
          icon={Images}
          title={pageChoice.mode === "all" ? "Every page" : "Chosen pages"}
          body={
            pageChoice.mode === "all"
              ? `All ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"} are exported as ${label} images.`
              : count > 0
                ? `${count} of ${pdf.pageCount} pages (${formatPageNumbers(selection.map((i) => i + 1))}) are exported as ${label} images.`
                : `Type the pages to export, out of ${pdf.pageCount}.`
          }
        />
        <InfoTile
          icon={FileArchive}
          title={count === 1 ? "Single image" : "One ZIP"}
          body={
            count === 1
              ? `A single page downloads as one ${label} file.`
              : "Multiple pages are bundled into a single ZIP download."
          }
        />
      </div>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex flex-wrap items-start justify-end gap-3">
          {busy && (
            <button
              type="button"
              onClick={onCancel}
              className={buttonVariants({ variant: "secondary", size: "lg" })}
            >
              Cancel
            </button>
          )}
          <RunButton
            onClick={onRun}
            busy={busy}
            busyLabel={`Rendering ${label}…`}
            progress={progress && { ...progress, unit: "pages" }}
            disabled={count === 0}
          >
            <ImageDown className="size-4" aria-hidden />
            Render {count} page{count === 1 ? "" : "s"}
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

export function ImageResult({
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
  // File names number each page out of the DOCUMENT, so page 5 of a
  // 12-page PDF is "-page-05" whether or not every page was rendered.
  const docPages = result.documentPages;
  const { zipping, zipError, downloadZip } = useZipDownload();

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
      pageImageName(pdf.file.name, page.index, docPages, format),
      mime,
    );
  };

  // What this page can honestly offer when the archive fails: a lower preset
  // (smaller images, a smaller archive) if there is one, and the per-page
  // buttons only when every page HAS one — past PREVIEW_LIMIT they do not.
  const zipFallback = zipFailureFallback({
    lowerResolution: lowerResolutionThan(result.resolutionId)?.label,
    everyPageHasButton: pageCount <= PREVIEW_LIMIT,
  });

  const downloadAll = async () => {
    if (!result.zip) {
      const first = result.pages[0];
      if (first) downloadOne(first);
      return;
    }
    await downloadZip(
      result.pages.map((page) => ({
        name: pageImageName(pdf.file.name, page.index, docPages, format),
        bytes: page.bytes,
      })),
      zipOutputName(pdf.file.name, format),
      { compression: "STORE", fallback: zipFallback },
    );
  };

  const hiddenCount = pageCount - previews.length;
  // The preset names a DPI; pages too large for it were rendered lower, and
  // the engine said which. Without this the summary overstated every one.
  const capNote = rasterCapNote(result.pages, result.dpi, RASTER_MAX_DEVICE_PX);
  const skippedNote = skippedPagesNote(
    result.failedPages,
    lowerResolutionThan(result.resolutionId)?.label,
  );
  const stoppedNote =
    result.cancelled && cancelledRunNote(pageCount, result.cancelled.asked);

  return (
    <ResultPanel
      title={`${pageCount} ${label} image${pageCount === 1 ? "" : "s"} ready`}
      summary={`${result.resolutionLabel}${result.grayscale ? " · Grayscale" : ""} · ${formatBytes(result.totalBytes)}${
        result.zip ? " · bundled as a ZIP" : ""
      }`}
      onReset={onStartOver}
      output={result.pages.map((page) =>
        outputFile(
          page.bytes,
          pageImageName(pdf.file.name, page.index, docPages, format),
          mime,
        ),
      )}
      // "Change resolution", beside Download, is this tool's way back.
      onAdjust={NO_ADJUST(
        "Change resolution, beside Download, returns to the resolution chips with the same file",
      )}
    >
      <div className="flex w-full flex-col gap-5">
        <UndecodedImagesNotice
          count={result.pages.reduce((sum, p) => sum + p.undecodedImages, 0)}
        />
        {[stoppedNote, skippedNote].map(
          (note) =>
            note && (
              <div
                key={note}
                role="status"
                className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="leading-relaxed">{note}</p>
              </div>
            ),
        )}
        {capNote && (
          <div className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-3 border px-4 py-3.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="leading-relaxed">{capNote}</p>
          </div>
        )}
        {zipError && <ErrorNote message={zipError} />}
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
                className="group border-line bg-wash rounded-panel overflow-hidden border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Page ${page.index + 1}`}
                  className="bg-canvas h-40 w-full object-contain"
                />
                <div className="flex items-center justify-between gap-2 p-2.5">
                  <span className="text-muted text-xs">
                    Page {page.index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadOne(page)}
                    title={`Download page ${page.index + 1}`}
                    className="border-line bg-wash text-muted hover:bg-wash rounded-ctl inline-grid size-7 place-items-center border transition"
                  >
                    <Download className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {hiddenCount > 0 && (
          <p className="text-muted text-xs">
            Showing the first {previews.length} previews — all {pageCount} pages
            are included in the ZIP.
          </p>
        )}
      </div>
    </ResultPanel>
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

/** Copy page bytes into a standalone ArrayBuffer for a Blob part. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
