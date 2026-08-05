"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Clock,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Layers,
  Presentation,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useEarlyFilePick } from "@/components/upload/use-early-file-pick";
import { cn, formatBytes } from "@/lib/utils";
import { FILE_FAMILIES, type FileFamily, type WorkspaceAction } from "@/lib/workspace";
import { BatchPanel } from "./batch-panel";
import type { WorkspaceToolSummary } from "./summary";
import { SuggestedTools } from "./suggested-tools";
import { useWorkspace } from "./use-workspace";

const FAMILY_LABEL: Record<FileFamily, string> = {
  pdf: "PDF",
  image: "Images",
  word: "Word",
  excel: "Sheets",
  powerpoint: "Slides",
  text: "Text",
  other: "Other",
};

/** Family-appropriate card glyph, so a staged set reads at a glance. */
const FAMILY_ICON: Record<FileFamily, typeof FileText> = {
  pdf: FileText,
  image: FileImage,
  word: FileText,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  text: FileText,
  other: File,
};

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv";

/** Compact relative time for the activity log (client-only, post-hydration). */
function formatRelative(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function activityIcon(kind: WorkspaceAction["kind"]) {
  if (kind === "queued-batch") return Layers;
  if (kind === "cleared-files") return Trash2;
  return FolderOpen;
}

/**
 * The interactive local workspace command center. Files are staged as metadata
 * in browser memory (bytes are never held or uploaded); a guarded localStorage
 * bridge remembers only tool choices + a name-free activity log. Everything else
 * — summaries, suggestions, batch queue — is derived from that in-memory state.
 */
export function WorkspaceClient({
  tools,
  popular,
  preselected,
}: {
  tools: WorkspaceToolSummary[];
  popular: WorkspaceToolSummary[];
  preselected?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const ws = useWorkspace(tools, preselected);
  const { state, rejected } = ws;

  useEarlyFilePick(inputRef, ws.addFiles);

  const totalBytes = useMemo(
    () => state.files.reduce((sum, f) => sum + f.size, 0),
    [state.files],
  );
  const familyChips = useMemo(
    () =>
      FILE_FAMILIES.map((family) => ({
        family,
        count: state.files.filter((f) => f.family === family).length,
      })).filter((entry) => entry.count > 0),
    [state.files],
  );

  const hasFiles = state.files.length > 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-start">
      {/* ── Staging + batch column ── */}
      <div className="flex flex-col gap-6">
        <div className="gradient-border">
          <div className="glass flex flex-col gap-5 rounded-3xl p-5 sm:p-7">
            {/* Dropzone */}
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
                ws.addFiles(e.dataTransfer.files);
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
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => {
                  ws.addFiles(e.target.files);
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
                  PDF, images, Word, Excel, PowerPoint, text · Max 100 MB per file
                </span>
              </span>
            </label>

            {/* Error state — files we declined to stage */}
            {rejected.length > 0 && (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-200">
                    <AlertTriangle className="size-4" aria-hidden />
                    {rejected.length} file{rejected.length === 1 ? "" : "s"} couldn&apos;t
                    be staged
                  </span>
                  <button
                    type="button"
                    onClick={ws.dismissRejected}
                    className="grid size-6 place-items-center rounded-md text-amber-300/70 transition hover:bg-white/10 hover:text-white"
                    aria-label="Dismiss"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>
                <ul className="flex flex-col gap-1 text-xs text-amber-100/80">
                  {rejected.map((r, i) => (
                    <li key={`${r.name}-${i}`}>
                      <span className="font-medium text-amber-100">{r.name}</span> — {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Staged files or the empty state */}
            {hasFiles ? (
              <ul className="flex flex-col gap-2" aria-label="Staged files">
                {state.files.map((file) => {
                  const Icon = FAMILY_ICON[file.family];
                  return (
                    <li
                      key={file.id}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-surface-2 px-3 py-2.5"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/5 text-violet-300">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm text-slate-200">{file.name}</span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
                          <span className="rounded border border-white/10 bg-white/5 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {file.kind}
                          </span>
                          <span className="truncate tabular-nums">
                            {formatBytes(file.size)}
                            {typeof file.pageCount === "number"
                              ? ` · ${file.pageCount} ${file.pageCount === 1 ? "page" : "pages"}`
                              : ""}
                          </span>
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => ws.removeFile(file.id)}
                        aria-label={`Remove ${file.name}`}
                        className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-8 text-center">
                <p className="text-sm font-medium text-slate-300">No files staged yet</p>
                <p className="max-w-sm text-xs text-slate-400">
                  Drop documents above to see file-aware tool suggestions and build a
                  batch. Nothing is uploaded.
                </p>
              </div>
            )}

            {/* Summary + actions */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                  <ShieldCheck className="size-3.5 text-emerald-400" aria-hidden />
                  {hasFiles ? (
                    <span>
                      {state.files.length} file{state.files.length === 1 ? "" : "s"} ·{" "}
                      {formatBytes(totalBytes)} — staged in this browser only.
                    </span>
                  ) : (
                    <span>Files stay in this browser. Nothing is uploaded.</span>
                  )}
                </p>
                {familyChips.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="File types staged">
                    {familyChips.map(({ family, count }) => (
                      <li
                        key={family}
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-slate-300"
                      >
                        {FAMILY_LABEL[family]} · {count}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {hasFiles && (
                  <button
                    type="button"
                    onClick={ws.clearFiles}
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

        <BatchPanel
          files={state.files}
          summaries={tools}
          batch={state.batch}
          plan={ws.batchPlan}
          onSetTool={ws.setBatchTool}
          onAddAll={ws.addAllToBatch}
          onRemove={ws.removeFromBatch}
          onClear={ws.clearBatch}
          onLaunch={ws.launchHandoff}
          launchingSlug={ws.launchingSlug}
        />
      </div>

      {/* ── Tools + activity column ── */}
      <aside className="flex flex-col gap-6">
        <SuggestedTools
          suggestions={ws.suggestions}
          summaries={tools}
          popular={popular}
          hasFiles={hasFiles}
          preselected={preselected}
          onOpen={ws.openTool}
        />

        <RecentActivity
          actions={state.recentActions}
          hydrated={ws.hydrated}
          now={ws.now}
          onClearSession={ws.clearSession}
        />

        <p className="flex items-start gap-2 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4 text-xs leading-relaxed text-slate-400">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
          <span>
            Browser tools never upload — your files stay in this tab and clear when
            you close it. Only your tool choices are remembered on this device;
            file names and contents never are.
          </span>
        </p>
      </aside>
    </div>
  );
}

/** The recent-activity log, with a loading skeleton until preferences hydrate. */
function RecentActivity({
  actions,
  hydrated,
  now,
  onClearSession,
}: {
  actions: WorkspaceAction[];
  hydrated: boolean;
  now: number;
  onClearSession: () => void;
}) {
  const canClear = hydrated && actions.length > 0;
  return (
    <section
      aria-labelledby="activity-heading"
      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-2 p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="activity-heading"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white"
        >
          <Clock className="size-4 text-slate-400" aria-hidden />
          Recent activity
        </h2>
        {canClear && (
          <button
            type="button"
            onClick={onClearSession}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
            title="Clear staged files, remembered tools, activity, and any pending hand-off — all on this device"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Clear session
          </button>
        )}
      </div>

      {!hydrated ? (
        <ul className="flex flex-col gap-2" aria-hidden>
          {[0, 1].map((i) => (
            <li key={i} className="h-9 animate-pulse rounded-lg bg-white/[0.04]" />
          ))}
        </ul>
      ) : actions.length === 0 ? (
        <p className="text-xs text-slate-400">
          Tools you open from here show up as your recent activity.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {actions.map((action) => {
            const Icon = activityIcon(action.kind);
            return (
              <li
                key={action.id}
                className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5"
              >
                <Icon className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                  {action.label}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                  {formatRelative(action.at, now)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
