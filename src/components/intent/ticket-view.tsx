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
  type ReactNode,
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
  renderPin,
  type Evidence,
  type PinNote,
} from "@/lib/intent/evidence";
import { quickFacts, type FileFacts } from "@/lib/intent/facts";
import { factWords, pagesOf, type FactWord } from "@/lib/intent/fact-words";
import { launchWithFiles, openWorkspaceWithFiles } from "@/lib/intent/launch";
import { acceptsHref, isPlainClick, toolHref } from "@/lib/intent/links";
import { holdOrder, rankForFiles, type Suggestion } from "@/lib/intent/rank";
import { useRecents } from "@/lib/intent/recents";
import { suggestionName } from "@/lib/intent/suggestion-name";
import { confirmLeave } from "@/lib/intent/unsaved";
import {
  checkedCount,
  ticketFiles,
  uncheckedAmong,
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
import { TICKET_FILE_ROWS, TicketFrame } from "./ticket-frame";

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
/** Rows that enter one after another, at most (M6). */
const STAGGER_CAP = 5;

/**
 * The words that LIMIT what a click carries, the most limiting first: the
 * tool cannot open the files yet; it carries nothing (they are added
 * there); it carries one file of several; it opens some of the files. The
 * first that applies LEADS the row's line and does not give way, so a row
 * cut short at 390px still says what the click does; the rest follow it.
 * WAS the reverse (counts first, the limit last): "Sign PDF · 2 PDFs · 15
 * pages · tak…" read as if both files went to Sign PDF, and the words that
 * said otherwise were the ones cut.
 */
const QUALIFIERS: readonly Evidence["kind"][] = [
  "after",
  "add-there",
  "one-file",
  "partial",
];
/**
 * After the qualifiers, in this order: why the row is offered (a pin's fact,
 * a measured boost), when the file moves, and last the counts any row could
 * state — the first words to give way.
 */
const AFTER_QUALIFIERS: readonly (readonly Evidence["kind"][])[] = [
  ["lock", "unreadable", "no-text", "fields", "big-file", "long"],
  ["uploads"],
  ["count", "pages", "size"],
];

/**
 * A row's evidence as the two parts of its line: the `lead` (one fact),
 * which is never cut, and the `rest`, which may be. `omit` is a fact said in
 * full elsewhere (a pin's reason, in the note slot).
 *
 * "takes only that file" leans on the fact before it, which names the file:
 * when it would lead, that fact leads instead (it names the one file the
 * click carries) and the qualifier follows it. With nothing before it to
 * lean on, it names the file itself. "you'll add … there" never leans: it
 * names its own files ("report.docx", "the 2 DOCX files"), because the fact
 * that would (the count) comes last and is the first cut.
 */
export function arrangeLine(
  evidence: readonly Evidence[],
  omit?: Evidence,
): { lead: string[]; rest: string[] } {
  const shown = evidence.filter((e) => e !== omit);
  const byKind = (kinds: readonly Evidence["kind"][]) =>
    kinds.flatMap((kind) => shown.filter((e) => e.kind === kind));
  const qualifiers = byKind(QUALIFIERS);
  let sequence: Evidence[] = [
    ...qualifiers,
    ...AFTER_QUALIFIERS.flatMap(byKind),
  ];
  const top = qualifiers[0];
  if (top?.kind === "one-file" && top.named) {
    const referent = shown[0];
    sequence =
      referent && !QUALIFIERS.includes(referent.kind)
        ? [referent, ...sequence.filter((e) => e !== referent)]
        : sequence.map((e) => (e === top ? { ...top, named: false } : e));
  }
  const [lead, ...rest] = sequence;
  return {
    lead: lead ? [renderEvidence(lead)] : [],
    rest: rest.map(renderEvidence),
  };
}

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
  /** `desk`: empty the ticket; `dialog`: close it (the same button, named for what it does). */
  readonly onClear: () => void;
  /**
   * A tool never offered: the tool page the dialog was opened on. A hand-off
   * to the page already open would not be claimed (a runner claims on mount),
   * so the row would go nowhere; the dialog says instead why the files did
   * not go into it.
   */
  readonly exclude?: string | null;
  /**
   * A tool offered FIRST when it takes the files: the tool a guide is about,
   * which cannot be handed them (no in-browser runner), so its row says the
   * files are added there (`stage`).
   */
  readonly pin?: string | null;
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

/**
 * A row's line: the lead, which keeps its width, then the rest, which takes
 * what is left and is cut first. (A lead longer than the whole line — a very
 * long file name — is cut too, at the line's end: it never pushes the row.)
 */
function Line({ lead, rest }: { lead: string[]; rest: string[] }) {
  return (
    <span className="flex min-w-0">
      {lead.length > 0 && (
        <span data-lead="" className="max-w-full shrink-0 truncate">
          {lead.join(SEP)}
        </span>
      )}
      {rest.length > 0 && (
        <span className="min-w-0 truncate">
          {lead.length > 0 && SEP}
          {rest.join(SEP)}
        </span>
      )}
    </span>
  );
}

/** A suggestion: a real link to its tool that, clicked, carries the files. */
function SuggestionRow({
  row,
  rank,
  look,
  launching,
  disabled,
  omit,
  nameOf,
  onLaunch,
}: {
  row: Row;
  rank: number;
  look: "primary" | "row" | "compact";
  launching: boolean;
  disabled: boolean;
  /** A fact the ticket says in full elsewhere (the pin's reason). */
  omit?: Evidence;
  nameOf: (id: string) => string;
  onLaunch: (row: Row, rank: number) => void;
}) {
  const describedBy = useId();
  const meta = getProcessingMeta(row.tool.processing);
  const { lead, rest } = arrangeLine(row.evidence, omit);
  const empty = lead.length === 0 && rest.length === 0;
  const primary = look === "primary";

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // A modifier-click is the browser's: the plain tool page, as without JS.
    if (!isPlainClick(event)) return;
    event.preventDefault();
    if (!disabled) onLaunch(row, rank);
  };

  // The shape always; the word from `sm` (below that it is in the
  // description, read out but not drawn) — so a phone's row gives its width
  // to the words that say what the click carries.
  const mode = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium",
        primary ? "text-muted-invert" : "text-faint",
      )}
    >
      <ModeShape mode={row.tool.processing} />
      <span className="max-sm:sr-only">{meta.plain}</span>
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
          {/* `relative`: the sr-only word is absolutely positioned, and
              without a containing block here it widened the page at 390. */}
          <span
            id={describedBy}
            className="text-muted-invert relative flex min-w-0 items-center gap-2 text-xs"
          >
            {mode}
            <Line lead={lead} rest={rest} />
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "flex min-w-0",
            look === "row" ? "flex-col" : "items-baseline",
          )}
        >
          <span
            className={cn(
              "text-fg text-sm font-medium",
              look === "row" ? "truncate leading-5" : "shrink-0",
            )}
          >
            {row.tool.name}
          </span>
          {/* Two lines in a row (the name, then what it carries), one in
              "More". `relative`: as above. */}
          <span
            id={describedBy}
            className="text-muted relative flex min-w-0 text-xs leading-4"
          >
            {look === "compact" && !empty && (
              <span aria-hidden className="text-faint shrink-0">
                {SEP}
              </span>
            )}
            {!empty && <Line lead={lead} rest={rest} />}
            <span className="sr-only">
              {!empty && SEP}
              {meta.plain}
            </span>
          </span>
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

