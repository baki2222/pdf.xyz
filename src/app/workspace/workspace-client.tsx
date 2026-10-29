"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertTriangle,
  Clock,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderInput,
  FolderOpen,
  Layers,
  Presentation,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropDesk,
  DropSheetPick,
  type SheetTarget,
} from "@/components/upload/drop-desk";
import { HANDOFF_LIFETIME } from "@/lib/handoff/lifetime";
import { originPhrase } from "@/lib/handoff/origin";
import { factWords, type FactWord } from "@/lib/intent/fact-words";
import { cn, formatBytes } from "@/lib/utils";
import {
  FILE_FAMILIES,
  type FileFamily,
  type WorkspaceAction,
  type WorkspaceFile,
} from "@/lib/workspace";
import { BatchPanel } from "./batch-panel";
import { FACT_SEP } from "./fact-separator";
import type { WorkspaceToolSummary } from "./summary";
import { SuggestedTools } from "./suggested-tools";
import { useWorkspace, type WorkspaceArrival } from "./use-workspace";
import { deepLinkedToolSlug } from "./deep-link";
import {
  acceptAttribute,
  acceptHint,
} from "@/components/upload/accepted-kinds";
import { ViewTransition } from "@/components/motion/vt";

/**
 * The ranked suggestions: not part of the page's first load, so the ranking,
 * its evidence and the launch cost the empty workspace's first paint nothing
 * — but fetched as soon as the page has hydrated, so files rarely arrive
 * before it.
 *
 * WAS `lazy()` under `<Suspense>`, fetched only when the first file was
 * staged: its fallback painted on nearly every staging, and a lazy component
 * suspends once even when its module is already loaded. Held in state, a
 * component that has loaded renders at once.
 */
type Suggestions = typeof import("./file-suggestions").default;
let suggestionsLoaded: Suggestions | null = null;

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

const ACCEPT = acceptAttribute();

/**
 * The workspace is its page's drop target: it stages anything it can read
 * and lists what it cannot ("couldn't be staged"), so it takes every file
 * the page is handed, whatever its kind.
 */
const WORKSPACE_TARGET: SheetTarget = {
  name: "the workspace",
  verb: "add",
  takes: () => true,
};

const noSubscription = () => () => {};

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

type FactChip = FactWord;

interface MetaFact extends FactChip {
  /** A measurement, set in the figure face: size and page count. */
  figure: boolean;
}

/** A staged file's line of facts: size, pages, then what was measured. */
function metaFacts(file: WorkspaceFile, chips: FactChip[]): MetaFact[] {
  const facts: MetaFact[] = [
    { text: formatBytes(file.size), tone: "muted", figure: true },
  ];
  if (typeof file.pageCount === "number")
    facts.push({
      text: `${file.pageCount} ${file.pageCount === 1 ? "page" : "pages"}`,
      tone: "muted",
      figure: true,
    });
  return [...facts, ...chips.map((chip) => ({ ...chip, figure: false }))];
}

/**
 * What this tab found in a staged file, as short chips beside its size. The
 * words are `factWords`'s (`@/lib/intent/fact-words`), shared with the home
 * page's ticket so the two never describe one file two ways.
 */
function factChips(file: WorkspaceFile): FactChip[] {
  return factWords(file.facts ?? null);
}

/** A file-type chip in the summary: "PDF · 2". */
const FAMILY_CHIP =
  "border-line bg-wash text-muted rounded-tag border px-2 py-0.5 text-[11px] font-medium";

const CHIP_TONE: Record<FactChip["tone"], string> = {
  faint: "text-faint",
  muted: "text-muted",
  warn: "text-warn",
};

/**
 * The interactive local workspace command center. Files are staged in browser
 * memory and measured in this tab (never uploaded); a guarded localStorage
 * bridge remembers only tool choices + a name-free activity log. Suggestions,
 * the batch queue and every hand-off are derived from that in-memory state.
 */
