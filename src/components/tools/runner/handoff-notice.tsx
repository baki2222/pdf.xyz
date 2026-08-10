"use client";

import { AlertTriangle, FolderInput, ShieldCheck } from "lucide-react";
import { Spinner } from "./runner-kit";
import type { ToolHandoff } from "./use-tool-handoff";

/**
 * Honest, accessible states for a workspace → tool handoff, shared by every
 * handoff-aware runner:
 *  - `loading`      → a small "bringing your files over" block.
 *  - `expired`      → the token was missing/expired/already used.
 *  - `incompatible` → files came over but none fit this tool.
 *  - `ready`        → a subtle "loaded from your workspace" confirmation, kept
 *                     privacy-forward ("still in this browser, nothing uploaded").
 *
 * All copy reinforces that files never left the device.
 */

export function HandoffLoading() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-12 text-sm text-slate-400"
    >
      <Spinner />
      Bringing your files over from the workspace…
    </div>
  );
}

/** Amber, dismissible banner for expired/incompatible handoffs. */
export function HandoffProblem({
  handoff,
  toolName,
}: {
  handoff: ToolHandoff;
  toolName: string;
}) {
  if (handoff.status !== "expired" && handoff.status !== "incompatible")
    return null;

  const body =
    handoff.status === "expired"
      ? "That workspace hand-off expired or was already used. Pick your files below to continue — nothing was uploaded."
      : `${handoff.skipped === 1 ? "That file" : "Those files"} came over from your workspace, but ${
          handoff.skipped === 1 ? "it isn't a PDF" : "none are PDFs"
        }, so ${toolName} can't use ${handoff.skipped === 1 ? "it" : "them"}. Choose a PDF below.`;

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{body}</span>
      <button
        type="button"
        onClick={handoff.dismiss}
        className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs text-amber-200/80 transition hover:bg-amber-500/15 hover:text-amber-100"
      >
        Dismiss
      </button>
    </div>
  );
}

/** Emerald confirmation shown once files are preloaded from the workspace. */
export function HandoffLoadedBadge({
  count,
  skipped,
}: {
  count: number;
  skipped: number;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-2 text-xs text-emerald-200"
    >
      <FolderInput className="size-3.5 shrink-0" aria-hidden />
      <span>
        Loaded {count} file{count === 1 ? "" : "s"} from your workspace.
      </span>
      <ShieldCheck className="size-3.5 shrink-0 text-emerald-300" aria-hidden />
      <span className="text-emerald-200/80">
        Still in this browser; nothing was uploaded.
        {skipped > 0
          ? ` ${skipped} non-PDF ${skipped === 1 ? "file was" : "files were"} skipped.`
          : ""}
      </span>
    </p>
  );
}
