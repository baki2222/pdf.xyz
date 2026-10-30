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
        title: "Nothing to run yet",
        body: "Pick a tool, then add the files you chose above.",
      };
    case "needs-tool":
      return {
        tone: "muted",
        title: "Choose a tool",
        body: "Pick the tool you want to use on these files.",
      };
    case "needs-files":
      return {
        tone: "muted",
        title: "Add files",
        body: "Add the files you chose above, and they open in this tool together.",
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
        title: "Runs on a secure server",
        // Says what is TRUE from here (this tool uploads; the batch path is
        // browser-only) instead of asserting the worker is off, which this
        // component cannot observe — see the optgroup comment below.
        body: `${name} runs on a secure server, so your file is uploaded rather than processed on your device. Open the tool to see exactly what happens to your files first.`,
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
  launchFailedSlug = null,
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
  /** A launch whose files could not be stored: said here, with a plain way on. */
  launchFailedSlug?: string | null;
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
      className="bg-panel border-line rounded-panel flex flex-col gap-4 border p-5"
    >
      <div className="flex items-center gap-2.5">
        <span className="border-line bg-wash text-fg rounded-panel grid size-8 place-items-center border">
          <Layers className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="batch-heading" className="text-fg text-sm font-semibold">
            Use one tool on several files
          </h2>
          <p className="text-muted text-xs">
            Choose a tool, add your files, and open them in it all at once.
          </p>
        </div>
      </div>

      {/* Step 1 — choose a tool */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={selectId} className="text-fg text-xs font-medium">
          1. Choose a tool
        </label>
        {/* The background was `bg-surface-1` — a token that never existed, so
            the class emitted no CSS and this select had been transparent since
            it shipped. Found when the legacy `--color-surface*` tokens were
            deleted and the reference sweep looked for survivors. */}
        <select
          id={selectId}
          value={batch.toolSlug ?? ""}
          onChange={(e) => onSetTool(e.target.value || null)}
          className="bg-panel border-line text-fg focus-visible:border-accent/40 focus-visible:ring-accent/50 rounded-ctl w-full border px-3 py-2 text-sm outline-none focus-visible:ring-2"
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
            "Secure server" states WHERE the tool runs — a catalogue fact this
            component has. It deliberately no longer says "not enabled here":
            the predicate behind this list (`!s.live && s.uploadsFiles`) is two
            static catalogue lookups and never observes the environment, while
            our server IS enabled on this deployment. Twenty tools were labelled
            "not enabled" at the exact moment a user picks one — and picking one
            uploads their file, so a reader could reasonably conclude nothing
            would leave their machine. A label may not claim an environment
            state its predicate cannot see; the enablement question belongs to
            the live server status this component does not fetch.
          */}
          <optgroup label="Secure server · your file is uploaded">
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
          <span className="text-fg text-xs font-medium">
            2. Add files{" "}
            <span className="text-muted font-normal tabular-nums">
              ({queued} of {files.length})
            </span>
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
              Add all chosen files
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
                  className="border-line bg-wash text-muted rounded-tag inline-flex max-w-full items-center gap-1.5 border py-1 pr-1 pl-2.5 text-xs"
                >
                  <span className="max-w-[10rem] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(id)}
                    aria-label={`Remove ${file.name} from batch`}
                    className="text-muted hover:bg-wash hover:text-fg rounded-ctl grid size-5 shrink-0 place-items-center transition"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted text-xs">
            {files.length === 0
              ? "Choose files above first, then add them here."
              : "No files queued yet."}
          </p>
        )}
      </div>

      {/* Step 3 — honest launch / worker path */}
      <div
        className={cn(
          "rounded-ctl flex flex-col gap-3 border p-3.5",
          content.tone === "ready"
            ? "border-ok/40 bg-ok/10"
            : content.tone === "worker"
              ? "border-info/40 bg-info/10"
              : content.tone === "muted" && "border-line bg-wash",
        )}
      >
        <div className="flex flex-col gap-1" role="status" aria-live="polite">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-semibold",
              content.tone === "ready"
                ? "text-ok"
                : content.tone === "worker"
                  ? "text-info"
                  : content.tone === "muted" && "text-muted",
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
          <p className="text-muted text-xs leading-relaxed">{content.body}</p>
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

        {tool && launchFailedSlug === tool.slug && (
          <p role="alert" className="text-warn text-xs leading-relaxed">
            Couldn&apos;t carry your files to {tool.name} in this browser.{" "}
            <Link
              href={`/tools/${tool.slug}`}
              className="text-fg underline underline-offset-4"
            >
              Open {tool.name}
            </Link>{" "}
            and add them there.
          </p>
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
