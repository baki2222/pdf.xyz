"use client";

import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/lib/tools/limits";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileArchive,
  FileImage,
  GripVertical,
  X,
} from "lucide-react";
import {
  imagesToPdf,
  imagesToPdfs,
  perImageZipName,
  imagePdfOutputName,
  imagePickerAccept,
  isImageAllowedForKind,
  sniffRasterFormat,
  unsupportedImageMessage,
  type ImagePdfKind,
} from "@/lib/pdf/image-to-pdf";
import {
  DEFAULT_IMAGE_OUTPUT,
  DEFAULT_IMAGE_PAGE_OPTIONS,
  IMAGE_MARGINS,
  IMAGE_ORIENTATIONS,
  IMAGE_OUTPUTS,
  IMAGE_PAGE_SIZES,
  type ImageOutputId,
  type ImagePageOptions,
} from "@/lib/pdf/image-page-layout";
import { inches } from "@/lib/pdf/page-geometry";
import type { NamedBytes } from "@/lib/pdf/types";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
import { naturalOrder, orderNote } from "@/lib/intent/defaults";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  ChipButton,
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  reorder,
  useAsyncRun,
} from "./runner-kit";
import { OrderNote } from "./order-note";
import { RunBar } from "./run-bar";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { useToolHandoff } from "./use-tool-handoff";
import { useZipDownload } from "./use-zip-download";

/** One owner for the per-image cap: the size check and the copy both derive. */

interface ImageItem {
  id: string;
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
  previewUrl: string;
  /** Where it came in the pick: "Keep drop order" sorts by this. */
  seq: number;
}

interface Rejection {
  name: string;
  reason: string;
}

/** What a run made: one PDF, or one PDF per image for the ZIP. */
type ImagePdfResult =
  | { kind: "single"; bytes: Uint8Array }
  | { kind: "per-image"; files: NamedBytes[] };

