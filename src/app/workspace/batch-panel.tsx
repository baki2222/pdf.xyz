"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Cpu,
  Layers,
  Loader2,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BatchPlan, WorkspaceFile } from "@/lib/workspace";
import { indexSummaries, type WorkspaceToolSummary } from "./summary";

/** Honest, per-status copy for the launch area. `tone` maps to accent colors. */
function statusContent(
  plan: BatchPlan,
  tool: WorkspaceToolSummary | undefined,
): { tone: "ready" | "muted" | "worker"; title: string; body: string } {
  const n = plan.fileIds.length;
  const files = `${n} file${n === 1 ? "" : "s"}`;
  const name = tool?.name ?? "This tool";
  switch (plan.status) {
    case "empty":
      return {
        tone: "muted",
        title: "Build a batch",
        body: "Choose a tool and add your staged files to line them up.",
      };
    case "needs-tool":
      return {
        tone: "muted",
        title: "Choose a tool",
        body: "Pick the tool you want to run across these files.",
      };
    case "needs-files":
      return {
        tone: "muted",
        title: "Add files",
        body: "Add staged files to the queue to run them through this tool.",
      };
    case "ready": {
      const verb =
        tool?.handoffMode === "collect"
          ? `combines these ${files}`
          : `runs on each of these ${files}`;
      return {
        tone: "ready",
        title: `Ready — ${files}`,
        body: `${name} ${verb} right here in your browser. They load straight in — nothing is uploaded.`,
      };
    }
    case "single":
      return {
        tone: "ready",
        title: "Ready — opens your first file",
        body: `${name} works on one PDF at a time. It opens with your first queued file already loaded — nothing is uploaded.`,
      };
    case "worker-disabled":
      return {
        tone: "worker",
        title: "Runs on a secure worker",
        // Says what is TRUE from here (this tool uploads; the batch path is
        // browser-only) instead of asserting the worker is off, which this
        // component cannot observe — see the optgroup comment below.
        body: `${name} runs on an encrypted worker, so your file is uploaded rather than processed on your device. Open the tool to see exactly what happens to your files first.`,
      };
    default:
      return {
        tone: "worker",
        title: "Not batch-ready yet",
        body: `${name} doesn't have an in-browser batch runner yet. Open its page to see the plan.`,
      };
  }
}

/**
 * Batch workflow foundation: choose a tool, queue staged files, and launch. For a
 * live tool this performs a **real, browser-local hand-off** — the files are
 * stashed in this browser's own storage and pre-loaded into the tool, never
 * uploaded. Worker tools land on their honest secure-worker preview instead.
 */
