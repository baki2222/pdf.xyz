"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  FolderInput,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { announceOutcome } from "@/components/a11y/live-region";
import { ModeShape } from "@/components/tools/processing-badge";
import type { HandoffOrigin } from "@/lib/handoff";
import {
  renderEvidence,
  renderNote,
  type Evidence,
} from "@/lib/intent/evidence";
import { factWords, pagesOf, type FactWord } from "@/lib/intent/fact-words";
import { launchWithFiles, openWorkspaceWithFiles } from "@/lib/intent/launch";
import { acceptsHref, isPlainClick, toolHref } from "@/lib/intent/links";
import { holdOrder, rankForFiles, type Suggestion } from "@/lib/intent/rank";
import { useRecents } from "@/lib/intent/recents";
import { suggestionName } from "@/lib/intent/suggestion-name";
import {
  ticketFiles,
  type TicketAction,
  type TicketState,
} from "@/lib/intent/ticket";
import { ticketSummary } from "@/lib/intent/ticket-summary";
import { buildToolIndex } from "@/lib/intent/tool-index";
import type { SuggestionSource } from "@/lib/telemetry/events";
import { getProcessingMeta } from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";
import { cn, formatBytes } from "@/lib/utils";

import { TICKET_CHUNK_MARKER } from "./ticket-chunk";

/**
 * The string only this chunk carries (`./ticket-chunk`), rendered as the
 * view's `data-chunk` so minification keeps it.
 */
export { TICKET_CHUNK_MARKER };

/**
 * The measuring the ticket's owner runs (`use-ticket.ts`), shipped in THIS
 * chunk: one on-demand chunk for everything the ticket needs, as the home
 * page had before the desk. Fetched as two, the facts module and this view
 * shared the format tables, and the build split those into a chunk of their
 * own that /tools and every tool page then loaded as an extra request
 * (+0.4 KB gzip each, measured 2026-10-10).
 */
export { measureFacts, quickFacts } from "@/lib/intent/facts";

/**
 * A tool's name, for the desk's "Recent" row — from the catalogue this chunk
 * already carries, so naming a recent tool fetches nothing the ticket would
 * not (a separate catalogue fetch split the build's shared chunks the same
 * way the measuring did).
 */
export { getToolBySlug } from "@/lib/tools";

/** Suggestions shown before "More". */
const TOP = 3;
/** File rows shown before "+N more". */
const FILE_ROWS = 3;
/** Rows that enter one after another, at most (M6). */
const STAGGER_CAP = 5;

/** How a file reaches a tool, and what comes first: said after the name. */
const TERMS: ReadonlySet<Evidence["kind"]> = new Set([
  "after",
  "add-there",
  "uploads",
]);

/** "More" lists tools by where they run, in this order. */
const MODES: readonly ProcessingMode[] = ["client", "hybrid", "server", "ai"];

/** Between facts: a no-break space before the dot, so a wrapped line never starts with one (as `fact-separator.ts`). An escape: the character is invisible. */
const SEP = "\u00a0\u00b7 ";

type Row = Suggestion;

export interface TicketViewProps {
  readonly state: TicketState;
  /** `desk`: inside the home desk's fixed box; `dialog`: a drop dialog. */
  readonly variant: "desk" | "dialog";
  /** The id its `h2` takes — the owner's region is labelled by it. */
  readonly headingId: string;
  /** Where the files came from, for the tool page to say. */
  readonly origin: HandoffOrigin;
  readonly source: SuggestionSource;
  readonly onEvent: Dispatch<TicketAction>;
  readonly onAddFiles: () => void;
  readonly onClear: () => void;
}

/** One measured fact, drawn: a placeholder while it is being measured. */
function Fact({ word }: { word: FactWord }) {
  if (word.pending)
    return (
      <span className="sweep-placeholder motion-safe:animate-sweep text-faint inline-block min-w-[7ch] font-sans">
        {word.text}
      </span>
    );
  return (
    <span
      className={cn(
        word.tone === "warn"
          ? "text-warn"
          : word.tone === "faint"
            ? "text-faint"
            : "text-muted",
        "motion-safe:transition-[opacity,translate] motion-safe:duration-150 motion-safe:starting:translate-y-0.5 motion-safe:starting:opacity-0",
      )}
    >
      {word.text}
    </span>
  );
}

function Facts({ words }: { words: readonly FactWord[] }) {
  return (
    <>
      {words.map((word, i) => (
        <Fragment key={`${i}-${word.text}`}>
          {i > 0 && <span className="text-faint">{SEP}</span>}
          <Fact word={word} />
        </Fragment>
      ))}
    </>
  );
}