export function ImageToPdfRunner({ kind }: { kind: ImagePdfKind }) {
  const slug = kind === "jpg" ? "jpg-to-pdf" : "png-to-pdf";
  const label = kind === "jpg" ? "JPG" : "PNG";
  const handoff = useToolHandoff(slug);
  const [items, setItems] = useState<ImageItem[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [loading, setLoading] = useState(0);
  const idRef = useRef(0);
  const seqRef = useRef(0);
  // The list as last drawn, for a pick to ask whether it is the first.
  const itemsRef = useRef<ImageItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // The reason a natural order was applied, while it still stands.
  const [ordered, setOrdered] = useState<string | null>(null);
  const seededRef = useRef(false);
  const previewUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const accepted: File[] = [];
      const rejected: Rejection[] = [];
      for (const file of files) {
        if (!isImageAllowedForKind(kind, file)) {
          rejected.push({
            name: file.name,
            reason: "Choose PNG or JPG images.",
          });
        } else if (file.size <= 0) {
          rejected.push({ name: file.name, reason: "File is empty." });
        } else if (file.size > MAX_IMAGE_BYTES) {
          rejected.push({
            name: file.name,
            reason: `Max ${MAX_IMAGE_MB} MB per image.`,
          });
        } else {
          accepted.push(file);
        }
      }
      // Each pick reports its own rejections; an old note about a file the
      // user already replaced is not news.
      setRejections(rejected);
      if (!accepted.length) return;
      setLoading((n) => n + accepted.length);
      // SETTLED, not `all`, and the counter comes down in a `finally`. A file
      // moved or deleted after it was picked (or a cloud placeholder that is
      // not on disk) rejects its read; under `Promise.all` that one file
      // dropped the whole pick, left "Loading N images…" on screen forever and
      // kept Create PDF disabled for the images already in the list.
      let settled: PromiseSettledResult<Uint8Array>[];
      try {
        settled = await Promise.allSettled(
          accepted.map((file) => readFileBytes(file)),
        );
      } finally {
        setLoading((n) => Math.max(0, n - accepted.length));
      }
      // Decide by the bytes, now, rather than after the user has arranged
      // every image: a ".png" saved from the web is often a JPEG (fine) or a
      // WebP (not), and the name cannot tell those apart. Pick order is kept:
      // `settled[i]` is `accepted[i]`.
      const loaded: ImageItem[] = [];
      const unreadable: Rejection[] = [];
      for (const [index, outcome] of settled.entries()) {
        const file = accepted[index]!;
        if (outcome.status === "rejected") {
          unreadable.push({
            name: file.name,
            reason: "Could not read this file — pick it again.",
          });
          continue;
        }
        const bytes = outcome.value;
        const format = sniffRasterFormat(bytes);
        if (!format) {
          unreadable.push({
            name: file.name,
            reason: unsupportedImageMessage(file.name, bytes),
          });
          continue;
        }
        loaded.push({
          id: `${Date.now()}-${idRef.current++}`,
          name: file.name,
          type: format === "png" ? "image/png" : "image/jpeg",
          size: file.size,
          bytes,
          previewUrl: URL.createObjectURL(file),
          seq: seqRef.current++,
        });
      }
      if (unreadable.length) setRejections([...rejected, ...unreadable]);
      loaded.forEach((item) => previewUrls.current.add(item.previewUrl));
      // The first images in are put in the order of the numbers in their
      // names when they are one numbered sequence (smart default, E.9), in
      // the same update that draws them.
      const natural =
        itemsRef.current.length === 0
          ? naturalOrder(loaded.map((item) => item.name))
          : null;
      if (itemsRef.current.length === 0)
        setOrdered(natural ? orderNote(natural.numbers) : null);
      const arrived = natural ? natural.order.map((i) => loaded[i]!) : loaded;
      setItems((prev) => [...prev, ...arrived]);
    },
    [kind],
  );

  useEffect(() => {
    if (seededRef.current) return;
    if (handoff.status === "ready" && handoff.files.length > 0) {
      seededRef.current = true;
      queueMicrotask(() => {
        void addFiles(handoff.files);
      });
    }
  }, [handoff.status, handoff.files, addFiles]);

  const { busy, error, result, run, reset } = useAsyncRun<ImagePdfResult>();
  // Page setup. The defaults are the layout every image PDF had before these
  // options existed (US Letter, portrait, 36pt margin, one PDF).
  const [page, setPage] = useState<ImagePageOptions>({
    ...DEFAULT_IMAGE_PAGE_OPTIONS,
  });
  const [outputMode, setOutputMode] =
    useState<ImageOutputId>(DEFAULT_IMAGE_OUTPUT);
  const { zipping, zipError, downloadZip } = useZipDownload();
  const fitToImage = page.pageSize === "fit";
  const setPageOption = (next: Partial<ImagePageOptions>) => {
    if (busy) return;
    setPage((prev) => ({ ...prev, ...next }));
  };
  const move = (from: number, to: number) => {
    setItems((prev) => reorder(prev, from, to));
    setOrdered(null);
  };
  const keepDropOrder = () => {
    setItems((prev) => [...prev].sort((a, b) => a.seq - b.seq));
    setOrdered(null);
  };
  const remove = (id: string) =>
    setItems((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });

  /**
   * Back to an empty picker: images, old rejection notes, and the finished
   * result. The result lives in this component's hook, so emptying the list
   * alone left the success panel up ("0 images") with the old PDF behind it.
   */
  const clearItems = () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    setItems([]);
    setRejections([]);
    setOrdered(null);
    reset();
  };
  const onRun = () =>
    run(async (): Promise<ImagePdfResult> => {
      const inputs = items.map(({ name, type, bytes }) => ({
        name,
        type,
        bytes,
      }));
      // One image is one PDF either way: a ZIP is built only for more than
      // one output, as on every in-browser tool (in-browser-claims.test.ts).
      return outputMode === "per-image" && inputs.length > 1
        ? { kind: "per-image", files: await imagesToPdfs(kind, inputs, page) }
        : { kind: "single", bytes: await imagesToPdf(kind, inputs, page) };
    });

  if (handoff.status === "loading") return <HandoffLoading />;

  if (result?.kind === "per-image") {
    const zipName = perImageZipName(kind, items[0]?.name);
    const total = result.files.reduce((sum, f) => sum + f.bytes.byteLength, 0);
    return (
      <ResultPanel
        title={`${result.files.length} ${label} PDF${result.files.length === 1 ? "" : "s"} created`}
        summary={`One PDF per image · ${formatBytes(total)} · bundled as a ZIP`}
        onReset={clearItems}
        output={result.files.map((f) => outputFile(f.bytes, f.name))}
        onAdjust={reset}
      >
        <div className="flex w-full flex-col gap-3">
          {zipError && <ErrorNote message={zipError} />}
          <button
            type="button"
            onClick={() => {
              if (zipping) return;
              void downloadZip(result.files, zipName, {
                compression: "STORE",
                fallback: "If it keeps failing, choose One PDF instead.",
              });
            }}
            aria-disabled={zipping || undefined}
            aria-busy={zipping}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <FileArchive className="size-4" aria-hidden />
            {zipping
              ? "Preparing ZIP…"
              : `Download ZIP (${result.files.length} PDFs)`}
          </button>
        </div>
      </ResultPanel>
    );
  }

  if (result) {
    const bytes = result.bytes;
    return (
      <ResultPanel
        title={`${label} PDF created`}
        summary={`${items.length} image${items.length === 1 ? "" : "s"} · ${formatBytes(bytes.byteLength)}`}
        onReset={clearItems}
        output={outputFile(bytes, imagePdfOutputName(kind, items[0]?.name))}
        onAdjust={reset}
        // One page per image.
        expectedPages={items.length}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(bytes, imagePdfOutputName(kind, items[0]?.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName={`${label} to PDF`} />
      {handoff.status === "ready" && (
        <HandoffLoadedBadge
          origin={handoff.origin}
          count={handoff.files.length}
          skipped={handoff.skipped}
        />
      )}
      <Dropzone
        pageTarget
        busy={busy}
        onFiles={addFiles}
        accept={imagePickerAccept(kind)}
        multiple
        title={`Drop ${label} images here, or`}
        hint="One image per PDF page · converted locally in your browser"
      />

      {items.length > 0 && (
        <RunnerSection
          title="Image order"
          aside={
            ordered ? (
              <OrderNote note={ordered} onKeep={keepDropOrder} />
            ) : (
              <span className="text-muted text-xs">
                {items.length} image{items.length === 1 ? "" : "s"}
              </span>
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="border-line bg-wash rounded-panel overflow-hidden border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.previewUrl}
                  alt=""
                  className="bg-canvas h-40 w-full object-contain"
                />
                <div className="flex items-center gap-2 p-3">
                  <GripVertical className="text-muted size-4" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-fg truncate text-sm font-medium">
                      {item.name}
                    </p>
                    <p className="text-muted text-xs">
                      Page {index + 1} · {formatBytes(item.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => move(index, index - 1)}
                    aria-disabled={index === 0 || undefined}
                    className={iconButtonClass}
                    title="Move up"
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, index + 1)}
                    aria-disabled={index === items.length - 1 || undefined}
                    className={iconButtonClass}
                    title="Move down"
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    className={iconButtonClass}
                    title="Remove"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </RunnerSection>
      )}

      {items.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          <RunnerSection title="Page size">
            <div className="flex flex-wrap gap-2">
              {IMAGE_PAGE_SIZES.map((size) => (
                <ChipButton
                  key={size.id}
                  onClick={() => setPageOption({ pageSize: size.id })}
                  disabled={busy}
                  active={size.id === page.pageSize}
                  title={
                    size.size
                      ? `${inches(size.size.width)} × ${inches(size.size.height)} in`
                      : "Each page takes its image's own size"
                  }
                >
                  {size.label}
                </ChipButton>
              ))}
            </div>
          </RunnerSection>
          <RunnerSection title="Orientation">
            <div className="flex flex-wrap gap-2">
              {IMAGE_ORIENTATIONS.map((o) => (
                <ChipButton
                  key={o.id}
                  onClick={() => setPageOption({ orientation: o.id })}
                  disabled={busy || fitToImage}
                  active={!fitToImage && o.id === page.orientation}
                  title={
                    o.id === "auto"
                      ? "Landscape for a wide image, portrait otherwise"
                      : undefined
                  }
                >
                  {o.label}
                </ChipButton>
              ))}
            </div>
            {fitToImage && (
              <p className="text-muted text-xs">
                Fit to image gives each page its image&apos;s own shape.
              </p>
            )}
          </RunnerSection>
          <RunnerSection title="Margin">
            <div className="flex flex-wrap gap-2">
              {IMAGE_MARGINS.map((m) => (
                <ChipButton
                  key={m.id}
                  onClick={() => setPageOption({ margin: m.id })}
                  disabled={busy}
                  active={m.id === page.margin}
                >
                  {m.label}
                  {m.points > 0 && (
                    <span className="text-muted text-[10px]">
                      {inches(m.points)} in
                    </span>
                  )}
                </ChipButton>
              ))}
            </div>
          </RunnerSection>
          <RunnerSection title="Output">
            <div className="flex flex-wrap gap-2">
              {IMAGE_OUTPUTS.map((o) => (
                <ChipButton
                  key={o.id}
                  onClick={() => {
                    if (!busy) setOutputMode(o.id);
                  }}
                  disabled={busy}
                  active={o.id === outputMode}
                >
                  {o.label}
                </ChipButton>
              ))}
            </div>
          </RunnerSection>
        </div>
      )}

      {loading > 0 && (
        <p className="text-muted text-sm">
          Loading {loading} image{loading === 1 ? "" : "s"}…
        </p>
      )}
      {rejections.length > 0 && (
        <ErrorNote
          message={rejections.map((r) => `${r.name}: ${r.reason}`).join(" ")}
        />
      )}
      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end gap-3">
          {items.length > 0 && (
            <button
              type="button"
              onClick={clearItems}
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
              )}
            >
              Clear
            </button>
          )}
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={items.length === 0 || loading > 0}
            busyLabel="Creating PDF…"
          >
            <FileImage className="size-4" aria-hidden />
            Create PDF
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

const iconButtonClass =
  "inline-grid size-8 place-items-center rounded-ctl border border-line bg-wash text-muted transition hover:bg-wash aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