export function WorkspaceClient({
  tools,
  popular,
}: {
  tools: WorkspaceToolSummary[];
  popular: WorkspaceToolSummary[];
}) {
  // `?tool=` is read here, after hydration — the server snapshot is "" so the
  // prerendered page is the plain workspace. See `deepLinkedToolSlug`.
  const search = useSyncExternalStore(
    noSubscription,
    () => window.location.search,
    () => "",
  );
  const preselected = useMemo(
    () => deepLinkedToolSlug(search, tools),
    [search, tools],
  );
  const ws = useWorkspace(tools, preselected);
  const { state, rejected } = ws;
  const { addFiles } = ws;
  const onFiles = useCallback(
    (files: File[]) => void addFiles(files),
    [addFiles],
  );

  const [FileSuggestions, setFileSuggestions] = useState(
    () => suggestionsLoaded,
  );
  const staged = state.files.length > 0;
  useEffect(() => {
    if (FileSuggestions) return;
    let alive = true;
    // A failed fetch is tried again when files are first staged.
    import("./file-suggestions").then(
      (m) => {
        suggestionsLoaded = m.default;
        if (alive) setFileSuggestions(() => m.default);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [staged, FileSuggestions]);

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
  const suggestionProps = {
    files: state.files,
    summaries: tools,
    preselected,
    launchingSlug: ws.launchingSlug,
    launchFailedSlug: ws.launchFailedSlug,
    onLaunch: ws.launchSuggestion,
  };
  /**
   * One suggestions slot's content; only the aside's speaks the summary.
   * Until the suggestions have loaded (files picked before hydration, or a
   * slow network) the tools panel stays: it is the same box, so the swap
   * moves nothing, and the placeholder lives with the suggestions instead
   * of in every visit's first load.
   */
  const slot = (announce?: boolean) =>
    hasFiles && FileSuggestions ? (
      <FileSuggestions {...suggestionProps} announce={announce} />
    ) : (
      <SuggestedTools
        summaries={tools}
        popular={popular}
        preselected={preselected}
        onOpen={ws.openTool}
      />
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-start">
      {/* ── Staging + batch column ──
          min-w-0 on both grid children: a grid item's min-width is auto, so
          a staged file's long name (nowrap, even when truncated) would widen
          the column past the screen — 428px of page at 390 (review,
          2026-10-09). */}
      <div className="flex min-w-0 flex-col gap-6">
        <div className="border-line bg-panel rounded-panel flex flex-col gap-5 border p-5 sm:p-7">
          {/* The drop panel: the one drop primitive, and the page's target —
              a file dropped or pasted anywhere on the workspace is staged
              here, and one it cannot read says so below, like any other. */}
          <ViewTransition name="work-sheet">
            <DropDesk
              accept={ACCEPT}
              multiple
              onFiles={onFiles}
              pageTarget={WORKSPACE_TARGET}
            >
              {(api) => (
                <>
                  <DropSheetPick
                    className={cn(
                      "rounded-sheet relative flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-10 text-center transition-colors duration-200",
                      "has-[:focus-visible]:border-accent/40 has-[:focus-visible]:bg-accent/10 has-[:focus-visible]:ring-accent/50 has-[:focus-visible]:ring-2",
                      "border-line-strong bg-wash group-data-[armed]/sheet:border-accent/40 group-data-[over]/sheet:bg-accent/10",
                    )}
                  >
                    <span className="text-muted group-data-[armed]/sheet:text-accent grid size-14 place-items-center transition-colors">
                      <UploadCloud
                        className="size-7"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-fg text-base font-semibold">
                        Drop files here, or{" "}
                        <span className="text-accent underline underline-offset-4">
                          browse
                        </span>
                      </span>
                    </span>
                  </DropSheetPick>
                  {/* The size limits, one press away, as on the home page's
                    desk (owner, 2026-10-23: the box printed all four).
                    Still the picker's description, read from the closed
                    disclosure; outside the label, so opening it does not
                    open the picker. */}
                  <details className="text-muted mt-2 text-xs">
                    <summary className="hover:text-fg w-fit cursor-pointer py-1">
                      File limits
                    </summary>
                    <p id={api.hintId} className="pb-1 leading-snug">
                      {acceptHint()}
                    </p>
                  </details>
                </>
              )}
            </DropDesk>
          </ViewTransition>

          {ws.arrival && (
            <ArrivalNote arrival={ws.arrival} onDismiss={ws.dismissArrival} />
          )}

          {/* Error state — files we declined to stage */}
          {rejected.length > 0 && (
            <div
              role="alert"
              className="border-warn/40 bg-warn/10 rounded-ctl flex flex-col gap-2 border p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-warn inline-flex items-center gap-1.5 text-sm font-medium">
                  <AlertTriangle className="size-4" aria-hidden />
                  {rejected.length} file{rejected.length === 1 ? "" : "s"}{" "}
                  couldn&apos;t be staged
                </span>
                <button
                  type="button"
                  onClick={ws.dismissRejected}
                  className="text-warn hover:bg-wash hover:text-fg rounded-ctl grid size-6 place-items-center transition"
                  aria-label="Dismiss"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
              {/* A rejected file is named; a name with no break opportunity
                  breaks anywhere rather than run off the panel. */}
              <ul className="text-warn flex flex-col gap-1 text-xs wrap-anywhere">
                {rejected.map((r, i) => (
                  <li key={`${r.name}-${i}`}>
                    <span className="text-warn font-medium">{r.name}</span> —{" "}
                    {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Staged files or the empty state */}
          {hasFiles ? (
            <ul
              className="flex flex-col gap-2"
              aria-label="Staged files"
              data-slot="staged-files"
            >
              {state.files.map((file) => {
                const Icon = FAMILY_ICON[file.family];
                const chips = factChips(file);
                return (
                  <li
                    key={file.id}
                    className="bg-panel border-line rounded-ctl flex items-center gap-3 border px-3 py-2.5 motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:starting:-translate-y-1 motion-safe:starting:opacity-0"
                  >
                    <span className="bg-wash text-accent rounded-panel grid size-9 shrink-0 place-items-center">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-fg truncate text-sm">
                        {file.name}
                      </span>
                      {/* Inline flow, not flex: each fact is unbreakable and
                          keeps its dot, so a line breaks only BETWEEN facts —
                          never inside "4 form fields", never before a dot —
                          and the badge keeps the first line. On a phone the
                          measured facts wrap to a second line, so it is
                          held from the start: "measuring…" becomes the
                          facts without the row growing (review, 2026-10-09:
                          the rows grew and the suggestions below moved). */}
                      <span
                        data-facts=""
                        className="figure text-muted min-w-0 text-[11px] leading-relaxed max-sm:min-h-[2lh]"
                      >
                        <span className="border-line bg-wash text-muted rounded-tag inline-block border px-1 py-px align-[1px] font-sans text-[10px] leading-none font-semibold tracking-wide uppercase">
                          {file.kind}
                        </span>{" "}
                        {metaFacts(file, chips).map((fact, i, all) => (
                          <Fragment key={`${i}-${fact.text}`}>
                            <span className="whitespace-nowrap">
                              <span
                                className={cn(
                                  CHIP_TONE[fact.tone],
                                  !fact.figure && "font-sans",
                                )}
                              >
                                {fact.text}
                              </span>
                              {i < all.length - 1 && FACT_SEP.trimEnd()}
                            </span>
                            {i < all.length - 1 && " "}
                          </Fragment>
                        ))}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => ws.removeFile(file.id)}
                      aria-label={`Remove ${file.name}`}
                      className="text-muted hover:bg-wash hover:text-fg rounded-ctl grid size-7 shrink-0 place-items-center transition"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="border-line bg-wash rounded-panel flex flex-col items-center gap-1 border border-dashed px-6 py-8 text-center">
              <p className="text-muted text-sm font-medium">No files yet</p>
              <p className="text-muted max-w-sm text-xs">
                Add files above to see the tools that fit them. Nothing is
                uploaded.
              </p>
            </div>
          )}

          {/* Summary + actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-muted inline-flex items-center gap-1.5 text-xs">
                <ShieldCheck className="text-ok size-3.5" aria-hidden />
                {hasFiles ? (
                  <span>
                    {state.files.length} file
                    {state.files.length === 1 ? "" : "s"} ·{" "}
                    {formatBytes(totalBytes)} — kept in this browser only.
                  </span>
                ) : (
                  <span>Files stay in this browser. Nothing is uploaded.</span>
                )}
              </p>
              {familyChips.length > 0 ? (
                <ul
                  data-chips=""
                  className="flex flex-wrap gap-1.5"
                  aria-label="File types staged"
                >
                  {familyChips.map(({ family, count }) => (
                    <li key={family} className={FAMILY_CHIP}>
                      {FAMILY_LABEL[family]} · {count}
                    </li>
                  ))}
                </ul>
              ) : (
                // The chips' line, held before any file: the first drop then
                // changes the summary's words, not its height. Scrolled past
                // the drop zone, the browser anchors on the summary and keeps
                // it still while the staged list grows above it; a summary
                // that grew too pushed the phone's suggestions slot 28px
                // (CLS 0.04, measured 2026-10-09 with this line removed).
                <span
                  data-chips=""
                  aria-hidden
                  className={cn(FAMILY_CHIP, "invisible self-start")}
                >
                  PDF · 0
                </span>
              )}
            </div>
            {/* Clear all keeps its place while there is nothing to clear
                (invisible: out of the tab order and the accessibility tree),
                so the first file shows it without moving Add files; the row
                sits at the end at every width. WAS inserted by the drop: Add
                files jumped 116px across, and at 1280 that jump set the
                distance for the 6px the staged list pushes the page under
                it — CLS 0.0097 against 0.0005 now (measured 2026-10-09). */}
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={ws.clearFiles}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  !hasFiles && "invisible",
                )}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Clear all
              </button>
              <button
                type="button"
                // The drop panel is this page's target, so "Open files"
                // and this open the same picker — the panel's own. The
                // registry is not in the page's first load; by a click it
                // is here (the panel registered through it on mount), and a
                // picker opened within the click's activation still opens.
                onClick={() =>
                  void import("@/lib/intent/page-target").then((registry) =>
                    registry.requestFilePick(),
                  )
                }
                className={buttonVariants({ variant: "outline", size: "md" })}
              >
                Add files
              </button>
            </div>
          </div>
        </div>

        {/* On a phone the suggestions follow the files, before the batch;
            on a wide screen the aside holds them. One copy is display:none
            at any width, so assistive technology meets exactly one. The
            slot is there before any file is (popular tools, the same box),
            so the first file swaps its words instead of pushing the batch
            down — 0.42 of CLS at 390 when it appeared then. */}
        <div data-slot="suggestions" className="lg:hidden">
          {slot()}
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
          launchFailedSlug={ws.launchFailedSlug}
        />
      </div>

      {/* ── Tools + activity column ── */}
      <aside className="flex min-w-0 flex-col gap-6">
        <div data-slot="suggestions" className="max-lg:hidden">
          {slot(true)}
        </div>

        <RecentActivity
          actions={state.recentActions}
          hydrated={ws.hydrated}
          now={ws.now}
          onClearSession={ws.clearSession}
        />

        <div className="border-ok/40 bg-ok/10 text-muted rounded-panel flex items-start gap-2 border p-4 text-xs leading-relaxed">
          <ShieldCheck className="text-ok mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex flex-col gap-2">
            <p>
              Browser tools never upload. Staged files live in this tab&apos;s
              memory and go when you close it. What the workspace remembers on
              this device is your tool choices — never a file, its name or its
              contents.
            </p>
            <p>{HANDOFF_LIFETIME}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** What arrived from another page, said where the files are. */
function ArrivalNote({
  arrival,
  onDismiss,
}: {
  arrival: WorkspaceArrival;
  onDismiss: () => void;
}) {
  const loaded = arrival.kind === "loaded";
  return (
    <p
      role="status"
      className={cn(
        "rounded-ctl flex flex-wrap items-center gap-x-1.5 gap-y-1 border px-3 py-2 text-xs",
        loaded
          ? "border-ok/40 bg-ok/10 text-ok"
          : "border-warn/40 bg-warn/10 text-warn",
      )}
    >
      {loaded ? (
        <FolderInput className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>
        {loaded
          ? `${originPhrase(arrival.origin, {
              count: arrival.count,
              fileName: null,
              fromName: null,
            })} Still in this browser; nothing was uploaded.`
          : "That hand-off expired or was already used. Add your files below — nothing was uploaded."}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="hover:bg-wash rounded-ctl ml-auto px-2 py-0.5 transition"
      >
        Dismiss
      </button>
    </p>
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
      className="bg-panel border-line rounded-panel flex flex-col gap-3 border p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="activity-heading"
          className="text-fg inline-flex items-center gap-1.5 text-sm font-semibold"
        >
          <Clock className="text-muted size-4" aria-hidden />
          Recent activity
        </h2>
        {canClear && (
          <button
            type="button"
            onClick={onClearSession}
            className="text-muted hover:bg-wash hover:text-fg rounded-ctl inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-xs font-medium transition"
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
            <li key={i} className="bg-wash rounded-panel h-9 animate-pulse" />
          ))}
        </ul>
      ) : actions.length === 0 ? (
        <p className="text-muted text-xs">
          Tools you open from here show up as your recent activity.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {actions.map((action) => {
            const Icon = activityIcon(action.kind);
            return (
              <li
                key={action.id}
                className="border-line bg-wash rounded-panel flex items-center gap-2.5 border px-2.5 py-1.5"
              >
                <Icon className="text-muted size-3.5 shrink-0" aria-hidden />
                <span className="text-muted min-w-0 flex-1 truncate text-xs">
                  {action.label}
                </span>
                <span className="text-muted shrink-0 text-[11px] tabular-nums">
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