/** A file past the ticket's limit: its name and size, never read. */
function unreadFacts(file: File, id: string): FileFacts {
  const facts = quickFacts(file, id);
  return {
    ...facts,
    pdf: facts.pdf ? { state: "not-checked", reason: "limit" } : null,
  };
}

/**
 * A note: a mark, then its words — clamped at two lines in the note slot,
 * whole under "More" (where the notes the slot had no room for go).
 */
function NoteLine({
  mark,
  children,
  role,
  whole = false,
}: {
  mark: "warn" | "ok";
  children: ReactNode;
  role?: "alert";
  whole?: boolean;
}) {
  return (
    <p
      role={role}
      className="text-muted flex items-start gap-2 text-xs leading-4"
    >
      {mark === "warn" ? (
        <AlertTriangle className="text-warn size-3.5 shrink-0" aria-hidden />
      ) : (
        <span
          aria-hidden
          className="bg-ok mx-1 mt-[0.3125rem] size-1.5 shrink-0 rounded-full"
        />
      )}
      <span
        className={cn("w-0 flex-1 wrap-anywhere", !whole && "line-clamp-2")}
      >
        {children}
      </span>
    </p>
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
 * part of it is drawn into {@link TicketFrame}, whose slots have heights no
 * content changes, so the ticket is one height from "checking" to "ready"
 * whatever arrived — and the desk, which holds an empty frame from the first
 * paint, is that height before any file does.
 */
export default function TicketView({
  state,
  variant,
  exclude = null,
  pin: pinSlug = null,
  headingId,
  origin,
  source,
  onEvent,
  onAddFiles,
  onClear,
}: TicketViewProps) {
  const router = useRouter();
  const index = useMemo(
    () => buildToolIndex().filter((tool) => tool.slug !== exclude),
    [exclude],
  );
  const recents = useRecents();
  const recentSlugs = useMemo(() => recents.map((r) => r.slug), [recents]);
  const { entries, overflow, launching, failed } = state;
  const settled = state.settled;
  const panelId = useId();
  const [moreOpen, setMoreOpen] = useState(false);

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
        currentTool: pinSlug,
        topCount: overflow.length > 0 ? TOP - 1 : TOP,
      }),
    [facts, index, recentSlugs, overflow.length, pinSlug],
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

  // Said once per arrival, when the offers appear — and the count is of the
  // files this tab CHECKED, from their facts, out of every file it holds.
  // WAS `entries.length + overflow.length`: "Checked 22 files" while 17 of
  // them had not been opened, and the screen said so beside it.
  const spoken = useRef<number | null>(null);
  useEffect(() => {
    if (!showRows || spoken.current === state.arrival) return;
    spoken.current = state.arrival;
    const { checked, total } = checkedCount(state);
    const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;
    const said =
      checked === total
        ? `Checked ${files(total)}.`
        : `Checked ${checked} of ${files(total)}.`;
    announceOutcome(
      top.length === 0
        ? `${said} No tool here opens ${total === 1 ? "it" : "them"}.`
        : `${said} ${top.length} suggestion${top.length === 1 ? "" : "s"}. Best match: ${top[0]!.tool.name}.`,
    );
  }, [showRows, state, top]);

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
      confirmLeave,
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
      confirmLeave,
    }).then(
      (result) => onEvent({ type: "launched", target: "workspace", result }),
      () =>
        onEvent({ type: "launched", target: "workspace", result: "failed" }),
    );
  };

  // The summary counts every file the ticket holds; the ones past its limit
  // by name and size alone (they are never read, so they add no pages).
  const summary = ticketSummary([
    ...entries.map((e) => ({ size: e.file.size, facts: e.facts })),
    ...overflow.map((file, i) => ({
      size: file.size,
      facts: unreadFacts(file, `overflow-${i}`),
    })),
  ]);
  const shown = entries.slice(0, TICKET_FILE_ROWS);
  const hidden = entries.slice(TICKET_FILE_ROWS);
  const hiddenFiles = hidden.length + overflow.length;
  // Of the files under "+N more", those the ticket did not check: the
  // PDFs past the probes, and every file past the ticket's limit.
  const hiddenUnchecked = uncheckedAmong(hidden, overflow);
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

  // Why the first row is first, when it is pinned: said in full in the note
  // slot, where it wraps, instead of cut short at the end of its row.
  const first = showRows ? top[0] : undefined;
  const pinFact =
    first?.pinned === "lock" || first?.pinned === "repair"
      ? first.evidence.find(
          (e): e is PinNote["fact"] =>
            e.kind === "lock" || e.kind === "unreadable",
        )
      : undefined;
  const pin: PinNote | null =
    first && pinFact
      ? {
          fact: pinFact,
          tool: first.tool.name,
          waiting: more.filter(
            (r) =>
              r.blocked ===
              (first.pinned === "lock" ? "unlock-first" : "repair-first"),
          ).length,
        }
      : null;
  const notes = showRows ? ranking.notes : [];
  // The slot holds one thing: a failed launch, else the pin's reason, else
  // the first note, else the desk's promise. Notes it has no room for are
  // listed under "More".
  const slotNote = !failed && !pin ? notes[0] : undefined;
  const moreNotes = notes.filter((n) => n !== slotNote);
  const hasMore = showRows && (more.length > 0 || moreNotes.length > 0);

  const note = failed ? (
    <NoteLine mark="warn" role="alert">
      Couldn&apos;t carry your files to {failedName} in this browser.{" "}
      <a href={failedHref!} className="text-fg underline underline-offset-4">
        Open {failedName}
      </a>{" "}
      and add them there.
    </NoteLine>
  ) : pin ? (
    <NoteLine mark="warn">{renderPin(pin)}</NoteLine>
  ) : slotNote ? (
    <ul aria-label="About your files">
      <li>
        <NoteLine mark="warn">{renderNote(slotNote)}</NoteLine>
      </li>
    </ul>
  ) : (
    // Where the files are, said again at the moment of choosing — the
    // desk's own promise, in its own words.
    <NoteLine mark="ok">
      Still only in this browser. Nothing uploads until you start a Secure
      worker or AI step.
    </NoteLine>
  );

  return (
    <TicketFrame
      chunk={TICKET_CHUNK_MARKER}
      headingId={headingId}
      actions={
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
            {variant === "dialog" ? "Close" : "Clear"}
          </button>
        </div>
      }
      summary={<Facts words={summary} />}
      files={
        <dl aria-label="Your files" className="flex flex-col">
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
              <dd className="text-faint truncate text-[11px]">
                +{hiddenFiles} more
                {hiddenUnchecked > 0 && (
                  <span> — {hiddenUnchecked} not checked here</span>
                )}
              </dd>
            </div>
          )}
        </dl>
      }
      suggestions={
        !showRows ? (
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
                    <span className="truncate text-[15px] font-medium">
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
                  omit={i === 0 && pin ? pin.fact : undefined}
                  nameOf={nameOf}
                  onLaunch={launch}
                />
              </li>
            ))}
          </ol>
        )
      }
      note={note}
      footer={
        // ONE ROW, IN THE ORDER IT IS READ: "More" (a disclosure button, its
        // rows after this row), then "Open in workspace". WAS a native
        // <details> with the workspace button absolutely placed beside its
        // summary but after it in the DOM, so with More open Tab went
        // through ~40 rows and back up 1,500px to a button drawn on the
        // first line (WCAG 2.4.3).
        <>
          {/* `overflow-hidden` lets the label give way on a narrow desk (a
              flex item's minimum is then 0). Not `min-w-0`: after `h-8` the
              numbers census reads "8 min" as a figure. */}
          {hasMore ? (
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls={moreOpen ? panelId : undefined}
              onClick={() => setMoreOpen((open) => !open)}
              className="text-muted hover:text-fg inline-flex h-8 items-center gap-1.5 overflow-hidden text-xs font-medium"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  moreOpen && "rotate-180",
                )}
                aria-hidden
              />
              {/* On the narrowest phones "for these files" is read, not
                  drawn, so the count is not what gets cut. */}
              <span className="truncate">
                More{" "}
                <span className="max-[23rem]:sr-only">
                  {more.length > 0 ? "for these files" : "about these files"}
                </span>
                {more.length > 0 && ` (${more.length})`}
              </span>
            </button>
          ) : (
            <span />
          )}
          {overflow.length === 0 && (
            <button
              type="button"
              onClick={openWorkspace}
              aria-disabled={busy || undefined}
              aria-busy={launching === "workspace" || undefined}
              className="text-muted hover:text-fg inline-flex h-8 shrink-0 items-center gap-1.5 text-xs font-medium transition-colors"
            >
              {launching === "workspace" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <FolderInput className="size-3.5" aria-hidden />
              )}
              Open in workspace
            </button>
          )}
        </>
      }
      after={
        hasMore &&
        moreOpen && (
          <div id={panelId} className="mt-2 flex flex-col gap-3 pb-1">
            {moreNotes.length > 0 && (
              <ul
                aria-label={
                  slotNote ? "More about your files" : "About your files"
                }
                className="flex flex-col gap-1"
              >
                {moreNotes.map((n) => (
                  <li key={renderNote(n)}>
                    <NoteLine mark="warn" whole>
                      {renderNote(n)}
                    </NoteLine>
                  </li>
                ))}
              </ul>
            )}
            {groups.map(([mode, rows]) => (
              <div key={mode} className="flex flex-col gap-0.5">
                <p className="text-faint text-xs font-medium">
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
        )
      }
    />
  );
}
