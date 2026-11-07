"use client";

import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/lib/tools/limits";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileArchive,
  FileImage,
  GripVertical,
  RotateCw,
  X,
} from "lucide-react";
import {
  imagesToPdf,
  imagesToPdfs,
  perImageZipName,
  imagePdfOutputName,
  imagePageCount,
  imagePickerAccept,
  isImageAllowedForKind,
  IMAGE_MIME,
  sniffImageFormat,
  unsupportedImageMessage,
  type ImagePdfKind,
} from "@/lib/pdf/image-to-pdf";
import { PdfEngineError } from "@/lib/pdf/engine-errors";

import {
  DEFAULT_IMAGE_OUTPUT,
  DEFAULT_IMAGE_PAGE_OPTIONS,
  IMAGE_MARGINS,
  IMAGE_ORIENTATIONS,
  IMAGE_OUTPUTS,
  IMAGE_PAGE_SIZES,
  imageMarginPoints,
  imagePageSizeById,
  PHOTO_DETAILS_CHOICES,
  PHOTO_DETAILS_LABELS,
  type ImageOutputId,
  type ImagePageOptions,
} from "@/lib/pdf/image-page-layout";
import { imagePageSizeForLocales } from "@/lib/pdf/image-page-defaults";
import { imageDecodes, undecodableImageMessage } from "@/lib/pdf/image-intake";
import {
  IMAGE_BOOKMARKS_CHOICES,
  IMAGE_BOOKMARKS_LABELS,
  IMAGE_ORDER_LABELS,
  compareFileNames,
} from "@/lib/pdf/image-bookmarks";
import {
  CUSTOM_PAGE_LABELS,
  LENGTH_UNITS,
  customMargin,
  customPageSize,
  lengthToPoints,
  pageSetupProblem,
  pointsToLength,
  type LengthUnitId,
} from "@/lib/pdf/image-page-custom";
import {
  SMALL_IMAGES_CHOICES,
  SMALL_IMAGES_LABELS,
} from "@/lib/pdf/image-enlarge";
import {
  IMAGE_ROTATION_LABELS,
  nextQuarterTurn,
  type ImageQuarterTurn,
} from "@/lib/pdf/image-rotation";
import { inches } from "@/lib/pdf/page-geometry";
import {
  KB,
  MAX_SIZE_LABELS,
  MAX_SIZE_PRESETS,
  MIN_LIMIT_BYTES,
  MAX_SIZE_HINT,
  chosenLimitBytes,
  limitOutcome,
  type SizeLimitChoice,
} from "@/lib/pdf/image-size-limit";
import type { FittedPdf } from "@/lib/pdf/image-size-fit";
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
  /** `null` for a TIFF: no browser but Safari draws one in an <img>. */
  previewUrl: string | null;
  /** PDF pages it becomes: a TIFF's page count, 1 for any other image. */
  pages: number;
  /** Where it came in the pick: "Keep drop order" sorts by this. */
  seq: number;
  /** The card's Rotate presses, clockwise (audit png-to-pdf#2). */
  rotation: ImageQuarterTurn;
}

/**
 * A TIFF the reader refused when it was added, in the reader's own words
 * (`tiff-limits.ts`: too many pages, a page over the pixel ceiling, a
 * compression it cannot read, a damaged header — each naming the page).
 * `readTiffPages` throws nothing else; the fallback is for a chunk that
 * failed to load. Not imported here: the words stay in the lazy chunk.
 */
function tiffRefusalText(name: string, problem: unknown): string {
  return problem instanceof PdfEngineError
    ? problem.message
    : `"${name}" could not be read as a TIFF image.`;
}

/** "Page 3", or "Pages 3–4" for a multi-page TIFF starting at page 3. */
function pageLabel(first: number, pages: number): string {
  return pages === 1 ? `Page ${first}` : `Pages ${first}–${first + pages - 1}`;
}

interface Rejection {
  name: string;
  reason: string;
}

/**
 * What a run made: one PDF, or one PDF per image for the ZIP. A run under a
 * Max file size also carries what each PDF took (`fits`, one per PDF).
 */
type ImagePdfResult =
  | { kind: "single"; bytes: Uint8Array; fits?: FittedPdf[] }
  | { kind: "per-image"; files: NamedBytes[]; fits?: FittedPdf[] };

/**
 * The panel's line for each PDF a limited run made, worked out from the
 * bytes the person downloads (`limitOutcome`).
 */
