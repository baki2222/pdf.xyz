"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { announceOutcome } from "@/components/a11y/live-region";
import { ModeShape } from "@/components/tools/processing-badge";
import { ToolIcon } from "@/components/ui/tool-icon";
import {
  renderEvidence,
  renderNote,
  type Evidence,
} from "@/lib/intent/evidence";
import { holdOrder, type Suggestion } from "@/lib/intent/rank";
import { getProcessingMeta } from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";
import { cn } from "@/lib/utils";
import type { WorkspaceFile } from "@/lib/workspace";
import { suggestTools } from "@/lib/workspace/suggestions";
import type { WorkspaceToolSummary } from "./summary";

type Row = Suggestion<WorkspaceToolSummary>;

/**
 * Evidence a row says on its second line, after where the tool runs: what
 * comes first, and how the file reaches the tool. The first line is facts.
 */
const TERMS: ReadonlySet<Evidence["kind"]> = new Set([
  "after",
  "add-there",
  "uploads",
]);

/** The groups "More" lists, in this order. */
const MODES: readonly ProcessingMode[] = ["client", "hybrid", "server", "ai"];

/**
 * Rows stop moving once a person is reading them: when the pointer or focus
 * enters the list, or this long after the files were staged — whichever is
 * first. Later facts still update each row's words in place.
 */
const SETTLE_MS = 1500;

/** What a row's link is called: the tool, and what opening it carries. */
function rowName(row: Row, nameOf: (id: string) => string): string {
  const { tool, carry, blocked, evidence } = row;
  if (blocked) {
    const after = evidence.find((e) => e.kind === "after");
    return after
      ? `Open ${tool.name} — it opens these ${renderEvidence(after)}`
      : `Open ${tool.name}`;
  }
  if (carry.ids.length === 0) {
    return `Open ${tool.name} — ${renderEvidence({
      kind: "add-there",
      count: row.opens.length,
    })}`;
  }
  return carry.ids.length === 1
    ? `Open ${tool.name} with ${nameOf(carry.ids[0]!)}`
    : `Open ${tool.name} with ${carry.ids.length} files`;
}

function SuggestionRow({
  row,
  rank,
  primary,
  compact,
  launching,
  disabled,
  nameOf,
  onLaunch,
}: {
  row: Row;
  rank: number;
  primary: boolean;
  compact: boolean;
  launching: boolean;
  disabled: boolean;
  nameOf: (id: string) => string;
  onLaunch: (row: Row, rank: number) => void;
}) {
  const meta = getProcessingMeta(row.tool.processing);
  // The link's NAME says what it carries; its DESCRIPTION is the fact behind
  // it and where it runs — an aria-label replaces the content as the name, so
  // without this a screen reader would never hear the evidence.
  const describedBy = useId();
  const facts = row.evidence
    .filter((e) => !TERMS.has(e.kind))
    .map(renderEvidence);
  const terms = row.evidence
    .filter((e) => TERMS.has(e.kind))
    .map(renderEvidence);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // A modifier-click (new tab, new window, download) is the browser's: it
    // opens the plain tool page, as a link does without JavaScript.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (disabled) return;
    onLaunch(row, rank);
  };

  return (
    <Link
      href={`/tools/${row.slug}`}
      onClick={onClick}
      aria-label={rowName(row, nameOf)}
      aria-describedby={
        facts.length > 0
          ? `${describedBy}-facts ${describedBy}-where`
          : `${describedBy}-where`
      }
      aria-busy={launching || undefined}
      aria-disabled={disabled || undefined}
      data-suggestion={row.slug}
      className={cn(
        "group rounded-panel grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 border transition-colors",
        "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
        primary
          ? "border-accent/40 bg-select"
          : "hover:border-line hover:bg-wash border-transparent",
        disabled && !launching && "cursor-wait opacity-70",
      )}
    >
      <ToolIcon icon={row.tool.icon} size="sm" className="mt-0.5" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-fg text-sm font-medium">{row.tool.name}</span>
        {facts.length > 0 && (
          <span
            id={`${describedBy}-facts`}
            className="text-muted text-xs leading-relaxed"
          >
            {facts.join(" · ")}
          </span>
        )}
        <span
          id={`${describedBy}-where`}
          className="text-faint flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed"
        >
          <ModeShape mode={row.tool.processing} />
          <span className="font-mono font-medium tracking-wide uppercase">
            {meta.short}
          </span>
          {terms.map((term) => (
            <span key={term}>· {term}</span>
          ))}
        </span>
      </span>
      {launching ? (
        <Loader2
          className="text-muted mt-1 size-4 shrink-0 animate-spin"
          aria-hidden
        />
      ) : (
        <ArrowRight
          className={cn(
            "mt-1 size-4 shrink-0 transition-[color,translate] motion-safe:group-hover:translate-x-0.5",
            primary ? "text-accent" : "text-faint group-hover:text-fg",
          )}
          aria-hidden
        />
      )}
    </Link>
  );
}

/**
 * The tools that fit the staged files, best first, each with the fact behind
 * it and where it runs — and each a real link: an unmodified click opens the
 * tool with the files it takes already loaded (a hand-off, never an upload),
 * a modifier-click opens the plain page, and with no JavaScript the link
 * still goes to the tool.
 *
 * Rendered twice by the workspace: inline under the files on a phone, and in
 * the aside on a wide screen — one of them `display:none` at any width, so
 * assistive technology meets one list. Only the aside speaks the summary.
 */
