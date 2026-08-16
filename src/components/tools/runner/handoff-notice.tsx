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
      className="border-line bg-wash text-muted flex items-center justify-center gap-2 rounded-[4px] border px-6 py-12 text-sm"
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
      className="border-warn/40 bg-warn/10 text-warn flex items-start gap-2 rounded-[4px] border px-4 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{body}</span>
      <button
        type="button"
        onClick={handoff.dismiss}
        className="text-warn hover:bg-warn/10 hover:text-warn ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs transition"
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
      className="border-ok/40 bg-ok/10 text-ok inline-flex flex-wrap items-center gap-1.5 rounded-[3px] border px-3 py-2 text-xs"
    >
      <FolderInput className="size-3.5 shrink-0" aria-hidden />
      <span>
        Loaded {count} file{count === 1 ? "" : "s"} from your workspace.
      </span>
      <ShieldCheck className="text-ok size-3.5 shrink-0" aria-hidden />
      <span className="text-ok">
        Still in this browser; nothing was uploaded.
        {skipped > 0
          ? ` ${skipped} non-PDF ${skipped === 1 ? "file was" : "files were"} skipped.`
          : ""}
      </span>
    </p>
  );
}
