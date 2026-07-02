"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  FileText,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import type { IconName } from "@/lib/icons";
import type { ToolBadge } from "@/lib/tools/types";
import { ToolIcon } from "@/components/ui/tool-icon";
import { ToolBadgePill } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";

/** Lightweight, server-computed summary of a live tool the workspace can open. */
export type WorkspaceTool = {
  slug: string;
  name: string;
  tagline: string;
  icon: IconName;
  gradient?: string;
  badge?: ToolBadge;
};

/** A document staged in this browser session — never leaves the tab. */
type StagedFile = { id: string; name: string; size: number; kind: string };

/** Derive a short, honest type label from the file name or MIME type. */
function fileKind(file: File): string {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : undefined;
  if (ext && ext.length > 0 && ext.length <= 5) return ext.toUpperCase();
  const sub = file.type ? file.type.split("/").pop() : undefined;
  return sub ? sub.toUpperCase() : "File";
}

/**
 * The interactive workspace shell. Files are staged purely in React state — they
 * never touch the network. Picking a tool routes to that tool's page; because we
 * don't yet hand files across routes, we say so plainly rather than fake it.
 */
export function WorkspaceClient({
  tools,
  preselected,
}: {
  tools: WorkspaceTool[];
  preselected?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list).map((file, i) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${i}`,
      name: file.name,
      size: file.size,
      kind: fileKind(file),
    }));
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.id));
      return [...prev, ...incoming.filter((f) => !seen.has(f.id))];
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAll = useCallback(() => setFiles([]), []);

  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + f.size, 0),
    [files],
  );

  // Surface the tool the user arrived with (from an "open in workspace" CTA)
  // first, so the suggested next step is obvious.
  const orderedTools = useMemo(() => {
    if (!preselected) return tools;
    const idx = tools.findIndex((t) => t.slug === preselected);
    const chosen = idx < 0 ? undefined : tools[idx];
    return chosen
      ? [chosen, ...tools.slice(0, idx), ...tools.slice(idx + 1)]
      : tools;
  }, [tools, preselected]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-start">
      {/* ── Staging column ── */}
      <div className="gradient-border">
        <div className="glass flex flex-col gap-5 rounded-3xl p-5 sm:p-7">
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors duration-200",
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
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
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
              <span className="text-sm text-slate-400">
                PDF, images, Word, Excel, PowerPoint · Max 100 MB per file
              </span>
            </span>
          </label>

          {files.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Staged files">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-surface-2 px-3.5 py-2.5"
                >
                  <FileText
                    className="size-4 shrink-0 text-violet-300"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                    {file.name}
                  </span>
                  <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {file.kind}
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
              {files.length > 0 ? (
                <span>
                  {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
                  {formatBytes(totalBytes)} — staged in this browser only.
                </span>
              ) : (
                <span>Files stay in this browser. Nothing is uploaded.</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {files.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Add files
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tool chooser column ── */}
      <aside className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-surface-2 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
            Run a tool
          </h2>
          <Link
            href="/tools"
            className="text-xs font-medium text-violet-300 transition hover:text-violet-200"
          >
            All tools
          </Link>
        </div>

        <ul className="flex flex-col gap-2">
          {orderedTools.map((tool) => {
            const suggested = tool.slug === preselected;
            return (
              <li key={tool.slug}>
                <Link
                  href={`/tools/${tool.slug}`}
                  aria-current={suggested ? "true" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border px-2.5 py-2 transition",
                    suggested
                      ? "border-violet-400/40 bg-violet-500/10"
                      : "border-transparent hover:border-white/10 hover:bg-white/[0.04]",
                  )}
                >
                  <ToolIcon icon={tool.icon} gradient={tool.gradient} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-white">
                        {tool.name}
                      </span>
                      {suggested ? (
                        <span className="rounded-full border border-violet-400/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                          Suggested
                        </span>
                      ) : (
                        tool.badge && <ToolBadgePill badge={tool.badge} />
                      )}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {tool.tagline}
                    </span>
                  </span>
                  <ArrowRight
                    className="size-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-white"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-xs leading-relaxed text-slate-400">
          Each tool opens on its own page and runs in your browser. Staged files
          don&apos;t follow you across pages yet, so you&apos;ll re-select them
          on the tool page for now.
        </p>
      </aside>
    </div>
  );
}
