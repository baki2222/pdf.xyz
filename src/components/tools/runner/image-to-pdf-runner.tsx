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
  isImageAllowedForKind,
  type ImagePdfKind,
} from "@/lib/pdf/image-to-pdf";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  reorder,
  useAsyncRun,
} from "./runner-kit";
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
            reason: `Choose ${label} images only.`,
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
      if (rejected.length) setRejections((prev) => [...prev, ...rejected]);
      if (!accepted.length) return;
      setLoading((n) => n + accepted.length);
      const loaded = await Promise.all(
        accepted.map(async (file) => ({
          id: `${Date.now()}-${idRef.current++}`,
          name: file.name,
          type: file.type || (kind === "jpg" ? "image/jpeg" : "image/png"),
          size: file.size,
          bytes: await readFileBytes(file),
          previewUrl: URL.createObjectURL(file),
        })),
      );
      loaded.forEach((item) => previewUrls.current.add(item.previewUrl));
      setItems((prev) => [...prev, ...loaded]);
      setLoading((n) => Math.max(0, n - accepted.length));
    },
    [kind, label],
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

  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  const move = (from: number, to: number) =>
    setItems((prev) => reorder(prev, from, to));
  const remove = (id: string) =>
    setItems((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });

  const clearItems = () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    setItems([]);
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
          count={handoff.files.length}
          skipped={handoff.skipped}
        />
      )}
      <Dropzone
        onFiles={addFiles}
        accept={kind === "jpg" ? "image/jpeg,.jpg,.jpeg" : "image/png,.png"}
        multiple
        title={`Drop ${label} images here, or`}
        hint="One image per PDF page · converted locally in your browser"
      />

      {items.length > 0 && (
        <RunnerSection
          title="Image order"
          aside={
            <span className="text-xs text-slate-400">
              {items.length} image{items.length === 1 ? "" : "s"}
            </span>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-40 w-full bg-black/30 object-contain"
                />
                <div className="flex items-center gap-2 p-3">
                  <GripVertical className="size-4 text-slate-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {item.name}
                    </p>
                    <p className="text-xs text-slate-400">
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
        <p className="text-sm text-slate-400">
          Loading {loading} image{loading === 1 ? "" : "s"}…
        </p>
      )}
      {rejections.length > 0 && (
        <ErrorNote
          message={rejections.map((r) => `${r.name}: ${r.reason}`).join(" ")}
        />
      )}
      {error && <ErrorNote message={error} />}

      <div className="flex justify-end gap-3">
        {items.length > 0 && (
          <button
            type="button"
            onClick={clearItems}
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
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
    </div>
  );
}

const iconButtonClass =
  "inline-grid size-8 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
