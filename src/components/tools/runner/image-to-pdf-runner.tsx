"use client";

import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/lib/tools/tool-facts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileImage,
  GripVertical,
  X,
} from "lucide-react";
import {
  imagesToPdf,
  imagePdfOutputName,
  imagePickerAccept,
  isImageAllowedForKind,
  sniffRasterFormat,
  unsupportedImageMessage,
  type ImagePdfKind,
} from "@/lib/pdf/image-to-pdf";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
import { naturalOrder, orderNote } from "@/lib/intent/defaults";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
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

  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();
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
    run(() =>
      imagesToPdf(
        kind,
        items.map(({ name, type, bytes }) => ({ name, type, bytes })),
      ),
    );

  if (handoff.status === "loading") return <HandoffLoading />;

  if (result) {
    return (
      <ResultPanel
        title={`${label} PDF created`}
        summary={`${items.length} image${items.length === 1 ? "" : "s"} · ${formatBytes(result.byteLength)}`}
        onReset={clearItems}
        output={outputFile(result, imagePdfOutputName(kind, items[0]?.name))}
        onAdjust={reset}
        // One page per image.
        expectedPages={items.length}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, imagePdfOutputName(kind, items[0]?.name))
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
