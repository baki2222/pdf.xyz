"use client";

import {
  AlertTriangle,
  ArrowRight,
  FolderInput,
  ShieldCheck,
} from "lucide-react";
import { originPhrase, type HandoffOrigin } from "@/lib/handoff";
import { acceptNoun } from "@/lib/intent/accept-noun";
import { getToolEntry } from "@/lib/tools/directory";
import { Spinner } from "./runner-kit";
import { useBringingFiles } from "./tool-context";
import type { ToolHandoff } from "./use-tool-handoff";

/**
 * Honest, accessible states for files handed to a tool from another page,
 * shared by every handoff-aware runner:
 *  - `loading`      → a small "bringing your files over" block.
 *  - `expired`      → the token was missing/expired/already used.
 *  - `incompatible` → files came over but none fit this tool.
 *  - `departed`     → Back to a page whose files went on to another tool:
 *                     where they went, and that this page kept no copy.
 *  - `ready`        → a subtle confirmation that says WHERE the files came
 *                     from (`originPhrase`), kept privacy-forward ("still in
 *                     this browser, nothing uploaded").
 *
 * WAS "from your workspace" in all three, for every arrival — the home page's
 * drop zone hands files over too, and they never visited the workspace. The
 * loading and expired notes cannot know the origin (no record has been read),
 * so they no longer name one; the badge reads it off the record.
 */

export function HandoffLoading() {
  // Holds the page's job row open while this block is drawn, so the row is
  // there before the job it shows is known (`TicketRail`).
  useBringingFiles();
  return (
    <div
      role="status"
      className="border-line bg-wash text-muted rounded-panel flex items-center justify-center gap-2 border px-6 py-12 text-sm"
    >
      <Spinner />
      Bringing your files over…
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
  const noun = acceptNoun(handoff.accept);
  if (handoff.departed && handoff.status === "idle") {
    const to = getToolEntry(handoff.departed.slug)?.name;
    if (!to) return null;
    return (
      <div
        role="status"
        data-handoff-departed=""
        className="border-line bg-wash text-muted rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
      >
        <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {handoff.departed.count === 1 ? "Your file" : "Your files"} went on to{" "}
          {to}. This page doesn&apos;t keep a copy, so choose {noun.one} below
          to start over.
        </span>
        <button
          type="button"
          onClick={handoff.dismiss}
          className="hover:text-fg rounded-ctl ml-auto shrink-0 px-2 py-0.5 text-xs underline transition"
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (handoff.status !== "expired" && handoff.status !== "incompatible")
    return null;

  const one = handoff.skipped === 1;
  const body =
    handoff.status === "expired"
      ? "That hand-off expired or was already used. Pick your files below to continue — nothing was uploaded."
      : one
        ? `That file came over, but it isn't ${noun.one}, so ${toolName} can't open it. Choose ${noun.one} below.`
        : `Those files came over, but none of them is ${noun.one}, so ${toolName} can't open them. Choose ${noun.many} below.`;

  return (
    <div
      role="status"
      className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{body}</span>
      <button
        type="button"
        onClick={handoff.dismiss}
        className="text-warn hover:bg-warn/10 hover:text-warn rounded-ctl ml-auto shrink-0 px-2 py-0.5 text-xs transition"
      >
        Dismiss
      </button>
    </div>
  );
}

/** Files that arrived from another page: where from, and how many were left. */
export interface Arrival {
  readonly origin: HandoffOrigin;
  readonly skipped: number;
}

/**
 * Emerald confirmation shown once files are preloaded from another page. The
 * first sentence is the record's origin (`originPhrase`); a result or remedy
 * names the tool it came from, read from the catalogue.
 */
export function HandoffLoadedBadge({
  origin,
  count,
  skipped,
  fileName = null,
  staged = null,
}: {
  /** Where the files came from — the claim's `origin`, never a default. */
  origin: HandoffOrigin;
  count: number;
  skipped: number;
  /** The one file's name, for an origin that names it (a remedy). */
  fileName?: string | null;
  /**
   * A worker panel's Run label, when the file is STAGED there (WP-10): it
   * waits in this browser and uploads only when that button is pressed.
   */
  staged?: string | null;
}) {
  const fromName =
    origin.kind === "result" ||
    origin.kind === "remedy" ||
    origin.kind === "hint"
      ? (getToolEntry(origin.fromSlug)?.name ?? null)
      : null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="border-ok/40 bg-ok/10 text-ok rounded-ctl inline-flex flex-wrap items-center gap-1.5 border px-3 py-2 text-xs"
    >
      <FolderInput className="size-3.5 shrink-0" aria-hidden />
      {/* Names the file for a remedy; a name with no break opportunity
          breaks anywhere rather than run off a phone's screen. */}
      <span className="min-w-0 wrap-anywhere">
        {originPhrase(origin, { count, fileName, fromName })}
      </span>
      <ShieldCheck className="text-ok size-3.5 shrink-0" aria-hidden />
      <span className="text-ok">
        {staged
          ? `Still in this browser; nothing is uploaded until you press ${staged}.`
          : "Still in this browser; nothing was uploaded."}
        {/* Not "non-PDF": the image and text tools skip PDFs and keep
            images or text, so the only wording true for every tool is
            what the skip actually means. */}
        {skipped > 0
          ? ` ${skipped} ${skipped === 1 ? "file" : "files"} this tool can't open ${skipped === 1 ? "was" : "were"} skipped.`
          : ""}
      </span>
    </p>
  );
}
