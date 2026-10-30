"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Download,
  FileImage,
  RotateCw,
  X,
} from "lucide-react";
import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/lib/tools/limits";
import { isEmbeddableImage, sniffRasterFormat } from "@/lib/pdf/image-to-pdf";
import {
  SCAN_ENHANCEMENTS,
  type ScanEnhancement,
} from "@/lib/pdf/scan-enhance";
import {
  SCAN_PAGE_SIZES,
  scanOutputName,
  scansToPdf,
  type ScanPageInput,
  type ScanPageSizeId,
  type ScanResult,
} from "@/lib/pdf/scan-to-pdf";
import {
  pagePreview,
  photoThumbnail,
  preparePhotoPage,
  type QuarterTurns,
} from "@/lib/pdf/scan-browser";
import { downloadBytes } from "@/lib/pdf/browser";
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
import { RunBar } from "./run-bar";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { PrivacyLine } from "./stamp-controls";
import { useToolHandoff } from "./use-tool-handoff";

/** Labels the page's steps and answers quote — one owner each. */
export const SCAN_CAMERA_LABEL = "Take photo";
export const SCAN_RUN_LABEL = "Create PDF";
export const SCAN_DOWNLOAD_LABEL = "Download PDF";

interface ScanItem {
  id: string;
  file: File;
  name: string;
  size: number;
  /** A small upright copy, previews are drawn from it. */
  thumbnail: ImageBitmap | null;
  turns: QuarterTurns;
}

interface Rejection {
  name: string;
  reason: string;
}