function LimitOutcomes({ fits }: { fits?: FittedPdf[] }) {
  if (!fits?.length) return null;
  return (
    <div className="flex w-full flex-col gap-1">
      {fits.map((fit) => {
        const o = limitOutcome({
          limitBytes: fit.report.limitBytes,
          outputBytes: fit.bytes.byteLength,
          reencoded: fit.reencoded,
          flattened: fit.flattened,
          images: fit.images,
        });
        return (
          <p
            key={fit.name}
            data-limit-met={o.met}
            // What the ladder ran, for a reader of the page (and the e2e
            // proof) to check the size named against every size made.
            data-limit-tried={fit.report.tried.map((t) => t.bytes).join(" ")}
            data-limit-stop={fit.report.stoppedBy}
            className={cn(
              "tnum text-sm font-medium",
              o.met ? "text-ok" : "text-warn",
            )}
          >
            {fits.length > 1 ? `${fit.name}: ${o.text}` : o.text}
          </p>
        );
      })}
    </div>
  );
}

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
            reason: "Choose PNG, JPG, WebP, GIF, BMP or TIFF images.",
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
      // every image: a ".png" saved from the web is often a JPEG or a WebP
      // (both fine since 2026-10-30) or a HEIC (not), and the name cannot
      // tell those apart. Pick order is kept:
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
        const format = sniffImageFormat(bytes);
        if (!format) {
          unreadable.push({
            name: file.name,
            reason: unsupportedImageMessage(file.name, bytes),
          });
          continue;
        }
        // A TIFF's pages are counted from its header now — and a TIFF over
        // the page or pixel ceilings, or with a compression the engine cannot
        // read, is refused here, by page, before it is ever decoded.
        let pages = 1;
        if (format === "tiff") {
          try {
            pages = await imagePageCount({ name: file.name, type: "", bytes });
          } catch (problem) {
            unreadable.push({
              name: file.name,
              reason: tiffRefusalText(file.name, problem),
            });
            continue;
          }
        }
        // A JPEG or PNG is embedded now, into a throwaway document, exactly
        // as Create PDF will: an animated PNG or one cut off halfway is
        // refused here rather than stopping the run (audit png-to-pdf#8).
        if (
          (format === "png" || format === "jpg") &&
          !(await imageDecodes(bytes, format))
        ) {
          unreadable.push({
            name: file.name,
            reason: undecodableImageMessage(file.name, format),
          });
          continue;
        }
        loaded.push({
          id: `${Date.now()}-${idRef.current++}`,
          name: file.name,
          type: IMAGE_MIME[format],
          size: file.size,
          bytes,
          previewUrl: format === "tiff" ? null : URL.createObjectURL(file),
          pages,
          seq: seqRef.current++,
          rotation: 0,
        });
      }
      if (unreadable.length) setRejections([...rejected, ...unreadable]);
      loaded.forEach((item) => {
        if (item.previewUrl) previewUrls.current.add(item.previewUrl);
      });
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
  // Page setup. Orientation, margin and output are the layout every image
  // PDF had before these options existed (portrait, 36pt margin, one PDF);
  // the page size starts on the paper of the browser's region, Letter or A4
  // (audit jpg-to-pdf#1). Read once, lazily: the chips are drawn only after
  // an image is added, so the server's render never shows this state.
  const [page, setPage] = useState<ImagePageOptions>(() => ({
    ...DEFAULT_IMAGE_PAGE_OPTIONS,
    pageSize: imagePageSizeForLocales(
      typeof navigator === "undefined"
        ? []
        : navigator.languages?.length
          ? navigator.languages
          : [navigator.language],
    ),
  }));
  // Custom page size and margin (audits jpg-to-pdf#3 / png-to-pdf#5): typed
  // in mm or inches, millimetres unless the paper started on US Letter.
  const [unit, setUnit] = useState<LengthUnitId>(() =>
    page.pageSize === "letter" ? "in" : "mm",
  );
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  const [customMarginText, setCustomMarginText] = useState("");
  // The exact points a Custom field was started on, so switching unit
  // converts 210 mm to 8.27 in and back to 210, not 210.06.
  const startedOn = useRef<Record<"w" | "h" | "m", number>>({
    w: 0,
    h: 0,
    m: 0,
  });
  const typedSize = customPageSize(customW, customH, unit);
  const typedMargin = customMargin(customMarginText, unit);
  /** The options the engine gets: the chips plus whatever was typed. */
  const pageSetup: ImagePageOptions = {
    ...page,
    ...(page.pageSize === "custom" && !("problem" in typedSize)
      ? { customSize: typedSize }
      : {}),
    ...(page.margin === "custom" && typeof typedMargin === "number"
      ? { customMarginPt: typedMargin }
      : {}),
  };
  const sizeInvalid = page.pageSize === "custom" && "problem" in typedSize;
  const marginInvalid =
    !sizeInvalid && page.margin === "custom" && typeof typedMargin === "object";
  const setupProblem = sizeInvalid
    ? typedSize.problem
    : marginInvalid
      ? typedMargin.problem
      : pageSetupProblem(pageSetup, unit);
  /**
   * Where the warning shows and which box it describes: under Page size for
   * a typed size that is wrong, under Margin otherwise (a margin that is
   * wrong, or one that leaves no room on the page).
   */
  const problemAt: "size" | "margin" | undefined = !setupProblem
    ? undefined
    : sizeInvalid
      ? "size"
      : "margin";
  const marginBoxInvalid = problemAt === "margin" && page.margin === "custom";
  const problemId = useId();
  const setupWarning = setupProblem && (
    <p
      id={problemId}
      className="text-warn text-xs leading-relaxed"
      role="status"
    >
      {setupProblem}
    </p>
  );
  /** Custom starts on the paper (or margin) that was chosen, in the unit. */
  const chooseCustomSize = () => {
    if (busy) return;
    if (!customW && !customH) {
      const from =
        imagePageSizeById(page.pageSize === "fit" ? "a4" : page.pageSize)
          .size ?? imagePageSizeById("a4").size!;
      startedOn.current.w = from.width;
      startedOn.current.h = from.height;
      setCustomW(pointsToLength(from.width, unit));
      setCustomH(pointsToLength(from.height, unit));
    }
    setPageOption({ pageSize: "custom" });
  };
  const chooseCustomMargin = () => {
    if (busy) return;
    if (!customMarginText) {
      startedOn.current.m = imageMarginPoints(page.margin);
      setCustomMarginText(pointsToLength(startedOn.current.m, unit));
    }
    setPageOption({ margin: "custom" });
  };
  /** A new unit keeps the lengths already typed, converted. */
  const changeUnit = (next: LengthUnitId) => {
    if (busy || next === unit) return;
    const convert = (
      text: string,
      set: (v: string) => void,
      key: "w" | "h" | "m",
    ) => {
      const start = startedOn.current[key];
      const pt =
        text === pointsToLength(start, unit)
          ? start
          : (lengthToPoints(text, unit) ??
            (text.trim() === "0" ? 0 : undefined));
      if (pt !== undefined) set(pointsToLength(pt, next));
    };
    convert(customW, setCustomW, "w");
    convert(customH, setCustomH, "h");
    convert(customMarginText, setCustomMarginText, "m");
    setUnit(next);
  };
  const unitChips = (
    <div
      role="group"
      aria-label={CUSTOM_PAGE_LABELS.unit}
      className="flex flex-wrap gap-2"
    >
      {LENGTH_UNITS.map((u) => (
        <ChipButton
          key={u.id}
          onClick={() => changeUnit(u.id)}
          disabled={busy}
          active={u.id === unit}
        >
          {u.label}
        </ChipButton>
      ))}
    </div>
  );
  const [outputMode, setOutputMode] =
    useState<ImageOutputId>(DEFAULT_IMAGE_OUTPUT);
  const { zipping, zipError, downloadZip } = useZipDownload();
  // Max file size. "none" runs exactly the PDF this tool always made.
  const [limit, setLimit] = useState<SizeLimitChoice>("none");
  const [customKb, setCustomKb] = useState("");
  const limitBytes = chosenLimitBytes(limit, customKb);
  const customId = useId();
  const fitToImage = page.pageSize === "fit";
  const setPageOption = (next: Partial<ImagePageOptions>) => {
    if (busy) return;
    setPage((prev) => ({ ...prev, ...next }));
  };
  // Drag-and-drop reordering, as Merge and Organize have; the arrow buttons
  // stay as the keyboard path.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    // An arrow at the end of the list moves nothing, so it must not clear
    // the natural-order note either (aria-disabled does not block a click).
    if (to < 0 || to >= items.length || to === from) return;
    setItems((prev) => reorder(prev, from, to));
    setOrdered(null);
  };
  /** Every image, the later picks too, by name (audit png-to-pdf#6). */
  const sortByName = () => {
    if (busy) return;
    setItems((prev) =>
      [...prev].sort((a, b) => compareFileNames(a.name, b.name)),
    );
    setOrdered(null);
  };
  const keepDropOrder = () => {
    setItems((prev) => [...prev].sort((a, b) => a.seq - b.seq));
    setOrdered(null);
  };
  const rotate = (id: string) => {
    if (busy) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, rotation: nextQuarterTurn(item.rotation) }
          : item,
      ),
    );
  };
  const remove = (id: string) =>
    setItems((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed?.previewUrl) {
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
      const inputs = items.map(({ name, type, bytes, rotation }) => ({
        name,
        type,
        bytes,
        rotation,
      }));
      // One image is one PDF either way: a ZIP is built only for more than
      // one output, as on every in-browser tool (in-browser-claims.test.ts).
      const perImage = outputMode === "per-image" && inputs.length > 1;
      if (typeof limitBytes === "number") {
        // Loaded only for a limited run: No limit never fetches the ladder.
        const fit = await import("@/lib/pdf/image-size-fit");
        if (perImage) {
          const fits = await fit.imagesToPdfsUnderLimit(
            kind,
            inputs,
            pageSetup,
            limitBytes,
          );
          return {
            kind: "per-image",
            files: fits.map((f) => ({ name: f.name, bytes: f.bytes })),
            fits,
          };
        }
        const one = await fit.imagesToPdfUnderLimit(
          kind,
          inputs,
          pageSetup,
          limitBytes,
          imagePdfOutputName(kind, inputs[0]?.name),
        );
        return { kind: "single", bytes: one.bytes, fits: [one] };
      }
      return perImage
        ? {
            kind: "per-image",
            files: await imagesToPdfs(kind, inputs, pageSetup),
          }
        : { kind: "single", bytes: await imagesToPdf(kind, inputs, pageSetup) };
    });

  // Every PDF page the list becomes: a multi-page TIFF is several.
  const totalPages = items.reduce((sum, item) => sum + item.pages, 0);

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
          <LimitOutcomes fits={result.fits} />
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
        summary={`${items.length} image${items.length === 1 ? "" : "s"}${totalPages === items.length ? "" : ` · ${totalPages} pages`} · ${formatBytes(bytes.byteLength)}`}
        onReset={clearItems}
        output={outputFile(bytes, imagePdfOutputName(kind, items[0]?.name))}
        onAdjust={reset}
        // One page per image, and one per page of each TIFF.
        expectedPages={totalPages}
      >
        <LimitOutcomes fits={result.fits} />
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
        hint="One image per PDF page, every page of a TIFF · converted locally in your browser"
      />

      {items.length > 0 && (
        <RunnerSection
          title="Image order"
          aside={
            <div className="flex flex-wrap items-center gap-3">
              {ordered ? (
                <OrderNote note={ordered} onKeep={keepDropOrder} />
              ) : (
                <span className="text-muted text-xs">
                  {items.length} image{items.length === 1 ? "" : "s"}
                </span>
              )}
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={sortByName}
                  aria-disabled={busy || undefined}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "tap",
                  )}
                >
                  {IMAGE_ORDER_LABELS.sortByName}
                </button>
              )}
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                draggable={!busy}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIndex(index);
                }}
                onDrop={() => {
                  if (dragIndex !== null && !busy) move(dragIndex, index);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={cn(
                  "bg-wash rounded-panel overflow-hidden border transition",
                  overIndex === index &&
                    dragIndex !== null &&
                    dragIndex !== index
                    ? "border-accent/40 ring-accent/50 ring-1"
                    : "border-line",
                  dragIndex === index && "opacity-50",
                )}
              >
                {item.previewUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.previewUrl}
                    alt=""
                    draggable={false}
                    // The turn the PDF will get, previewed. A quarter turn
                    // swaps the sides, so the picture is shrunk to the
                    // frame's 160px height to stay inside it.
                    style={
                      item.rotation
                        ? {
                            transform: `rotate(${item.rotation}deg)${item.rotation % 180 ? " scale(0.6)" : ""}`,
                          }
                        : undefined
                    }
                    className="bg-canvas h-40 w-full object-contain transition-transform"
                  />
                ) : (
                  <div className="bg-canvas text-muted grid h-40 w-full place-items-center text-xs">
                    <span className="flex flex-col items-center gap-2">
                      <FileImage className="size-8" aria-hidden />
                      TIFF · {item.pages} page{item.pages === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 p-3">
                  <GripVertical
                    className="text-muted size-4 shrink-0 cursor-grab"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-fg truncate text-sm font-medium">
                      {item.name}
                    </p>
                    <p className="text-muted text-xs">
                      {pageLabel(
                        items
                          .slice(0, index)
                          .reduce((sum, before) => sum + before.pages, 1),
                        item.pages,
                      )}{" "}
                      · {formatBytes(item.size)}
                      {item.rotation ? ` · ${item.rotation}°` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => move(index, index - 1)}
                    aria-disabled={index === 0 || undefined}
                    aria-label={`Move ${item.name} earlier`}
                    className={iconButtonClass}
                    title="Move up"
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, index + 1)}
                    aria-disabled={index === items.length - 1 || undefined}
                    aria-label={`Move ${item.name} later`}
                    className={iconButtonClass}
                    title="Move down"
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => rotate(item.id)}
                    aria-label={IMAGE_ROTATION_LABELS.aria(
                      item.name,
                      item.rotation,
                    )}
                    className={iconButtonClass}
                    title={IMAGE_ROTATION_LABELS.button}
                  >
                    <RotateCw className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    aria-label={`Remove ${item.name}`}
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
              <ChipButton
                onClick={chooseCustomSize}
                disabled={busy}
                active={page.pageSize === "custom"}
                title="A width and height of your own, in mm or inches"
              >
                {CUSTOM_PAGE_LABELS.chip}
              </ChipButton>
            </div>
            {page.pageSize === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <span className="text-muted text-xs">
                    {CUSTOM_PAGE_LABELS.shown.width}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={CUSTOM_PAGE_LABELS.width}
                    aria-invalid={sizeInvalid || undefined}
                    aria-describedby={sizeInvalid ? problemId : undefined}
                    value={customW}
                    readOnly={busy}
                    onChange={(event) => setCustomW(event.target.value)}
                    className={lengthInputClass}
                  />
                </label>
                <span className="text-muted text-xs" aria-hidden>
                  ×
                </span>
                <label className="flex items-center gap-1.5">
                  <span className="text-muted text-xs">
                    {CUSTOM_PAGE_LABELS.shown.height}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={CUSTOM_PAGE_LABELS.height}
                    aria-invalid={sizeInvalid || undefined}
                    aria-describedby={sizeInvalid ? problemId : undefined}
                    value={customH}
                    readOnly={busy}
                    onChange={(event) => setCustomH(event.target.value)}
                    className={lengthInputClass}
                  />
                </label>
                {unitChips}
              </div>
            )}
            {problemAt === "size" && setupWarning}
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
              <ChipButton
                onClick={chooseCustomMargin}
                disabled={busy}
                active={page.margin === "custom"}
              >
                {CUSTOM_PAGE_LABELS.chip}
              </ChipButton>
            </div>
            {page.margin === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <span className="text-muted text-xs">
                    {CUSTOM_PAGE_LABELS.shown.margin}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={CUSTOM_PAGE_LABELS.margin}
                    aria-invalid={marginBoxInvalid || undefined}
                    aria-describedby={marginBoxInvalid ? problemId : undefined}
                    value={customMarginText}
                    readOnly={busy}
                    onChange={(event) =>
                      setCustomMarginText(event.target.value)
                    }
                    className={lengthInputClass}
                  />
                </label>
                {page.pageSize === "custom" ? (
                  <span className="text-muted text-xs">{unit}</span>
                ) : (
                  unitChips
                )}
              </div>
            )}
            {problemAt === "margin" && setupWarning}
          </RunnerSection>
          {/* Audits jpg-to-pdf#4 / png-to-pdf#4: an image smaller than the
              paper is kept at its size unless Enlarge to fit is chosen. */}
          <RunnerSection title={SMALL_IMAGES_LABELS.heading}>
            <div
              role="group"
              aria-label={SMALL_IMAGES_LABELS.heading}
              className="flex flex-wrap gap-2"
            >
              {SMALL_IMAGES_CHOICES.map((c) => (
                <ChipButton
                  key={c.id}
                  onClick={() => setPageOption({ smallImages: c.id })}
                  disabled={busy || fitToImage}
                  active={!fitToImage && c.id === (page.smallImages ?? "keep")}
                >
                  {c.label}
                </ChipButton>
              ))}
            </div>
            {fitToImage && (
              <p className="text-muted text-xs">
                {SMALL_IMAGES_LABELS.fitNote}
              </p>
            )}
          </RunnerSection>
          {/* Only a JPEG carries details the choice can act on: a PNG's
              chunks never reach the PDF (png-embed copies IDAT only), and a
              WebP, GIF or BMP is saved again with its pixels alone. So the
              choice is shown only while the list holds a JPEG, on PNG to
              PDF as on JPG to PDF (image-to-pdf-photo-details.test.tsx). */}
          {items.some((item) => item.type === IMAGE_MIME.jpg) && (
            <RunnerSection title={PHOTO_DETAILS_LABELS.heading}>
              <div
                role="group"
                aria-label={PHOTO_DETAILS_LABELS.heading}
                className="flex flex-wrap gap-2"
              >
                {PHOTO_DETAILS_CHOICES.map((c) => (
                  <ChipButton
                    key={c.id}
                    onClick={() => setPageOption({ photoDetails: c.id })}
                    disabled={busy}
                    active={c.id === (page.photoDetails ?? "remove")}
                  >
                    {c.label}
                  </ChipButton>
                ))}
              </div>
            </RunnerSection>
          )}
          <RunnerSection title={MAX_SIZE_LABELS.heading}>
            <div
              role="group"
              aria-label={MAX_SIZE_LABELS.heading}
              className="flex flex-wrap items-center gap-2"
            >
              <ChipButton
                onClick={() => {
                  if (!busy) setLimit("none");
                }}
                disabled={busy}
                active={limit === "none"}
              >
                {MAX_SIZE_LABELS.none}
              </ChipButton>
              {MAX_SIZE_PRESETS.map((p) => (
                <ChipButton
                  key={p.bytes}
                  onClick={() => {
                    if (!busy) setLimit(p.bytes);
                  }}
                  disabled={busy}
                  active={limit === p.bytes}
                >
                  {p.label}
                </ChipButton>
              ))}
              <ChipButton
                onClick={() => {
                  if (!busy) setLimit("custom");
                }}
                disabled={busy}
                active={limit === "custom"}
              >
                {MAX_SIZE_LABELS.custom}
              </ChipButton>
              {limit === "custom" && (
                <span className="text-muted inline-flex items-center gap-1.5 text-xs">
                  <input
                    id={customId}
                    type="text"
                    inputMode="numeric"
                    aria-label="Custom max file size in KB"
                    placeholder="150"
                    value={customKb}
                    readOnly={busy}
                    onChange={(event) => setCustomKb(event.target.value)}
                    className="border-line text-fg focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl h-11 w-24 border px-3.5 text-sm transition outline-none focus:ring-2"
                  />
                  <label htmlFor={customId}>KB</label>
                </span>
              )}
            </div>
            {limit !== "none" && (
              <p
                className={cn(
                  "text-xs leading-relaxed",
                  limitBytes === "invalid" ? "text-warn" : "text-muted",
                )}
              >
                {limitBytes === "invalid"
                  ? `Enter a whole number of KB, ${MIN_LIMIT_BYTES / KB} or more.`
                  : MAX_SIZE_HINT}
              </p>
            )}
          </RunnerSection>
          {/* Audit png-to-pdf#6: a bookmark per image, titled with its
              file name, in One PDF of two or more images. */}
          <RunnerSection title={IMAGE_BOOKMARKS_LABELS.heading}>
            <div
              role="group"
              aria-label={IMAGE_BOOKMARKS_LABELS.heading}
              className="flex flex-wrap gap-2"
            >
              {IMAGE_BOOKMARKS_CHOICES.map((c) => (
                <ChipButton
                  key={c.id}
                  onClick={() => setPageOption({ bookmarks: c.id })}
                  disabled={busy || outputMode === "per-image"}
                  active={
                    outputMode !== "per-image" &&
                    c.id === (page.bookmarks ?? "none")
                  }
                >
                  {c.label}
                </ChipButton>
              ))}
            </div>
            {outputMode === "per-image" && (
              <p className="text-muted text-xs">
                {IMAGE_BOOKMARKS_LABELS.perImageNote}
              </p>
            )}
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
            disabled={
              items.length === 0 ||
              loading > 0 ||
              limitBytes === "invalid" ||
              Boolean(setupProblem)
            }
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

/** A typed length (custom page side or margin): 44px tall, like the chips. */
const lengthInputClass =
  "border-line text-fg focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl h-11 w-20 border px-3 text-sm transition outline-none focus:ring-2";

const iconButtonClass =
  "tap inline-grid size-8 place-items-center rounded-ctl border border-line bg-wash text-muted transition hover:bg-wash aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
