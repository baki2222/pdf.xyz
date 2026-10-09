"use client";

import { AlertTriangle, FolderInput, ShieldCheck } from "lucide-react";
import { originPhrase, type HandoffOrigin } from "@/lib/handoff";
import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";
import { getToolBySlug } from "@/lib/tools";
import { Spinner } from "./runner-kit";
import type { ToolHandoff } from "./use-tool-handoff";

/**
 * Honest, accessible states for files handed to a tool from another page,
 * shared by every handoff-aware runner:
 *  - `loading`      → a small "bringing your files over" block.
 *  - `expired`      → the token was missing/expired/already used.
 *  - `incompatible` → files came over but none fit this tool.
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
  return (
    <div
      role="status"
      className="border-line bg-wash text-muted flex items-center justify-center gap-2 rounded-[4px] border px-6 py-12 text-sm"
    >
      <Spinner />
      Bringing your files over…
    </div>
  );
}

/** "a"/"an" before a format read as letters: an MD file, a PDF. */
const article = (label: string) => (/^[AEFHILMNORSX]/.test(label) ? "an" : "a");

/** "PDF", "JPG or PNG", "XLSX, XLS or CSV". */
function orList(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * What a tool takes, as a noun, read from its `accept` row: "a PDF", "a JPG
 * or PNG image", "an MD file" — and the plural. It used to be typed "a PDF"
 * for every tool, which was false on the image and text tools.
 */
export function acceptNoun(accept: readonly string[]): {
  one: string;
  many: string;
} {
  const labels = [...new Set(accept.map(normalizeFormatLabel))];
  if (labels.length === 0) return { one: "a file", many: "files" };
  if (labels.length === 1 && labels[0] === "PDF") {
    return { one: "a PDF", many: "PDFs" };
  }
  const list = orList(labels);
  const images = labels.every((l) => l === "JPG" || l === "PNG");
  const kind = images ? "image" : "file";
  return { one: `${article(list)} ${list} ${kind}`, many: `${list} ${kind}s` };
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

  const noun = acceptNoun(handoff.accept);
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
}: {
  /** Where the files came from — the claim's `origin`, never a default. */
  origin: HandoffOrigin;
  count: number;
  skipped: number;
  /** The one file's name, for an origin that names it (a remedy). */
  fileName?: string | null;
}) {
  const fromName =
    origin.kind === "result" || origin.kind === "remedy"
      ? (getToolBySlug(origin.fromSlug)?.name ?? null)
      : null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="border-ok/40 bg-ok/10 text-ok inline-flex flex-wrap items-center gap-1.5 rounded-[3px] border px-3 py-2 text-xs"
    >
      <FolderInput className="size-3.5 shrink-0" aria-hidden />
      <span>{originPhrase(origin, { count, fileName, fromName })}</span>
      <ShieldCheck className="text-ok size-3.5 shrink-0" aria-hidden />
      <span className="text-ok">
        Still in this browser; nothing was uploaded.
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
