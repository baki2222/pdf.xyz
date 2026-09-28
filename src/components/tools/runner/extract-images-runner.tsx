"use client";

import { useEffect, useState } from "react";
import {
  Download,
  FileArchive,
  FileWarning,
  ImageDown,
  Images,
  Layers,
  ShieldCheck,
} from "lucide-react";
import type {
  ExtractImagesResult,
  ExtractedImage,
  SkippedImage,
} from "@/lib/pdf/extract-images";
import { downloadBytes, outputName } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  useAsyncRun,
  useOutcomeFocus,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";
import { useZipDownload } from "./use-zip-download";

/** Cap on how many image previews render in the grid; the ZIP still holds all. */
const PREVIEW_LIMIT = 24;

const MIME: Record<ExtractedImage["format"], string> = {
  jpg: "image/jpeg",
  png: "image/png",
};

export function ExtractImagesRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · pulls out the images embedded in it, at their original resolution — all in your browser"
      handoffSlug="extract-images"
      toolName="Extract Images"
    >
      {(pdf, reset) => <ExtractImagesEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

interface Extraction extends ExtractImagesResult {
  /** Sum of extracted image bytes. */
  totalBytes: number;
}

function ExtractImagesEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const { busy, error, result, run, reset } = useAsyncRun<Extraction>();

  const onRun = () => {
    void run(async () => {
      // The extractor (and pdf-lib under it) loads when the work starts.
      const { extractPdfImages } = await import("@/lib/pdf/extract-images");
      const extracted = await extractPdfImages(pdf.bytes);
      return {
        ...extracted,
        totalBytes: extracted.images.reduce(
          (sum, i) => sum + i.bytes.byteLength,
          0,
        ),
      } satisfies Extraction;
    });
  };

  if (result) {
    return (
      <ExtractionResult
        pdf={pdf}
        result={result}
        onReset={reset}
        onStartOver={onReset}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="What gets extracted"
        aside={<span className="text-muted text-xs">Original resolution</span>}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoTile
            icon={ShieldCheck}
            title="Private"
            body="Images are pulled out locally in your browser — the PDF is never uploaded."
          />
          <InfoTile
            icon={Images}
            title="The real images"
            body="Embedded JPEGs are saved as-is; RGB & grayscale images are rebuilt as PNGs — at their native pixel size, not page screenshots."
          />
          <InfoTile
            icon={Layers}
            title="Honest about limits"
            body="JPEG 2000, CCITT/JBIG2 fax, palette (indexed) and CMYK images can't be recovered yet — they're listed as skipped, never faked."
          />
        </div>
      </RunnerSection>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton onClick={onRun} busy={busy} busyLabel="Scanning for images…">
          <ImageDown className="size-4" aria-hidden />
          Extract images
        </RunButton>
      </div>
    </div>
  );
}

function ExtractionResult({
  pdf,
  result,
  onReset,
  onStartOver,
}: {
  pdf: LoadedPdf;
  result: Extraction;
  onReset: () => void;
  onStartOver: () => void;
}) {
  const { images, skipped } = result;
  /**
   * A run that finished and found nothing is still a finished run. This surface
   * is amber rather than emerald and carries no download, so the shared card
   * does not fit and the class-fingerprint guard cannot see it — it is wired by
   * hand and stays amber, because turning a "nothing found" outcome green would
   * be its own small dishonesty.
   */
  const empty = useOutcomeFocus(
    images.length === 0,
    "No extractable images found in this PDF.",
  );

  if (images.length === 0) {
    return (
      <div
        {...empty}
        role="group"
        aria-label="No extractable images found"
        className="animate-float-up border-warn/40 bg-warn/10 focus-visible:ring-warn/50 flex flex-col gap-5 rounded-[4px] border p-6 outline-none focus-visible:ring-2"
      >
        <div className="flex items-start gap-3">
          <span className="bg-warn/10 text-warn grid size-10 shrink-0 place-items-center rounded-[4px]">
            <FileWarning className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h3 className="text-fg text-base font-semibold">
              No extractable images found
            </h3>
            <p className="text-muted text-sm">
              {skipped.length > 0
                ? "This PDF's images are in formats this tool doesn't recover yet (see below), so nothing was extracted."
                : "We scanned every page but found no embedded raster images in this PDF."}
            </p>
          </div>
        </div>
        {skipped.length > 0 && <SkippedNote skipped={skipped} />}
        <button
          type="button"
          onClick={onStartOver}
          className="text-muted hover:text-fg inline-flex items-center gap-1.5 self-start text-xs font-medium transition"
        >
          Start over
        </button>
      </div>
    );
  }

  const zip = images.length > 1;

  return (
    <ResultPanel
      title={`${images.length} image${images.length === 1 ? "" : "s"} extracted`}
      summary={
        <>
          Original resolution · {formatBytes(result.totalBytes)}
          {zip ? " · bundled as a ZIP" : ""}
          {skipped.length > 0 && <> · {skipped.length} skipped</>}
        </>
      }
      onReset={onStartOver}
    >
      <ExtractionActions
        pdf={pdf}
        images={images}
        skipped={skipped}
        zip={zip}
        onReset={onReset}
      />
    </ResultPanel>
  );
}

function ExtractionActions({
  pdf,
  images,
  skipped,
  zip,
  onReset,
}: {
  pdf: LoadedPdf;
  images: ExtractedImage[];
  skipped: SkippedImage[];
  zip: boolean;
  onReset: () => void;
}) {
  const { zipping, zipError, downloadZip } = useZipDownload();

  const downloadOne = (image: ExtractedImage) => {
    downloadBytes(image.bytes, image.name, MIME[image.format]);
  };

  const downloadAll = async () => {
    if (!zip) {
      if (images[0]) downloadOne(images[0]);
      return;
    }
    await downloadZip(
      images.map((image) => ({ name: image.name, bytes: image.bytes })),
      outputName(pdf.file.name, "images", "zip"),
      // Our PNGs use uncompressed IDAT, so DEFLATE meaningfully shrinks them;
      // already-compressed JPEGs simply pass through near their stored size.
      { compression: "DEFLATE" },
    );
  };

  return (
    <div className="flex w-full flex-col gap-5">
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
          ) : zip ? (
            <>
              <FileArchive className="size-4" aria-hidden />
              Download ZIP ({images.length} images)
            </>
          ) : (
            <>
              <Download className="size-4" aria-hidden />
              Download image
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onReset}
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
        >
          Scan again
        </button>
      </div>
      {zipError && <ErrorNote message={zipError} />}

      <ImageGrid images={images} onDownload={downloadOne} />

      {skipped.length > 0 && <SkippedNote skipped={skipped} />}
    </div>
  );
}