export function ScanRunner() {
  const handoff = useToolHandoff("scan-to-pdf");
  const [items, setItems] = useState<ScanItem[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [loading, setLoading] = useState(0);
  const [enhancement, setEnhancement] = useState<ScanEnhancement>("document");
  const [pageSize, setPageSize] = useState<ScanPageSizeId>("a4");
  const [progress, setProgress] = useState<string | null>(null);
  const idRef = useRef(0);
  const seededRef = useRef(false);
  const { busy, error, result, run, reset } = useAsyncRun<ScanResult>();

  // Release every thumbnail when the runner goes away.
  const itemsRef = useRef<ScanItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(
    () => () => itemsRef.current.forEach((item) => item.thumbnail?.close()),
    [],
  );

  const addFiles = useCallback(async (files: File[]) => {
    const accepted: File[] = [];
    const rejected: Rejection[] = [];
    for (const file of files) {
      if (!isEmbeddableImage(file)) {
        rejected.push({ name: file.name, reason: "Choose JPG or PNG photos." });
      } else if (file.size <= 0) {
        rejected.push({ name: file.name, reason: "File is empty." });
      } else if (file.size > MAX_IMAGE_BYTES) {
        rejected.push({
          name: file.name,
          reason: `Max ${MAX_IMAGE_MB} MB per photo.`,
        });
      } else {
        accepted.push(file);
      }
    }
    setRejections(rejected);
    if (!accepted.length) return;
    setLoading((n) => n + accepted.length);
    const added: ScanItem[] = [];
    const unreadable: Rejection[] = [];
    try {
      // One at a time: a phone holds one decoded photo, not a pick's worth.
      for (const file of accepted) {
        try {
          const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
          if (!sniffRasterFormat(head)) throw new Error("not an image");
          const thumbnail = await photoThumbnail(file);
          added.push({
            id: `${Date.now()}-${idRef.current++}`,
            file,
            name: file.name || `photo-${idRef.current}.jpg`,
            size: file.size,
            thumbnail,
            turns: 0,
          });
        } catch {
          unreadable.push({
            name: file.name,
            reason: "This photo could not be read — take or pick it again.",
          });
        }
      }
    } finally {
      setLoading((n) => Math.max(0, n - accepted.length));
    }
    if (unreadable.length) setRejections([...rejected, ...unreadable]);
    setItems((prev) => [...prev, ...added]);
  }, []);

  useEffect(() => {
    if (seededRef.current) return;
    if (handoff.status === "ready" && handoff.files.length > 0) {
      seededRef.current = true;
      queueMicrotask(() => {
        void addFiles(handoff.files);
      });
    }
  }, [handoff.status, handoff.files, addFiles]);

  const move = (from: number, to: number) =>
    setItems((prev) => reorder(prev, from, to));
  const turn = (id: string) =>
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, turns: ((item.turns + 1) % 4) as QuarterTurns }
          : item,
      ),
    );
  const remove = (id: string) =>
    setItems((prev) => {
      prev.find((item) => item.id === id)?.thumbnail?.close();
      return prev.filter((item) => item.id !== id);
    });
  const clearItems = () => {
    items.forEach((item) => item.thumbnail?.close());
    setItems([]);
    setRejections([]);
    reset();
  };

  const onRun = () =>
    run(async () => {
      const inputs: ScanPageInput[] = [];
      try {
        for (const [index, item] of items.entries()) {
          setProgress(`Preparing page ${index + 1} of ${items.length}…`);
          inputs.push(
            await preparePhotoPage(item.file, item.turns, enhancement),
          );
        }
        setProgress("Saving the PDF…");
        return await scansToPdf(inputs, pageSize);
      } finally {
        setProgress(null);
      }
    });

  if (handoff.status === "loading") return <HandoffLoading />;

  if (result) {
    const name = scanOutputName();
    return (
      <ResultPanel
        title="Scan saved as PDF"
        summary={`${result.pages.length} page${result.pages.length === 1 ? "" : "s"} · ${SCAN_ENHANCEMENTS.find((e) => e.id === enhancement)!.label} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={clearItems}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        expectedPages={result.pages.length}
      >
        <button
          type="button"
          onClick={() => downloadBytes(result.bytes, name)}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          {SCAN_DOWNLOAD_LABEL}
        </button>
      </ResultPanel>
    );
  }

  return (
    <div data-scan-runner="" className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName="Scan to PDF" />
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
        onFiles={(files) => void addFiles(files)}
        accept="image/jpeg,image/png"
        multiple
        compact={items.length > 0}
        title="Drop photos here, or"
        hint="JPG or PNG photos · one page each · made into a PDF in your browser"
      />

      <CameraButton
        disabled={busy}
        onFiles={(files) => void addFiles(files)}
        again={items.length > 0}
      />

      {loading > 0 && (
        <p className="text-muted text-sm" role="status">
          Reading {loading} photo{loading === 1 ? "" : "s"}…
        </p>
      )}
      {rejections.length > 0 && (
        <ErrorNote
          message={rejections.map((r) => `${r.name}: ${r.reason}`).join(" ")}
        />
      )}

      {items.length > 0 && (
        <RunnerSection
          title="Pages"
          aside={
            <span className="text-muted text-xs">
              {items.length} page{items.length === 1 ? "" : "s"}
            </span>
          }
        >
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <ScanTile
                key={item.id}
                item={item}
                index={index}
                count={items.length}
                enhancement={enhancement}
                busy={busy}
                onTurn={() => turn(item.id)}
                onUp={() => move(index, index - 1)}
                onDown={() => move(index, index + 1)}
                onRemove={() => remove(item.id)}
              />
            ))}
          </ol>
        </RunnerSection>
      )}

      {items.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          <RunnerSection title="Clean-up">
            <div className="flex flex-wrap gap-2">
              {SCAN_ENHANCEMENTS.map((e) => (
                <ChipButton
                  key={e.id}
                  onClick={() => setEnhancement(e.id)}
                  disabled={busy}
                  active={e.id === enhancement}
                  title={e.hint}
                >
                  {e.label}
                </ChipButton>
              ))}
            </div>
            <p className="text-muted text-xs">
              {SCAN_ENHANCEMENTS.find((e) => e.id === enhancement)!.hint}
            </p>
          </RunnerSection>
          <RunnerSection title="Page size">
            <div className="flex flex-wrap gap-2">
              {SCAN_PAGE_SIZES.map((size) => (
                <ChipButton
                  key={size.id}
                  onClick={() => setPageSize(size.id)}
                  disabled={busy}
                  active={size.id === pageSize}
                >
                  {size.label}
                </ChipButton>
              ))}
            </div>
            <p className="text-muted text-xs">
              Each photo fills its page; pages turn landscape for a wide photo.
            </p>
          </RunnerSection>
        </div>
      )}

      <PrivacyLine>
        Photos are made into a PDF on your device — nothing is uploaded.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}
      {progress && (
        <p className="text-muted text-sm" role="status">
          {progress}
        </p>
      )}

      <RunBar>
        <div className="flex justify-end gap-3">
          {items.length > 0 && (
            <button
              type="button"
              onClick={clearItems}
              className={buttonVariants({ variant: "secondary", size: "lg" })}
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
            {SCAN_RUN_LABEL}
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

/**
 * The camera: a file input with `capture="environment"`, which on a phone
 * opens the rear camera straight away (no permission prompt, no
 * getUserMedia) and on a desktop opens the ordinary file picker. One photo
 * per opening on most phones — so it stays on screen as "add the next page".
 */
function CameraButton({
  onFiles,
  disabled,
  again,
}: {
  onFiles: (files: File[]) => void;
  disabled: boolean;
  again: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        aria-disabled={disabled || undefined}
        className={cn(
          buttonVariants({
            variant: again ? "secondary" : "primary",
            size: "lg",
          }),
          "w-full sm:w-auto sm:self-start",
        )}
      >
        <Camera className="size-4" aria-hidden />
        {again ? `${SCAN_CAMERA_LABEL} of the next page` : SCAN_CAMERA_LABEL}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-scan-camera=""
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <p className="text-muted text-xs">
        On a phone this opens the camera. Lay the page flat in good light and
        fill the frame with it — the photo is used as framed.
      </p>
    </div>
  );
}

function ScanTile({
  item,
  index,
  count,
  enhancement,
  busy,
  onTurn,
  onUp,
  onDown,
  onRemove,
}: {
  item: ScanItem;
  index: number;
  count: number;
  enhancement: ScanEnhancement;
  busy: boolean;
  onTurn: () => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!item.thumbnail) return;
    // A frame later, so a pick of many photos draws its list first.
    const handle = requestAnimationFrame(() => {
      try {
        setPreview(pagePreview(item.thumbnail!, item.turns, enhancement));
      } catch {
        setPreview(null);
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [item.thumbnail, item.turns, enhancement]);

  const label = `Page ${index + 1}`;
  return (
    <li
      data-scan-page={index + 1}
      className="border-line bg-wash rounded-panel flex min-w-0 items-center gap-3 border p-2"
    >
      <div className="bg-canvas rounded-tag grid h-16 w-16 shrink-0 place-items-center overflow-hidden">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`${label} preview`}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <FileImage className="text-muted size-5" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-fg truncate text-sm font-medium">
          {label}
          <span className="text-muted font-normal">
            {" "}
            · {formatBytes(item.size)}
          </span>
        </p>
        <p className="text-muted truncate text-xs" title={item.name}>
          {item.name}
        </p>
        <div className="flex flex-wrap gap-1">
          <TileButton
            label={`Rotate ${label.toLowerCase()}`}
            onClick={onTurn}
            disabled={busy}
          >
            <RotateCw className="size-4" aria-hidden />
          </TileButton>
          <TileButton
            label={`Move ${label.toLowerCase()} up`}
            onClick={onUp}
            disabled={busy || index === 0}
          >
            <ArrowUp className="size-4" aria-hidden />
          </TileButton>
          <TileButton
            label={`Move ${label.toLowerCase()} down`}
            onClick={onDown}
            disabled={busy || index === count - 1}
          >
            <ArrowDown className="size-4" aria-hidden />
          </TileButton>
          <TileButton
            label={`Remove ${label.toLowerCase()}`}
            onClick={onRemove}
            disabled={busy}
          >
            <X className="size-4" aria-hidden />
          </TileButton>
        </div>
      </div>
    </li>
  );
}

function TileButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onClick();
      }}
      aria-disabled={disabled || undefined}
      aria-label={label}
      title={label}
      className="border-line bg-canvas text-muted hover:text-fg rounded-ctl inline-grid h-11 w-11 place-items-center border transition aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
    >
      {children}
    </button>
  );
}
