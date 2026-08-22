"use client";

import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { FileText, UploadCloud, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import { acceptAttribute, acceptHint } from "./accepted-kinds";
import { useEarlyFilePick } from "./use-early-file-pick";

type StagedFile = { id: string; name: string; size: number };

/**
 * Client-side file staging zone. Files are held in browser memory only — nothing
 * is uploaded here. The user then continues to a tool/workspace to process them.
 * This keeps the privacy promise literal, even in the demo flow.
 */
export function UploadZone({
  accept = acceptAttribute(),
  multiple = true,
  ctaLabel = "Open in workspace",
  ctaHref = "/workspace",
  hint = acceptHint(),
  className,
}: {
  accept?: string;
  multiple?: boolean;
  ctaLabel?: string;
  ctaHref?: string;
  hint?: string;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const next = Array.from(list).map((file, i) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${i}`,
        name: file.name,
        size: file.size,
      }));
      setFiles((prev) => (multiple ? [...prev, ...next] : next.slice(0, 1)));
    },
    [multiple],
  );

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
    <div className={cn("flex flex-col gap-4", className)}>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted inline-flex items-center gap-2 text-xs">
          <span
            className="size-1.5 shrink-0 rounded-full bg-emerald-600"
            aria-hidden
          />
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
          <Link
            href={ctaHref}
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
