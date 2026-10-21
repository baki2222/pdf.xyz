"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileArchive,
  ImageDown,
  Images,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { rasterizePdf, type RasterPage } from "@/lib/pdf/render";
import { RASTER_MAX_DEVICE_PX } from "@/lib/pdf/render-utils";
import {
  DEFAULT_RESOLUTION_ID,
  RASTER_MIME,
  RASTER_PREVIEW_LIMIT as PREVIEW_LIMIT,
  lowerResolutionThan,
  rasterCapInches,
  rasterCapNote,
  zipFailureFallback,
  RASTER_RESOLUTIONS,
  pageImageName,
  resolutionById,
  shouldZipPages,
  zipOutputName,
  type RasterFormat,
} from "@/lib/pdf/pdf-to-image";
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
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";
import { useZipDownload } from "./use-zip-download";

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
}

export function PdfToImageRunner({ format }: { format: RasterFormat }) {
  const label = format.toUpperCase();
  return (
    <SinglePdfRunner
      hint={`One PDF · every page becomes a ${label} image, rendered locally in your browser`}
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
  const { busy, error, result, run, reset } = useAsyncRun<RasterResult>();
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
    const memory = prep?.memory;
    const kept = memory?.OPTION_SCHEMAS["pdf-to-image"].resolution.values.find(
      (id) => id === resolution.id,
    );
    if (picked && kept)
      memory?.rememberOptions("pdf-to-image", { resolution: kept });
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
        resolutionId: resolution.id,
        resolutionLabel: resolution.label,
        dpi: resolution.dpi,
      } satisfies RasterResult;
    });
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

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            busyLabel={`Rendering ${label}…`}
            progress={progress && { ...progress, unit: "pages" }}
          >
            <ImageDown className="size-4" aria-hidden />
            Render {pdf.pageCount} page{pdf.pageCount === 1 ? "" : "s"}
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
      pageImageName(pdf.file.name, page.index, pageCount, format),
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
        name: pageImageName(pdf.file.name, page.index, pageCount, format),
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

  return (
    <ResultPanel
      title={`${pageCount} ${label} image${pageCount === 1 ? "" : "s"} ready`}
      summary={`${result.resolutionLabel} · ${formatBytes(result.totalBytes)}${
        result.zip ? " · bundled as a ZIP" : ""
      }`}
      onReset={onStartOver}
      output={result.pages.map((page) =>
        outputFile(
          page.bytes,
          pageImageName(pdf.file.name, page.index, pageCount, format),
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