export default function FileSuggestions({
  files,
  summaries,
  preselected,
  launchingSlug,
  launchFailedSlug,
  onLaunch,
  announce = false,
  className,
}: {
  files: WorkspaceFile[];
  summaries: WorkspaceToolSummary[];
  /** A tool the visitor arrived for (`?tool=`): pinned first when it fits. */
  preselected?: string;
  launchingSlug: string | null;
  launchFailedSlug: string | null;
  onLaunch: (
    tool: WorkspaceToolSummary,
    ids: readonly string[],
    rank: number,
  ) => void;
  /** Speak "3 suggestions for your files…" once per staged set. */
  announce?: boolean;
  className?: string;
}) {
  const headingId = useId();
  const ranking = useMemo(
    () => suggestTools(files, summaries, { currentTool: preselected ?? null }),
    [files, summaries, preselected],
  );
  const fileKey = useMemo(() => files.map((f) => f.id).join("|"), [files]);
  const nameOf = useCallback(
    (id: string) => files.find((f) => f.id === id)?.name ?? "your file",
    [files],
  );

  // Hold the order once someone is reading it (see SETTLE_MS).
  const [frozen, setFrozen] = useState<{ key: string; order: string[] } | null>(
    null,
  );
  const top = useMemo(
    () =>
      frozen?.key === fileKey
        ? holdOrder(frozen.order, ranking.top)
        : [...ranking.top],
    [frozen, fileKey, ranking.top],
  );
  const latest = useRef<string[]>([]);
  useEffect(() => {
    latest.current = top.map((row) => row.slug);
  });
  const settle = useCallback(() => {
    setFrozen((prev) =>
      prev?.key === fileKey ? prev : { key: fileKey, order: latest.current },
    );
  }, [fileKey]);
  useEffect(() => {
    const timer = setTimeout(settle, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settle]);

  // Said once per staged set, when the list settles: how many, and the best.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!announce || frozen?.key !== fileKey || announced.current === fileKey)
      return;
    announced.current = fileKey;
    const n = top.length;
    announceOutcome(
      n === 0
        ? "No tool here opens these files."
        : `${n} suggestion${n === 1 ? "" : "s"} for your files. Best match: ${top[0]!.tool.name}.`,
    );
  }, [announce, frozen, fileKey, top]);

  const more = ranking.more;
  const groups = MODES.map(
    (mode) =>
      [mode, more.filter((row) => row.tool.processing === mode)] as const,
  ).filter(([, rows]) => rows.length > 0);

  const failed = [...top, ...more].find((row) => row.slug === launchFailedSlug);
  const busy = launchingSlug !== null;
  const launch = (row: Row, rank: number) =>
    onLaunch(row.tool, row.opens, rank);

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "bg-panel border-line rounded-panel flex flex-col gap-4 border p-5",
        className,
      )}
      onPointerEnter={settle}
      onFocus={settle}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="kicker text-muted">
          Suggested for your files
        </h2>
        <Link
          href="/tools"
          className="text-accent text-xs font-medium underline-offset-4 hover:underline"
        >
          All tools
        </Link>
      </div>

      {top.length > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {top.map((row, i) => (
            <li
              key={row.slug}
              className="motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0"
            >
              <SuggestionRow
                row={row}
                rank={i + 1}
                primary={i === 0}
                compact={false}
                launching={launchingSlug === row.slug}
                disabled={busy}
                nameOf={nameOf}
                onLaunch={launch}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted text-sm">
          No tool here opens {files.length === 1 ? "this file" : "these files"}{" "}
          as {files.length === 1 ? "it is" : "they are"}.
        </p>
      )}

      {failed && (
        <p
          role="alert"
          className="border-warn/40 bg-warn/10 text-warn rounded-panel border px-3 py-2 text-xs leading-relaxed"
        >
          Couldn&apos;t carry your files to {failed.tool.name} in this browser.{" "}
          <Link
            href={`/tools/${failed.slug}`}
            className="text-fg underline underline-offset-4"
          >
            Open {failed.tool.name}
          </Link>{" "}
          and add them there.
        </p>
      )}

      {ranking.notes.length > 0 && (
        <ul aria-label="About your files" className="flex flex-col gap-1.5">
          {ranking.notes.map((note) => (
            <li
              key={renderNote(note)}
              className="text-muted flex items-start gap-2 text-xs leading-relaxed"
            >
              <AlertTriangle
                className="text-warn mt-0.5 size-3.5 shrink-0"
                aria-hidden
              />
              <span>{renderNote(note)}</span>
            </li>
          ))}
        </ul>
      )}

      {more.length > 0 && (
        <details className="group/more border-line border-t pt-3">
          <summary className="text-muted hover:text-fg flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-3.5 transition-transform group-open/more:rotate-180"
              aria-hidden
            />
            More for these files ({more.length})
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {groups.map(([mode, rows]) => (
              <div key={mode} className="flex flex-col gap-1">
                <p className="kicker text-faint">
                  {getProcessingMeta(mode).label}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {rows.map((row) => (
                    <li key={row.slug}>
                      <SuggestionRow
                        row={row}
                        rank={top.length + more.indexOf(row) + 1}
                        primary={false}
                        compact
                        launching={launchingSlug === row.slug}
                        disabled={busy}
                        nameOf={nameOf}
                        onLaunch={launch}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
