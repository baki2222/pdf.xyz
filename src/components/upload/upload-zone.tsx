"use client";

import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { FileText, ShieldCheck, UploadCloud, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";

type StagedFile = { id: string; name: string; size: number };

/**
 * Client-side file staging zone. Files are held in browser memory only — nothing
 * is uploaded here. The user then continues to a tool/workspace to process them.
 * This keeps the privacy promise literal, even in the demo flow.
 */
export function UploadZone({
  accept = "application/pdf",
  multiple = true,
  ctaLabel = "Open in workspace",
  ctaHref = "/workspace",
  hint = "PDF, images, Word, and more · Max 100 MB per file",
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
          "group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors duration-200",
          // The file input is visually hidden but focusable; surface its
          // keyboard focus on the dropzone so it isn't an invisible tab stop.
          "has-[:focus-visible]:border-violet-400/70 has-[:focus-visible]:bg-violet-500/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet-400/50",
          dragging
            ? "border-violet-400/70 bg-violet-500/10"
            : "border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]",
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
        <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-500 text-white shadow-lg shadow-violet-500/30 transition-transform duration-200 group-hover:scale-105">
          <UploadCloud className="size-7" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-base font-semibold text-white">
            Drop files here, or{" "}
            <span className="text-violet-300 underline underline-offset-4">
              browse
            </span>
          </span>
          <span className="text-sm text-slate-400">{hint}</span>
        </span>
      </label>

      {files.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Selected files">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-surface-2 px-3.5 py-2.5"
            >
              <FileText className="size-4 shrink-0 text-violet-300" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                {file.name}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(file.id)}
                aria-label={`Remove ${file.name}`}
                className="grid size-6 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-white"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="size-3.5 text-emerald-400" aria-hidden />
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
