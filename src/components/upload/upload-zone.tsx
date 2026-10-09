"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { FileText, UploadCloud, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import { acceptAttribute, acceptHint } from "./accepted-kinds";
import { useEarlyFilePick } from "./use-early-file-pick";

type StagedFile = { id: string; name: string; size: number; file: File };

/** Loaded when the first file is staged, never on page load. */
const StagedFileActions = lazy(() => import("./staged-file-actions"));

/**
 * Client-side file staging zone. Files are held in browser memory only — nothing
 * is uploaded here. The staged `File`s themselves are kept (not just their
 * names), and once a file is staged the zone offers the tools that fit it; a
 * tool that can receive a hand-off opens with the files already loaded (see
 * `staged-file-actions.tsx`). This keeps the privacy promise literal.
 *
 * `ctaHref` is the older shape, a plain link, kept for the tool page's
 * overview panel (no tool reaches that branch today). Without it, the zone
 * offers tools itself.
 *
 * With an `id`, the zone is a link target: `href="#<id>"` scrolls to it and a
 * `hashchange` to that id focuses the file input, so "Start for free" lands a
 * keyboard user on the control that starts.
 */
export function UploadZone({
  accept = acceptAttribute(),
  multiple = true,
  ctaLabel,
  ctaHref,
  hint = acceptHint(),
  id,
  className,
}: {
  accept?: string;
  multiple?: boolean;
  ctaLabel?: string;
  ctaHref?: string;
  hint?: string;
  id?: string;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const stagedFiles = useMemo(
    () => files.map((staged) => staged.file),
    [files],
  );

  const addFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const next = Array.from(list).map((file, i) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${i}`,
        name: file.name,
        size: file.size,
        file,
      }));
      setFiles((prev) => (multiple ? [...prev, ...next] : next.slice(0, 1)));
    },
    [multiple],
  );

  useEffect(() => {
    if (!id) return;
    const focusIfTargeted = () => {
      if (window.location.hash === `#${id}`) {
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("hashchange", focusIfTargeted);
    return () => window.removeEventListener("hashchange", focusIfTargeted);
  }, [id]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  useEarlyFilePick(inputRef, addFiles);

  return (
    <div id={id} className={cn("flex scroll-mt-24 flex-col gap-4", className)}>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[4px] border border-dashed px-6 py-12 text-center transition-colors duration-150",
          // The file input is visually hidden but focusable; surface its
          // keyboard focus on the dropzone so it isn't an invisible tab stop.
          "has-[:focus-visible]:border-accent has-[:focus-visible]:ring-accent/40 has-[:focus-visible]:ring-2",
          dragging
            ? "border-accent bg-accent/5"
            : "border-line-strong bg-canvas hover:border-fg/40",
        )}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          onChange={(e) => addFiles(e.target.files)}
        />
        <UploadCloud
          className="text-muted size-6"
          strokeWidth={1.5}
          aria-hidden
        />
        <span className="flex flex-col gap-1">
          <span className="text-fg text-[15px] font-medium">
            Drop files here, or{" "}
            <span className="text-accent underline underline-offset-4">
              browse
            </span>
          </span>
          <span className="text-muted text-[13px]">{hint}</span>
        </span>
      </label>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Selected files">
          {files.map((file) => (
            <li
              key={file.id}
              className="border-line bg-panel flex items-center gap-3 rounded-[3px] border px-3 py-2"
            >
              <FileText
                className="text-muted size-4 shrink-0"
                strokeWidth={1.5}
                aria-hidden
              />
              <span className="text-fg min-w-0 flex-1 truncate text-sm">
                {file.name}
              </span>
              <span className="text-muted shrink-0 font-mono text-xs tabular-nums">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(file.id)}
                aria-label={`Remove ${file.name}`}
                className="text-muted hover:bg-wash hover:text-fg grid size-6 shrink-0 place-items-center rounded-[2px] transition-colors"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && !ctaHref && (
        <Suspense fallback={null}>
          <StagedFileActions files={stagedFiles} />
        </Suspense>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted inline-flex items-center gap-2 text-xs">
          <span className="bg-ok size-1.5 shrink-0 rounded-full" aria-hidden />
          Files stay on your device until you pick a tool.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Add files
          </button>
          {ctaHref && (
            <Link
              href={ctaHref}
              className={buttonVariants({ variant: "primary", size: "sm" })}
            >
              {ctaLabel ?? "Continue"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