/** A suggestion: a real link to its tool that, clicked, carries the files. */
function SuggestionRow({
  row,
  rank,
  look,
  launching,
  disabled,
  nameOf,
  onLaunch,
}: {
  row: Row;
  rank: number;
  look: "primary" | "row" | "compact";
  launching: boolean;
  disabled: boolean;
  nameOf: (id: string) => string;
  onLaunch: (row: Row, rank: number) => void;
}) {
  const describedBy = useId();
  const meta = getProcessingMeta(row.tool.processing);
  const facts = row.evidence
    .filter((e) => !TERMS.has(e.kind))
    .map(renderEvidence);
  const terms = row.evidence
    .filter((e) => TERMS.has(e.kind))
    .map(renderEvidence);
  // What a row says after its name: where the file goes first, then why.
  const line = [...terms, ...facts].join(SEP);
  const primary = look === "primary";

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // A modifier-click is the browser's: the plain tool page, as without JS.
    if (!isPlainClick(event)) return;
    event.preventDefault();
    if (!disabled) onLaunch(row, rank);
  };

  const mode = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] font-medium tracking-wide uppercase",
        primary ? "text-muted-invert" : "text-faint",
      )}
    >
      <ModeShape mode={row.tool.processing} />
      <span className={cn(look !== "primary" && "max-sm:sr-only")}>
        {meta.short}
      </span>
    </span>
  );

  return (
    <a
      href={toolHref(row.slug)}
      onClick={onClick}
      aria-label={suggestionName(row, nameOf)}
      aria-describedby={describedBy}
      aria-busy={launching || undefined}
      aria-disabled={disabled || undefined}
      data-suggestion={row.slug}
      className={cn(
        "group rounded-ctl grid items-center gap-x-3 transition-colors",
        "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
        "motion-safe:active:translate-y-px",
        primary
          ? "bg-invert text-fg-invert hover:bg-invert/90 h-14 grid-cols-[auto_minmax(0,1fr)_auto] px-3"
          : look === "row"
            ? "hover:bg-wash h-10 grid-cols-[auto_minmax(0,1fr)_auto_auto] px-3"
            : "hover:bg-wash h-9 grid-cols-[minmax(0,1fr)_auto_auto] px-2",
        disabled && !launching && "cursor-wait opacity-70",
      )}
    >
      {look !== "compact" && (
        <span
          aria-hidden
          className={cn(
            "rounded-tag figure grid size-6 place-items-center border text-[11px]",
            primary ? "border-fg-invert/30" : "border-line text-muted",
          )}
        >
          {rank}
        </span>
      )}
      {primary ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-medium">
            {row.tool.name}
          </span>
          <span
            id={describedBy}
            className="text-muted-invert flex min-w-0 items-center gap-2 text-xs"
          >
            {mode}
            <span className="truncate">{line}</span>
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="text-fg shrink-0 font-medium">{row.tool.name}</span>
          {line && (
            <span
              id={describedBy}
              // `relative`: the sr-only word at the end of a cut-short line is
              // absolutely positioned at that line's far end, and without a
              // containing block here it widened the page by 175px at 390.
              className="text-muted relative min-w-0 truncate text-xs"
            >
              <span aria-hidden className="text-faint">
                {SEP}
              </span>
              {line}
              <span className="sr-only">
                {SEP}
                {meta.short}
              </span>
            </span>
          )}
          {!line && (
            <span id={describedBy} className="sr-only">
              {meta.short}
            </span>
          )}
        </span>
      )}
      {!primary && mode}
      {launching ? (
        <Loader2
          className={cn(
            "size-4 shrink-0 animate-spin",
            primary ? "text-fg-invert" : "text-muted",
          )}
          aria-hidden
        />
      ) : (
        <ArrowRight
          className={cn(
            "size-4 shrink-0 transition-[color,translate] motion-safe:group-hover:translate-x-0.5",
            primary ? "text-fg-invert" : "text-faint group-hover:text-fg",
          )}
          aria-hidden
        />
      )}
    </a>
  );
}