function ImageGrid({
  images,
  onDownload,
}: {
  images: ExtractedImage[];
  onDownload: (image: ExtractedImage) => void;
}) {
  // Object URLs for the (capped) preview grid, created in a deferred microtask
  // and revoked on change/unmount so StrictMode's double-invoke can't leak them.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    queueMicrotask(() => {
      if (cancelled) return;
      for (const image of images.slice(0, PREVIEW_LIMIT)) {
        created.push(
          URL.createObjectURL(
            new Blob([bufferOf(image.bytes)], { type: MIME[image.format] }),
          ),
        );
      }
      setPreviews(created);
    });
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [images]);

  const hiddenCount = images.length - previews.length;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {previews.map((url, i) => {
          const image = images[i];
          if (!image) return null;
          return (
            <div
              key={image.name}
              className="group border-line bg-wash overflow-hidden rounded-[4px] border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={image.name}
                className="h-40 w-full bg-black/30 object-contain"
              />
              <div className="flex items-center justify-between gap-2 p-2.5">
                <span className="text-muted min-w-0 truncate text-xs">
                  {image.width}×{image.height} · {image.format.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => onDownload(image)}
                  title={`Download ${image.name}`}
                  className="border-line bg-wash text-muted hover:bg-wash inline-grid size-7 shrink-0 place-items-center rounded-full border transition"
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
          Showing the first {previews.length} previews — all {images.length}{" "}
          images are included in the ZIP.
        </p>
      )}
    </div>
  );
}

/** Honest disclosure of the images we found but did not extract, with reasons. */
function SkippedNote({ skipped }: { skipped: SkippedImage[] }) {
  const groups = new Map<string, number>();
  for (const s of skipped)
    groups.set(s.reason, (groups.get(s.reason) ?? 0) + 1);
  const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="border-line bg-wash rounded-[4px] border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <FileWarning className="text-warn size-4" aria-hidden />
        {skipped.length} image{skipped.length === 1 ? "" : "s"} skipped
      </div>
      <ul className="text-muted flex flex-col gap-1 text-xs leading-relaxed">
        {rows.map(([reason, count]) => (
          <li key={reason} className="flex gap-2">
            <span className="text-muted shrink-0 tabular-nums">{count}×</span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
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
    <div className="border-line bg-wash rounded-[4px] border p-4">
      <div className="text-fg mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-accent size-4" aria-hidden />
        {title}
      </div>
      <p className="text-muted text-xs leading-relaxed">{body}</p>
    </div>
  );
}

/** Copy image bytes into a standalone ArrayBuffer for a Blob part. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