export function BatchPanel({
  files,
  summaries,
  batch,
  plan,
  onSetTool,
  onAddAll,
  onRemove,
  onClear,
  onLaunch,
  launchingSlug,
}: {
  files: WorkspaceFile[];
  summaries: WorkspaceToolSummary[];
  batch: { toolSlug: string | null; fileIds: string[] };
  plan: BatchPlan;
  onSetTool: (slug: string | null) => void;
  onAddAll: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onLaunch: (tool: WorkspaceToolSummary, ids: string[]) => void;
  launchingSlug: string | null;
}) {
  const selectId = useId();
  const bySlug = useMemo(() => indexSummaries(summaries), [summaries]);
  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);

  // `live` means "has an in-browser runner", which is NOT the same question as
  // "runs entirely in your browser" — that mismatch is what put an uploading
  // tool under a never-leaves-your-device promise on /status. It is currently
  // true here only because the batch path really is browser-local (the hybrid
  // compress runner is lossless-in-browser only). A future non-client tool that
  // gains a runner lands in this group silently.
  const liveTools = useMemo(() => summaries.filter((s) => s.live), [summaries]);
  const workerTools = useMemo(
    () => summaries.filter((s) => !s.live && s.uploadsFiles),
    [summaries],
  );

  const tool = batch.toolSlug ? bySlug.get(batch.toolSlug) : undefined;
  const queued = batch.fileIds.length;
  const allQueued = files.length > 0 && queued === files.length;
  const content = statusContent(plan, tool);

  const canHandoff =
    !!tool && (plan.status === "ready" || plan.status === "single");
  const isWorkerish =
    !!tool &&
    (plan.status === "worker-disabled" || plan.status === "unavailable");
  const launching = !!tool && launchingSlug === tool.slug;

  return (
    <section
      aria-labelledby="batch-heading"
      className="bg-surface-2 flex flex-col gap-4 rounded-2xl border border-white/10 p-5"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 text-white">
          <Layers className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="batch-heading" className="text-sm font-semibold text-white">
            Batch queue
          </h2>
          <p className="text-xs text-slate-400">
            Line up files, choose one tool, hand them straight over.
          </p>
        </div>
      </div>

      {/* Step 1 — choose a tool */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={selectId}
          className="text-xs font-medium tracking-wide text-slate-400 uppercase"
        >
          Tool
        </label>
        <select
          id={selectId}
          value={batch.toolSlug ?? ""}
          onChange={(e) => onSetTool(e.target.value || null)}
          className="bg-surface-1 w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus-visible:border-violet-400/60 focus-visible:ring-2 focus-visible:ring-violet-400/40"
        >
          <option value="">Choose a tool…</option>
          <optgroup label="Runs in your browser">
            {liveTools.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </optgroup>
          {/*
            "Secure worker" states WHERE the tool runs — a catalogue fact this
            component has. It deliberately no longer says "not enabled here":
            the predicate behind this list (`!s.live && s.uploadsFiles`) is two
            static catalogue lookups and never observes the environment, while
            the worker IS enabled on this deployment. Twenty tools were labelled
            "not enabled" at the exact moment a user picks one — and picking one
            uploads their file, so a reader could reasonably conclude nothing
            would leave their machine. A label may not claim an environment
            state its predicate cannot see; the enablement question belongs to
            the live worker status this component does not fetch.
          */}
          <optgroup label="Secure worker · your file is uploaded">
            {workerTools.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Step 2 — queue files */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
            Files ({queued}/{files.length})
          </span>
          <div className="flex items-center gap-1.5">
            {queued > 0 && (
              <button
                type="button"
                onClick={onClear}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              // aria-disabled, never native: this flips to disabled the moment the
              // user queues the last staged file — their own action, and a native
              // attribute would eject their focus (the #46 rule; add-to-batch is a
              // dedupe-safe dispatch, so a guarded click is belt and braces).
              onClick={() => {
                if (files.length > 0 && !allQueued) onAddAll();
              }}
              aria-disabled={files.length === 0 || allQueued || undefined}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Plus className="size-3.5" aria-hidden />
              Add all staged
            </button>
          </div>
        </div>

        {queued > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Batch queue">
            {batch.fileIds.map((id) => {
              const file = fileById.get(id);
              if (!file) return null;
              return (
                <li
                  key={id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] py-1 pr-1 pl-2.5 text-xs text-slate-300"
                >
                  <span className="max-w-[10rem] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(id)}
                    aria-label={`Remove ${file.name} from batch`}
                    className="grid size-5 shrink-0 place-items-center rounded text-slate-400 transition hover:bg-white/10 hover:text-white"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">
            {files.length === 0
              ? "Stage files above, then add them here."
              : "No files queued yet."}
          </p>
        )}
      </div>

      {/* Step 3 — honest launch / worker path */}
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border p-3.5",
          content.tone === "ready" &&
            "border-emerald-400/25 bg-emerald-400/[0.06]",
          content.tone === "worker" && "border-blue-400/25 bg-blue-400/[0.06]",
          content.tone === "muted" && "border-white/10 bg-white/[0.02]",
        )}
      >
        <div className="flex flex-col gap-1" role="status" aria-live="polite">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-semibold",
              content.tone === "ready" && "text-emerald-200",
              content.tone === "worker" && "text-blue-200",
              content.tone === "muted" && "text-slate-300",
            )}
          >
            {content.tone === "ready" && (
              <ShieldCheck className="size-4" aria-hidden />
            )}
            {content.tone === "worker" && (
              <Cpu className="size-4" aria-hidden />
            )}
            {content.title}
          </span>
          <p className="text-xs leading-relaxed text-slate-400">
            {content.body}
          </p>
        </div>

        {canHandoff && tool && (
          <button
            type="button"
            // `aria-disabled`, not `disabled`, so the hand-off does not blur the
            // user out of the button they just pressed. See `RunButton`.
            onClick={() => {
              if (launching) return;
              onLaunch(tool, batch.fileIds);
            }}
            aria-disabled={launching || undefined}
            aria-busy={launching}
            className={buttonVariants({
              variant: "primary",
              size: "sm",
              className: "self-start",
            })}
          >
            {launching ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading {tool.name}…
              </>
            ) : (
              <>
                {plan.status === "single"
                  ? `Open ${tool.name}`
                  : `Open ${tool.name} with ${plan.fileIds.length} file${plan.fileIds.length === 1 ? "" : "s"}`}
                <ArrowRight className="size-4" aria-hidden />
              </>
            )}
          </button>
        )}

        {isWorkerish && tool && (
          <Link
            href={`/tools/${tool.slug}`}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "self-start",
            })}
          >
            See how it works
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
    </section>
  );
}