/** The suggestions slot while the files are measured: the same geometry. */
function Placeholder() {
  return (
    <div aria-busy="true" className="flex flex-col gap-1">
      <span className="sr-only">Checking your files…</span>
      <div className="rounded-ctl bg-wash flex h-14 items-center px-3">
        <span className="sweep-placeholder motion-safe:animate-sweep bg-line/60 h-3 w-2/5" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="flex h-10 items-center px-3">
          <span className="sweep-placeholder motion-safe:animate-sweep bg-line/40 h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * The job ticket: what this tab found in the files, and the tools that fit
 * them — the first one solid, each a link that opens its tool with the files
 * already in it (a hand-off in this browser, never an upload), each saying
 * where it runs and the measured fact that put it there.
 *
 * Loaded on demand (the desk fetches it as a file approaches) and never with
 * the page: it carries the catalogue, the ranking and the hand-off store.
 *
 * STABILITY. Rows appear once the files are measured (or the owner stops
 * waiting), then hold their order: later facts change a row's words, never
 * its place — so the row under the pointer is the row that was there. Every
 * slot keeps one height from "checking" to "ready", and the desk around it
 * keeps one height from empty to ticket.
 */
export default function TicketView({
  state,
  variant,
  headingId,
  origin,
  source,
  onEvent,
  onAddFiles,
  onClear,
}: TicketViewProps) {
  const router = useRouter();
  const index = useMemo(() => buildToolIndex(), []);
  const recents = useRecents();
  const recentSlugs = useMemo(() => recents.map((r) => r.slug), [recents]);
  const { entries, overflow, launching, failed } = state;
  const settled = state.settled;

  // Files the facts module has read (an instant after they arrive): the
  // ranking reads facts, never a bare name. Kept out of this chunk on
  // purpose — the owner measures, so the measuring code ships once.
  const facts = useMemo(
    () => entries.flatMap((e) => (e.facts ? [e.facts] : [])),
    [entries],
  );
  const ranking = useMemo(
    () =>
      rankForFiles(facts, index, {
        recents: recentSlugs,
        topCount: overflow.length > 0 ? TOP - 1 : TOP,
      }),
    [facts, index, recentSlugs, overflow.length],
  );
  const nameOf = useCallback(
    (id: string) => entries.find((e) => e.id === id)?.file.name ?? "your file",
    [entries],
  );

  // Shown once, then held: the order frozen at the first settled render.
  const [frozen, setFrozen] = useState<{
    arrival: number;
    order: string[];
  } | null>(null);
  if (settled && frozen?.arrival !== state.arrival)
    setFrozen({
      arrival: state.arrival,
      order: ranking.top.map((r) => r.slug),
    });
  const top = useMemo(
    () =>
      frozen?.arrival === state.arrival
        ? holdOrder(frozen.order, ranking.top)
        : [...ranking.top],
    [frozen, state.arrival, ranking.top],
  );
  const more = ranking.more;
  const showRows = settled && frozen?.arrival === state.arrival;

  // Said once per arrival, when the offers appear.
  const spoken = useRef<number | null>(null);
  useEffect(() => {
    if (!showRows || spoken.current === state.arrival) return;
    spoken.current = state.arrival;
    const n = entries.length + overflow.length;
    const checked = `Checked ${n} file${n === 1 ? "" : "s"}.`;
    announceOutcome(
      top.length === 0
        ? `${checked} No tool here opens ${n === 1 ? "it" : "them"}.`
        : `${checked} ${top.length} suggestion${top.length === 1 ? "" : "s"}. Best match: ${top[0]!.tool.name}.`,
    );
  }, [showRows, state.arrival, entries.length, overflow.length, top]);

  const busy = launching !== null;
  const launch = (row: Row, rank: number) => {
    if (busy) return;
    onEvent({ type: "launch", target: row.slug });
    const files = row.opens
      .map((id) => entries.find((e) => e.id === id)?.file)
      .filter((f): f is File => f !== undefined);
    void launchWithFiles({
      toolSlug: row.slug,
      files,
      origin,
      suggestion: { source, rank },
      router,
    }).then(
      (result) => onEvent({ type: "launched", target: row.slug, result }),
      () => onEvent({ type: "launched", target: row.slug, result: "failed" }),
    );
  };
  const openWorkspace = () => {
    if (busy) return;
    onEvent({ type: "launch", target: "workspace" });
    void openWorkspaceWithFiles({
      files: ticketFiles(state),
      origin,
      router,
    }).then(
      (result) => onEvent({ type: "launched", target: "workspace", result }),
      () =>
        onEvent({ type: "launched", target: "workspace", result: "failed" }),
    );
  };

  const summary = ticketSummary(
    entries.map((e) => ({ size: e.file.size, facts: e.facts })),
  );
  const shown = entries.slice(0, FILE_ROWS);
  const hiddenFiles = entries.length - shown.length + overflow.length;
  const formats = new Set(facts.map((f) => f.format));
  const oneFormat = formats.size === 1 ? [...formats][0] : null;
  const failedName =
    failed &&
    (failed.target === "workspace"
      ? "the workspace"
      : (index.find((t) => t.slug === failed.target)?.name ?? "the tool"));
  const failedHref =
    failed &&
    (failed.target === "workspace" ? "/workspace" : toolHref(failed.target));
  const groups = MODES.map(
    (mode) => [mode, more.filter((r) => r.tool.processing === mode)] as const,
  ).filter(([, rows]) => rows.length > 0);
  const desk = variant === "desk";

  return (
    <div
      data-chunk={TICKET_CHUNK_MARKER}
      className={cn("flex flex-col", desk && "flex-1")}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="kicker text-faint relative truncate">
          Job ticket
          <span className="max-sm:sr-only">
            <span aria-hidden> · </span>
            <span className="sr-only">, </span>checked in this tab
          </span>
        </p>
        <div className="-mr-1.5 flex shrink-0 items-center">
          <button
            type="button"
            onClick={busy ? undefined : onAddFiles}
            aria-disabled={busy || undefined}
            className="text-muted hover:text-fg hover:bg-wash rounded-ctl inline-flex h-7 items-center gap-1 px-2 text-xs font-medium transition-colors"
          >
            <Plus className="size-3.5" aria-hidden />
            Add<span className="sr-only"> files</span>
          </button>
          <button
            type="button"
            onClick={busy ? undefined : onClear}
            aria-disabled={busy || undefined}
            className="text-muted hover:text-fg hover:bg-wash rounded-ctl inline-flex h-7 items-center gap-1 px-2 text-xs font-medium transition-colors"
          >
            <X className="size-3.5" aria-hidden />
            Clear
          </button>
        </div>
      </div>

      <h2
        id={headingId}
        className="font-display text-fg mt-1.5 text-lg leading-snug font-semibold tracking-tight"
      >
        What you can do with these files
      </h2>
      <p className="figure mt-0.5 h-4 truncate text-xs leading-4">
        <Facts words={summary} />
      </p>

      <dl aria-label="Your files" className="mt-3 flex flex-col">
        {shown.map((entry, i) => {
          const pages = pagesOf(entry.facts);
          // In the order they become known, so the line grows only at its
          // end: what the row knew on arrival (the sample mark, the size),
          // then the pages where "measuring…" stood, then the findings.
          const words: FactWord[] = [
            ...(entry.sample
              ? [{ text: "pdf.xyz's sample", tone: "muted" as const }]
              : []),
            { text: formatBytes(entry.file.size), tone: "muted" },
            ...(pages !== null
              ? [
                  {
                    text: `${pages} page${pages === 1 ? "" : "s"}`,
                    tone: "muted" as const,
                  },
                ]
              : []),
            ...factWords(entry.facts),
          ];
          return (
            <div
              key={entry.id}
              style={{ transitionDelay: `${Math.min(i, 6) * 30}ms` }}
              className="border-line motion-safe:ease-out-expo flex h-6 items-baseline gap-3 border-b border-dotted last:border-b-0 motion-safe:transition-[opacity,translate] motion-safe:duration-[240ms] motion-safe:starting:-translate-y-1.5 motion-safe:starting:opacity-0"
            >
              <dt className="text-fg w-0 flex-1 truncate text-[13px]">
                {entry.file.name}
              </dt>
              {/* A fixed column, left-aligned: a fact that lands lengthens
                  the line to the right and moves nothing already there. */}
              <dd className="figure w-1/2 shrink-0 truncate text-[11px]">
                <Facts words={words} />
              </dd>
            </div>
          );
        })}
        {hiddenFiles > 0 && (
          <div className="flex h-5 items-baseline">
            <dt className="sr-only">More files</dt>
            <dd className="text-faint text-[11px]">
              +{hiddenFiles} more
              {overflow.length > 0 && (
                <span>
                  {" "}
                  — {overflow.length} not checked here; the workspace takes them
                  all
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      <div aria-hidden className="perforation my-3" />

      <div data-slot="suggestions" className={cn(desk && "min-h-36")}>
        {!showRows ? (
          <Placeholder />
        ) : (
          <ol className="flex flex-col gap-1">
            {overflow.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={openWorkspace}
                  aria-busy={launching === "workspace" || undefined}
                  className="bg-invert text-fg-invert hover:bg-invert/90 rounded-ctl flex h-14 w-full items-center justify-between gap-3 px-3 text-left"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-medium">
                      Open all {entries.length + overflow.length} files in the
                      workspace
                    </span>
                    <span className="text-muted-invert truncate text-xs">
                      More than a ticket lists — the workspace stages them all
                    </span>
                  </span>
                  <FolderInput className="size-4 shrink-0" aria-hidden />
                </button>
              </li>
            )}
            {top.map((row, i) => (
              <li
                key={row.slug}
                style={{
                  transitionDelay: `${Math.min(i, STAGGER_CAP) * 40}ms`,
                }}
                className="motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0"
              >
                <SuggestionRow
                  row={row}
                  rank={i + 1}
                  look={i === 0 && overflow.length === 0 ? "primary" : "row"}
                  launching={launching === row.slug}
                  disabled={busy}
                  nameOf={nameOf}
                  onLaunch={launch}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      {failed && (
        <p role="alert" className="text-warn mt-2 text-xs leading-relaxed">
          Couldn&apos;t carry your files to {failedName} in this browser.{" "}
          <a
            href={failedHref!}
            className="text-fg underline underline-offset-4"
          >
            Open {failedName}
          </a>{" "}
          and add them there.
        </p>
      )}
      {showRows && ranking.notes.length > 0 && (
        <ul aria-label="About your files" className="mt-2 flex flex-col gap-1">
          {ranking.notes.map((note) => (
            <li
              key={renderNote(note)}
              className="text-muted flex items-start gap-2 text-xs leading-relaxed"
            >
              <AlertTriangle
                className="text-warn mt-0.5 size-3.5 shrink-0"
                aria-hidden
              />
              <span className="line-clamp-2 w-0 flex-1 wrap-anywhere">
                {renderNote(note)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The stub: what else, and where else, torn off along its own line
          at the foot of the desk. */}
      {desk && (
        <>
          {/* Where the files are, said again at the moment of choosing — the
              desk's own promise, in its own words. */}
          <p className="text-muted mt-auto flex gap-2 pt-3 text-xs leading-snug text-pretty">
            <span
              aria-hidden
              className="bg-ok mt-[0.3rem] size-1.5 shrink-0 rounded-full"
            />
            <span>
              Still only in this browser. Nothing uploads until you start a step
              marked Secure worker or AI.
            </span>
          </p>
          <div aria-hidden className="pt-3">
            <div className="perforation" />
          </div>
        </>
      )}
      <div className="relative pt-2">
        {showRows && more.length > 0 ? (
          <details className="group/more">
            <summary className="text-muted hover:text-fg inline-flex h-8 cursor-pointer list-none items-center gap-1.5 text-xs font-medium [&::-webkit-details-marker]:hidden">
              <ChevronDown
                className="size-3.5 transition-transform group-open/more:rotate-180"
                aria-hidden
              />
              More for these files ({more.length})
            </summary>
            <div className="mt-2 flex flex-col gap-3 pb-1">
              {groups.map(([mode, rows]) => (
                <div key={mode} className="flex flex-col gap-0.5">
                  <p className="kicker text-faint">
                    {getProcessingMeta(mode).label}
                  </p>
                  <ul className="flex flex-col">
                    {rows.map((row) => (
                      <li key={row.slug}>
                        <SuggestionRow
                          row={row}
                          rank={top.length + more.indexOf(row) + 1}
                          look="compact"
                          launching={launching === row.slug}
                          disabled={busy}
                          nameOf={nameOf}
                          onLaunch={launch}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {oneFormat && (
                <a
                  href={acceptsHref(oneFormat)}
                  className="text-accent self-start text-xs font-medium underline-offset-4 hover:underline"
                >
                  Every tool that takes {oneFormat}, on the tools page
                </a>
              )}
            </div>
          </details>
        ) : (
          <span className="block h-8" />
        )}
        {overflow.length === 0 && (
          <button
            type="button"
            onClick={openWorkspace}
            aria-disabled={busy || undefined}
            aria-busy={launching === "workspace" || undefined}
            className="text-muted hover:text-fg absolute top-2 right-0 inline-flex h-8 items-center gap-1.5 text-xs font-medium transition-colors"
          >
            {launching === "workspace" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <FolderInput className="size-3.5" aria-hidden />
            )}
            Open in workspace
          </button>
        )}
      </div>
    </div>
  );
}
