"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import {
  BookOpen,
  FileX,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { categories, toolCount, tools } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { categoryHref } from "@/lib/tools/category-href";
import { familyIdOf } from "@/lib/tools/family-id";
import { toolFamilies } from "@/lib/tools/families";
import { toolAcceptsFormat, type Format } from "@/lib/intent/formats";
import type { SearchMode } from "@/lib/intent/search";
import type { UnsupportedAnswer } from "@/lib/intent/unsupported";
import type { ToolRanking } from "@/lib/tools/search-tools";
import {
  filterMatches,
  parseToolsQuery,
  toolsSearch,
  type ToolsFilter,
  type ToolsQuery,
} from "@/lib/tools/tools-query";
import {
  RUNS_COPY,
  type RunsChoice,
  type RunsFilter,
} from "@/lib/tools/where-it-runs";
import { ToolCardView } from "@/components/tools/tool-card-view";
import { ModeShape } from "@/components/tools/processing-badge";
import { FILTER_CHIP, FamilySwatch } from "@/components/tools/family-tile";
import { announceLocation } from "@/lib/location-search";
import { cn } from "@/lib/utils";
import { VIEW_TRANSITIONS } from "@/lib/motion/view-transitions";

/**
 * The category chips: the home page's families ("Convert" is both convert
 * categories), so the two pages offer one set of chips in one look.
 */
const families = toolFamilies();

/**
 * The checkbox for the never-uploads choice, in a visitor's words: the
 * property its members own (`RUNS_COPY["never-uploads"].many`, "always keep
 * your files on your device"), said as a filter.
 */
export const KEEP_LOCAL_LABEL = "Only tools that keep files on your device";

/** How long typing must pause before the result count is announced. */
export const ANNOUNCE_DELAY_MS = 400;

const noSubscription = () => () => {};

/** No "Where it runs" choices: the filter is not offered. */
const NO_RUNS: readonly RunsChoice[] = [];

/** A tool's glyph by slug, drawn by the server page. */
export type ToolIcons = Readonly<Record<string, ReactNode>>;
const NO_ICONS: ToolIcons = {};

/**
 * The chip row: a single sideways-scrolling line on a phone (the chips snap,
 * and the ends fade inside the gutter so the first chip is never dimmed),
 * wrapping from `sm` — the home page's chips, in the home page's class.
 *
 * A row that scrolls also CLIPS, at its padding box. It used to be exactly
 * as tall as a chip, so a focused chip's indicator — drawn outside it — lost
 * its top and bottom and showed as two faint vertical edges (WP-06 review,
 * 2026-10-10). On a phone the row now has 6px above and below its chips,
 * taken back by a negative margin so nothing under it moves; the site's
 * focus outline reaches 4px. Its scroll-padding is 1.5rem, the 1.25rem fade
 * plus that outline, so a chip scrolled to by {@link revealInRow} — or by
 * the browser — stops clear of the fade, its outline whole; its end padding
 * is 1.5rem too, or the last chip could never be scrolled that far in —
 * and so is its START padding: with no label leading the row, "All" sat at
 * 1.25rem, under the fade and 4px inside the inset (measured 2026-10-23).
 * `e2e/tools-filter-focus.spec.ts` measures both, at 390 and 1440.
 *
 * WAS two rows, each behind a mono capital label: "WHERE IT RUNS" (four
 * radios: Never uploads, Browser-first, Secure worker, AI) and "CATEGORY"
 * (eight chips). A visitor does not choose a tool by its infrastructure
 * (owner, 2026-10-23); the one choice a visitor does make — keep my files
 * on my device — is a plain checkbox under the chips now.
 */
const FILTER_ROW =
  "-mx-5 flex snap-x snap-proximity scroll-px-6 items-center gap-2 overflow-x-auto pr-6 pl-6 [scrollbar-width:none] max-sm:-my-1.5 max-sm:py-1.5 max-sm:[mask-image:linear-gradient(to_right,transparent,#000_1.25rem,#000_calc(100%-1.25rem),transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden";
/** A chip in the row: the home page's chip, and a snap point. */
const CHIP = cn(FILTER_CHIP, "snap-start");
const chipCount =
  "text-faint group-aria-pressed:text-fg-invert/70 text-xs tabular-nums";

/**
 * Scroll a filter row SIDEWAYS so `control` is wholly in view, clear of the
 * row's inset (its scroll-padding). Never vertically: the row's own
 * `scrollLeft` is set, so the page stays where the reader left it.
 *
 * Nearest, and home when it can be: a control already in view leaves the row
 * alone; one out of view that would be in view with the row unscrolled sends
 * the row back to its start, so the label shows again; any other is brought
 * just far enough in. A row that does not scroll (from `sm`, it wraps) is
 * left alone.
 *
 * WHY (WP-06 review, 2026-10-10): before WP-06 the chips wrapped, so the
 * pressed one was always on screen. As one sideways line, a deep link's
 * choice sat off a 390px screen — `?runs=ai` at x=680, `?category=ai` at
 * 884 — while "All" and "All tools" looked unselected over a filtered grid;
 * and a chip reached by Tab near the edge stayed half off it, under the
 * fade ("To PDF" at x=321..406). `e2e/tool-layout.mobile.spec.ts` holds the
 * first for every choice, `e2e/tools-filter-focus.spec.ts` the second.
 */
export function revealInRow(control: Element | null): void {
  const row = control?.closest<HTMLElement>("[data-filter-row]");
  if (!control || !row || row.scrollWidth <= row.clientWidth) return;
  const style = getComputedStyle(row);
  const insetStart = parseFloat(style.scrollPaddingLeft) || 0;
  const insetEnd = parseFloat(style.scrollPaddingRight) || 0;
  const rowBox = row.getBoundingClientRect();
  /** An element's extent in the row's scroll coordinates. */
  const extent = (el: Element) => {
    const box = el.getBoundingClientRect();
    const start = box.left - rowBox.left - row.clientLeft + row.scrollLeft;
    return { start, end: start + box.width };
  };
  const { start, end } = extent(control);
  const max = row.scrollWidth - row.clientWidth;
  const fits = (scrollLeft: number) =>
    start - scrollLeft >= insetStart - 0.5 &&
    end - scrollLeft <= row.clientWidth - insetEnd + 0.5;
  if (fits(row.scrollLeft)) return;
  if (fits(0)) {
    row.scrollLeft = 0;
    return;
  }
  // Land ON a snap position: the row snaps (proximity), so a position
  // between two would be moved after the scroll — measured, by up to 12px,
  // back under the edge. The snap positions are each snapping child's start
  // at the inset, and the row's two ends; the nearest one that shows the
  // control whole wins.
  const positions = [0, max];
  for (const el of row.querySelectorAll(":scope > *, :scope > * > *"))
    if (getComputedStyle(el).scrollSnapAlign !== "none")
      positions.push(Math.min(max, Math.max(0, extent(el).start - insetStart)));
  const showing = positions.filter(fits);
  const next = showing.length
    ? showing.reduce((best, p) =>
        Math.abs(p - row.scrollLeft) < Math.abs(best - row.scrollLeft)
          ? p
          : best,
      )
    : Math.min(Math.max(0, end - (row.clientWidth - insetEnd)), max);
  row.scrollLeft = next;
}

/** What the explorer needs from the search engine chunk. */
export interface SearchEngine {
  readonly rankTools: (query: string) => ToolRanking;
  readonly SEARCH_ENGINE_CHUNK: string;
}

/**
 * The ranked search, fetched when it is first needed — a query in the URL, a
 * pointer or focus on the search field, a keystroke — never with the page.
 */
const loadSearchEngine = (): Promise<SearchEngine> =>
  import("@/lib/tools/search-tools");

/** What the search made of the query, beyond the count. */
export interface ResultOutcome {
  readonly mode?: SearchMode;
  /** The unsupported-format answer's headline, when there is one. */
  readonly unsupported?: string | null;
  /**
   * How many of the query's matches the filters removed. `0` says the query
   * matches nothing at all, so no filter is to blame and none is named; left
   * out, it is unknown, and every filter that is on gets named.
   */
  readonly hidden?: number;
  /** The search engine never arrived: the grid is not an answer to the query. */
  readonly searchFailed?: boolean;
}

/**
 * The category filter's name — a category's, or a family's chip label — or
 * undefined for every category.
 */
function categoryName(id: ToolsFilter): string | undefined {
  if (id === "all") return undefined;
  return (
    categories.find((c) => c.id === id)?.name ??
    families.find((f) => f.id === id)?.label
  );
}

/**
 * The filters, said as what the tools they leave DO: "take DOCX", "always
 * keep your files on your device". One tool or many, so a sentence can
 * agree with its count. The category is not a verb; callers add " in
 * Organize". A denial says the same words of the tools a filter HID, so each
 * must be false of every tool outside its filter (see `RUNS_COPY`).
 */
function filterVerbs(
  n: number,
  accepts: Format | null,
  runs: RunsFilter,
): string[] {
  const verbs: string[] = [];
  if (accepts) verbs.push(`${n === 1 ? "takes" : "take"} ${accepts}`);
  if (runs !== "all")
    verbs.push(n === 1 ? RUNS_COPY[runs].one : RUNS_COPY[runs].many);
  return verbs;
}

/** "The filter hides 1 match", "The filters hide 3 closest matches". */
export function hiddenMatches(
  hidden: number,
  filters: number,
  mode?: SearchMode,
): string {
  const what = `${hidden} ${mode === "closest" ? "closest " : ""}${hidden === 1 ? "match" : "matches"}`;
  return filters === 1
    ? `The filter hides ${what}`
    : `The filters hide ${what}`;
}

/**
 * The words a screen reader hears after the grid changes. One sentence for
 * every state, including the empty one — "No tools found" used to be a plain
 * div that mounted silently (WCAG 4.1.3) — and it says which KIND of answer
 * this is: the best matches, only the closest ones, the tools that take a
 * format, or no answer at all because search could not load.
 *
 * It names a filter wherever the filter shaped the answer. "No tools match
 * “merge”" used to be read out with Takes DOCX on, while Merge PDF matched
 * every word — the filter had removed it, and only the category filter was
 * ever named. An empty list now says which filter emptied it and how many
 * matches it hid; a query that matches nothing at all says so plainly.
 * "Where it runs" is said the same way, as a verb beside "take DOCX": "29
 * tools always keep your files on your device", "No tools run on a secure
 * worker in AI Tools".
 */
export function resultAnnouncement(
  count: number,
  state: Pick<ToolsQuery, "category" | "query"> & {
    readonly accepts?: Format | null;
    readonly runs?: RunsFilter;
  },
  outcome: ResultOutcome = {},
): string {
  const q = state.query.trim();
  const accepts = state.accepts ?? null;
  const runs = state.runs ?? "all";
  const category = categoryName(state.category);
  const inCategory = category ? ` in ${category}` : "";
  const filters =
    (accepts ? 1 : 0) + (category ? 1 : 0) + (runs !== "all" ? 1 : 0);
  /** " that take DOCX and use AI", or "" with no such filter. */
  const that = (n: number) => {
    const verbs = filterVerbs(n, accepts, runs);
    return verbs.length ? ` that ${verbs.join(" and ")}` : "";
  };
  /** "take DOCX and use AI", or "". */
  const bare = (n: number) => filterVerbs(n, accepts, runs).join(" and ");
  const prefix = outcome.unsupported ? `${outcome.unsupported} ` : "";
  const noun = count === 1 ? "tool" : "tools";
  if (q && outcome.searchFailed) {
    return `Search could not load. Showing ${filters ? "" : "all "}${count} ${noun}${that(count)}${inCategory}`;
  }
  if (count === 0) {
    if (q) {
      if (filters === 0 || outcome.hidden === 0) {
        return `${prefix}No tools match “${q}”`;
      }
      const none = bare(0)
        ? `No tools for “${q}” ${bare(0)}${inCategory}`
        : `No tools match “${q}”${inCategory}`;
      return outcome.hidden
        ? `${prefix}${none}. ${hiddenMatches(outcome.hidden, filters, outcome.mode)}`
        : `${prefix}${none}`;
    }
    return bare(0)
      ? `${prefix}No tools ${bare(0)}${inCategory}`
      : `${prefix}No tools found`;
  }
  if (q && outcome.mode === "closest") {
    return `${prefix}No tool matches every word of “${q}”. ${count} closest ${count === 1 ? "match" : "matches"}${that(count)}${inCategory}`;
  }
  if (q) {
    return `${prefix}${count} ${noun} for “${q}”${that(count)}${inCategory}`;
  }
  if (bare(count)) {
    return `${prefix}${count} ${noun} ${bare(count)}${inCategory}`;
  }
  return `${prefix}${count} ${noun}${inCategory}`;
}

/**
 * The tool catalogue's search-and-filter grid.
 *
 * PRERENDERED WITH EVERY TOOL. `/tools` never reads `searchParams` on the
 * server, so its static HTML is the unfiltered grid — every tool link, every
 * category heading — that a crawler reads without running script
 * (`ssr-content.test.ts` holds it). `?category=`, `?q=` and `?accepts=` are
 * applied after hydration from `window.location` (see `parseToolsQuery`);
 * until the reader touches a control, the URL is left exactly as they
 * arrived with.
 *
 * RANKED. A query runs the ranked search (`@/lib/intent/search`): synonyms,
 * one-edit misspellings, the order the words were typed in. The heading says
 * which answer it is — "Best matches", or "Closest matches" when no tool has
 * every word — and a format nothing here opens (HEIC, WebP…) gets its own
 * answer first, with the tool that takes the format to save a copy as.
 *
 * HEADINGS. Grouped under an `<h2>` per category (each linking that
 * category's landing page) when there is no query; a query shows one ranked
 * list under its own `<h2>`. Either way every card's `<h3>` sits under an
 * `<h2>` — the page used to jump from its `<h1>` straight to fifty `<h3>`s.
 * A heading that echoes the query can break anywhere, so a pasted filename
 * wraps instead of widening the page (`e2e/tools-search.spec.ts`, at 360px).
 *
 * WHILE THE ENGINE LOADS. A query that arrives before the search chunk — a
 * shared `/tools?q=heic`, or a keystroke on a slow connection — shows the
 * served grid dimmed under "Searching for “heic”…", and the count claims no
 * number. It used to show the whole catalogue under its category headings
 * with "50 tools" beside the query: the unfiltered grid, presented as the
 * answer to "heic".
 *
 * NOTHING THE SERVER PAINTED MOVES. A deep link replaces the served
 * catalogue after hydration, so the results region is keyed on what it shows
 * (the filters and the phase): a new answer mounts as a new tree instead of
 * dragging the server's surviving cards up the page, and the region keeps at
 * least a viewport of height, so the guides and the footer below never rise
 * into view as fifty tools become one. The count leads its row, and on a
 * wide screen the row runs from the far edge, so the count holds its place
 * and the "Takes DOCX" chip lands beside it in a row whose height is already
 * reserved. `e2e/layout-stability.spec.ts` holds `?accepts=docx` and
 * `?q=merge` to its CLS bound at desktop and phone widths; before this they
 * measured 0.2699 (0.3669 at 390px) and 0.0546.
 */
export function ToolsExplorer({
  loadEngine = loadSearchEngine,
  runs: runsChoices = NO_RUNS,
  icons = NO_ICONS,
}: {
  /** The engine loader; a test seam for a chunk that fails to load. */
  loadEngine?: () => Promise<SearchEngine>;
  /**
   * The "Where it runs" choices and their members, computed on the server
   * from the one partition (`whereItRuns(processingSplit())` in
   * `app/tools/page.tsx`) and handed over as slugs. Without them there is
   * no "Where it runs" filter, and a `?runs=` link shows every tool.
   */
  runs?: readonly RunsChoice[];
  /**
   * Each tool's glyph by slug, drawn on the server by `app/tools/page.tsx`.
   * Drawing them here would ship the icon registry (~50 lucide glyphs) to
   * this page; `tool-card.test.tsx` holds that every card gets its own.
   */
  icons?: ToolIcons;
} = {}) {
  // The server snapshot is "" — the prerendered, unfiltered grid. On the
  // client React re-renders once with the real query string after hydration.
  const location = useSyncExternalStore(
    noSubscription,
    () => window.location.search,
    () => "",
  );
  const linked = useMemo(() => parseToolsQuery(location), [location]);
  // `null` until the reader changes something: the deep link rules until then.
  const [chosen, setChosen] = useState<ToolsQuery | null>(null);
  const state = chosen ?? linked;
  const { category: active, query, accepts } = state;
  const runsMembers = useMemo(
    () =>
      new Map(runsChoices.map((choice) => [choice.id, new Set(choice.slugs)])),
    [runsChoices],
  );
  // A choice this page does not offer is every tool, never an empty grid.
  const runs: RunsFilter =
    state.runs !== "all" && runsMembers.has(state.runs) ? state.runs : "all";
  const update = (patch: Partial<ToolsQuery>) =>
    setChosen({ ...state, ...patch });
  /**
   * A chip or a radio refilters with a view transition when the layer is
   * built in (M23): each card keeps its name across the change, so it moves
   * rather than blinks. Typing never does (M24), and reduced motion never.
   */
  const refilter = (patch: Partial<ToolsQuery>) => {
    if (
      VIEW_TRANSITIONS &&
      typeof document.startViewTransition === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      document.startViewTransition(() => flushSync(() => update(patch)));
    else update(patch);
  };
  const searchField = useRef<HTMLInputElement>(null);
  /** Change the filters from a control that the change removes. */
  const updateAndRefocus = (next: ToolsQuery) => {
    setChosen(next);
    searchField.current?.focus();
  };

  // Keep the URL shareable without triggering a navigation. Skipped until the
  // reader acts, so first paint cannot strip a deep link.
  useEffect(() => {
    if (!chosen) return;
    const qs = toolsSearch(window.location.search, chosen);
    window.history.replaceState(null, "", `${window.location.pathname}${qs}`);
    // The header's links read the query too ("AI tools" on ?category=ai).
    announceLocation();
  }, [chosen]);

  // The engine arrives on demand. Until it does, a query shows the grid as
  // served under a line that says the search is running — not a guess at a
  // ranking, and not the grid as if it were the answer — and nothing is
  // announced.
  const [engine, setEngine] = useState<SearchEngine | null>(null);
  const [engineFailed, setEngineFailed] = useState(false);
  const requested = useRef(false);
  const requestEngine = useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    loadEngine().then(setEngine, () => setEngineFailed(true));
  }, [loadEngine]);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed) requestEngine();
  }, [trimmed, requestEngine]);

  const ranking = useMemo(
    () => (trimmed && engine ? engine.rankTools(trimmed) : null),
    [trimmed, engine],
  );
  /** What the results region is showing for the query. */
  const phase = !trimmed
    ? "browse"
    : ranking
      ? "ranked"
      : engineFailed
        ? "failed"
        : "pending";
  const pending = phase === "pending";
  const mode: SearchMode = ranking?.mode ?? "all";
  const answer = ranking?.answer ?? null;
  const near = ranking?.near ?? [];

  const results = useMemo(
    () =>
      (ranking?.ranked ?? tools).filter(
        (tool) =>
          filterMatches(tool.category, active) &&
          (accepts === null || toolAcceptsFormat(tool.accept, accepts)) &&
          (runs === "all" || Boolean(runsMembers.get(runs)?.has(tool.slug))),
      ),
    [ranking, active, accepts, runs, runsMembers],
  );
  // Matches the filters removed: only ever non-zero when they removed all.
  const hidden = ranking && results.length === 0 ? ranking.ranked.length : 0;

  // One always-mounted live region, debounced so typing "compress" is not
  // read out letter by letter, and silent on load so the page does not open
  // by announcing "50 tools".
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!chosen || pending) return;
    const text = resultAnnouncement(
      results.length,
      { category: active, query: trimmed, accepts, runs },
      {
        mode,
        unsupported: answer?.headline ?? null,
        hidden,
        searchFailed: engineFailed,
      },
    );
    const timer = setTimeout(() => setAnnouncement(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    chosen,
    pending,
    results.length,
    active,
    trimmed,
    accepts,
    runs,
    mode,
    answer,
    hidden,
    engineFailed,
  ]);

  const groups = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          tools: results.filter((tool) => tool.category === category.id),
        }))
        .filter((group) => group.tools.length > 0),
    [results],
  );

  const filters: { id: ToolsFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: toolCount },
    ...families.map((f) => ({
      id: f.id,
      label: f.label,
      count: f.tools.length,
    })),
  ];
  /**
   * The chip a filter presses: its own, or for an old link to one convert
   * category (`?category=convert-to`) its family's — the grid then shows
   * that category alone, under its own heading.
   */
  const pressed =
    active === "all" || filters.some((f) => f.id === active)
      ? active
      : familyIdOf(active as Tool["category"]);
  /** The one "Where it runs" choice offered as a control: never uploads. */
  const keepLocal = runsChoices.find((c) => c.id === "never-uploads");

  // The active chip, brought on screen: after hydration (a deep link's
  // choice applies then) and whenever it changes.
  const categoryRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    revealInRow(
      categoryRow.current?.querySelector('[aria-pressed="true"]') ?? null,
    );
  }, [active]);

  const resultsHeading = useId();
  const pendingHeading = useId();
  const reset = () =>
    updateAndRefocus({
      category: "all",
      query: "",
      accepts: null,
      runs: "all",
    });

  const grouped = (
    <div className="flex flex-col gap-10 sm:gap-12">
      {groups.map(({ category, tools: groupTools }) => (
        <section
          key={category.id}
          aria-labelledby={`tools-group-${category.id}`}
          className="flex flex-col gap-2 sm:gap-3"
        >
          <div className="flex flex-col gap-1">
            <h2
              id={`tools-group-${category.id}`}
              className="font-display text-fg flex items-center gap-2.5 text-xl font-medium tracking-tight sm:text-2xl"
            >
              <FamilySwatch family={familyIdOf(category.id)} />
              <Link
                href={categoryHref(category.id)}
                className="hover:text-accent transition-colors"
              >
                {category.name}
              </Link>
              <span className="text-faint font-sans text-sm font-normal tracking-normal tabular-nums">
                {groupTools.length}
              </span>
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              {category.description}
            </p>
          </div>
          <ToolGrid tools={groupTools} icons={icons} />
        </section>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </p>
      {/* The field and the count share one row at every width: on a phone a
          row of its own for "50 tools" pushed the first tool 44px further
          down. A format chip from a deep link (`?accepts=`) takes the
          count's place on a phone, so it adds no row and moves nothing. */}
      <div className="flex items-center gap-3 lg:justify-between lg:gap-4">
        <label className="relative min-w-0 flex-1 lg:max-w-md">
          <Search
            className="text-muted pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            ref={searchField}
            type="search"
            value={query}
            onChange={(e) => update({ query: e.target.value })}
            onFocus={requestEngine}
            onPointerEnter={requestEngine}
            placeholder={`Search ${toolCount} tools — merge, compress, sign…`}
            aria-label="Search tools"
            // The browser's own ✕ off: "Clear search" below is the one
            // clear control (Chromium and WebKit drew both, side by side).
            className="bg-panel border-line placeholder:text-faint focus:border-accent/40 focus-visible:ring-accent/50 text-fg rounded-ctl h-12 w-full border pr-11 pl-11 text-sm transition outline-none focus-visible:ring-2 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => updateAndRefocus({ ...state, query: "" })}
              aria-label="Clear search"
              className="text-muted hover:bg-wash hover:text-fg rounded-ctl absolute top-1/2 right-3.5 grid size-6 -translate-y-1/2 place-items-center transition"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>
        {/* On a wide screen the row runs from its far edge: the count keeps
            its place and a chip from a deep link lands beside it. */}
        <div className="flex shrink-0 items-center gap-x-4 lg:flex-1 lg:flex-row-reverse">
          <p
            data-result-count
            className={cn(
              "text-muted inline-flex items-center justify-end gap-2 text-sm whitespace-nowrap max-sm:w-[4.5rem]",
              accepts && "max-sm:hidden",
            )}
          >
            <SlidersHorizontal className="size-4 max-sm:hidden" aria-hidden />
            {pending ? (
              // No number while the engine loads: the grid's count is not
              // the count for the query.
              <>
                <span aria-hidden>…</span>
                <span className="sr-only">Searching</span>
              </>
            ) : (
              // One span: the row's flex gap would otherwise also sit
              // between the number and its word ("50  tools").
              <span>
                <span className="tabular-nums">{results.length}</span>
                {results.length === 1 ? " tool" : " tools"}
              </span>
            )}
          </p>
          {accepts && (
            <button
              type="button"
              onClick={() => updateAndRefocus({ ...state, accepts: null })}
              aria-label={`Takes ${accepts}, remove this filter`}
              // The site's focus outline, as on the filter chips: this drew
              // the same half-strength ring (2.41:1) until the WP-06 review.
              className="border-line-strong bg-select text-fg hover:border-accent/60 rounded-tag inline-flex h-8 items-center gap-1.5 border pr-2 pl-3 text-sm font-medium transition-colors"
            >
              Takes {accepts}
              <X className="text-muted size-3.5" aria-hidden />
            </button>
          )}
          {/* An old `?runs=` link to a choice the page no longer offers as
              a control: said, and removable, like a format. */}
          {runs !== "all" && runs !== keepLocal?.id && (
            <button
              type="button"
              onClick={() => updateAndRefocus({ ...state, runs: "all" })}
              aria-label={`${RUNS_COPY[runs].label}, remove this filter`}
              className="border-line-strong bg-select text-fg hover:border-accent/60 rounded-tag inline-flex h-8 items-center gap-1.5 border pr-2 pl-3 text-sm font-medium whitespace-nowrap transition-colors"
            >
              {RUNS_COPY[runs].label}
              <X className="text-muted size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* The chips, then the one plain choice about where a tool runs.
          On a phone the chips are ONE line that scrolls sideways, so the
          first tool stays near the top of the screen; from `sm` they wrap.
          Every chip is focusable, so a keyboard reaches the ones
          off-screen, and each one focused is scrolled wholly into view
          (`revealInRow`) — the browser's own scroll left a chip half under
          the fade. */}
      <div className="flex flex-col gap-3">
        <div
          ref={categoryRow}
          role="group"
          aria-label="Filter tools by category"
          data-filter-row
          className={FILTER_ROW}
        >
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              data-family={filter.id}
              aria-pressed={pressed === filter.id}
              onClick={() => refilter({ category: filter.id })}
              onFocus={(e) => revealInRow(e.currentTarget)}
              className={CHIP}
            >
              {filter.id !== "all" && <FamilySwatch family={filter.id} />}
              {filter.label} <span className={chipCount}>{filter.count}</span>
            </button>
          ))}
        </div>

        {keepLocal && (
          <label className="text-muted hover:text-fg inline-flex w-fit cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={runs === keepLocal.id}
              onChange={(e) =>
                refilter({ runs: e.target.checked ? keepLocal.id : "all" })
              }
              className="accent-accent size-4 shrink-0"
            />
            <ModeShape mode={keepLocal.mode} />
            {KEEP_LOCAL_LABEL}{" "}
            <span className="text-faint text-xs tabular-nums">
              {keepLocal.slugs.length}
            </span>
          </label>
        )}
      </div>

      {/* Keyed on what it shows: see "NOTHING THE SERVER PAINTED MOVES". */}
      <div
        key={`${active}|${accepts ?? ""}|${runs}|${phase}`}
        className="flex min-h-svh flex-col gap-6"
      >
        {answer && (
          <AnswerBlock
            answer={answer}
            icons={icons}
            onShowFormat={(format) =>
              updateAndRefocus({
                category: "all",
                query: "",
                accepts: format,
                runs: "all",
              })
            }
          />
        )}

        {phase === "failed" && (
          <p
            role="note"
            className="border-line bg-wash text-muted rounded-panel border px-4 py-3 text-sm"
          >
            Search could not load. Reload the page to search, or browse the
            tools below.
          </p>
        )}

        {results.length === 0 ? (
          answer ? null : (
            <EmptyState
              query={ranking ? trimmed : ""}
              accepts={accepts}
              runs={runs}
              category={categoryName(active)}
              near={near}
              hidden={hidden}
              mode={mode}
              onReset={reset}
              onShowHidden={() =>
                updateAndRefocus({
                  ...state,
                  category: "all",
                  accepts: null,
                  runs: "all",
                })
              }
            />
          )
        ) : ranking && engine ? (
          <section
            aria-labelledby={resultsHeading}
            data-chunk={engine.SEARCH_ENGINE_CHUNK}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1">
              <h2
                id={resultsHeading}
                className="font-display text-fg text-2xl font-medium tracking-tight wrap-anywhere"
              >
                {`${mode === "closest" ? "Closest" : "Best"} matches for “${trimmed}”`}
              </h2>
              {mode === "closest" && (
                <p className="text-muted text-sm leading-relaxed">
                  No tool matches every word, so these match some of them.
                </p>
              )}
            </div>
            <ToolGrid tools={results} icons={icons} />
          </section>
        ) : pending ? (
          <section
            aria-labelledby={pendingHeading}
            aria-busy="true"
            className="flex flex-col gap-6"
          >
            <h2
              id={pendingHeading}
              className="font-display text-fg text-2xl font-medium tracking-tight wrap-anywhere"
            >
              {`Searching for “${trimmed}”…`}
            </h2>
            {/* Every link stays; dimmed, it is plainly not the answer. */}
            <div className="opacity-50">{grouped}</div>
          </section>
        ) : (
          grouped
        )}
      </div>
    </div>
  );
}

/**
 * "No tool here opens HEIC photos." — and the way in, derived from the
 * catalogue: the tool that takes the format to save a copy as, or for an
 * archive, the tools that take what is usually inside it.
 *
 * Its words are read where the reader receives them: `tools-explorer.test.tsx`
 * renders this block for every unsupported format and scans the region's
 * text, so a sentence added here is checked, not a copy of it elsewhere.
 */
function AnswerBlock({
  answer,
  icons,
  onShowFormat,
}: {
  answer: UnsupportedAnswer<Tool>;
  icons: ToolIcons;
  onShowFormat: (format: Format) => void;
}) {
  const heading = useId();
  const alt = answer.alternative;
  return (
    <section
      aria-labelledby={heading}
      className="border-line bg-wash rounded-panel flex flex-col gap-4 border p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <FileX className="text-warn mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="flex flex-col gap-1.5">
          <h2 id={heading} className="text-fg text-lg font-semibold">
            {answer.headline}
          </h2>
          {answer.how && (
            <p className="text-muted text-sm leading-relaxed">
              {alt?.kind === "tool"
                ? `${answer.how} ${alt.tool.name} takes ${alt.takes}.`
                : answer.how}
            </p>
          )}
        </div>
      </div>
      {alt?.kind === "tool" && (
        <div className={GRID}>
          <ToolCardView tool={alt.tool} icon={icons[alt.tool.slug]} />
        </div>
      )}
      {alt?.kind === "accepts" && (
        <div>
          <button
            type="button"
            onClick={() => onShowFormat(alt.format)}
            className="border-line-strong hover:bg-panel text-fg rounded-ctl border px-4 py-2 text-sm font-medium transition-colors"
          >
            Show the {alt.count} tools that take {alt.format}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Nothing to show — said in words, with a way back and a way elsewhere.
 *
 * When the query has matches and the filters removed every one, the heading
 * names the filters ("Nothing that takes DOCX matches “merge”"), says how
 * many matches they hid, and offers to show them; a query that matches
 * nothing at all is "Nothing matches “zzzz”", whatever filter is on.
 */
function EmptyState({
  query,
  accepts,
  runs,
  category,
  near,
  hidden,
  mode,
  onReset,
  onShowHidden,
}: {
  query: string;
  accepts: Format | null;
  runs: RunsFilter;
  category: string | undefined;
  near: readonly Tool[];
  /** Matches the filters removed; 0 when the query matched nothing. */
  hidden: number;
  mode: SearchMode;
  onReset: () => void;
  onShowHidden: () => void;
}) {
  const heading = useId();
  const inCategory = category ? ` in ${category}` : "";
  const filters =
    (accepts ? 1 : 0) + (category ? 1 : 0) + (runs !== "all" ? 1 : 0);
  const filtered = Boolean(query) && hidden > 0;
  /** "takes DOCX and uses AI": what the one missing tool would do. */
  const one = filterVerbs(1, accepts, runs).join(" and ");
  /** "take DOCX and use AI": what no tool here does. */
  const none = filterVerbs(0, accepts, runs).join(" and ");
  return (
    <section
      aria-labelledby={heading}
      className="border-line-strong bg-wash rounded-panel flex flex-col items-center gap-3 border border-dashed px-6 py-14 text-center"
    >
      <SearchX className="text-faint size-6" aria-hidden />
      <h2 id={heading} className="text-fg text-lg font-semibold wrap-anywhere">
        {query
          ? filtered
            ? `Nothing${inCategory}${one ? ` that ${one}` : ""} matches “${query}”`
            : `Nothing matches “${query}”`
          : none
            ? `No tools ${none}${inCategory}`
            : `No tools found${inCategory}`}
      </h2>
      {filtered && (
        <p className="text-muted text-sm">
          {`${hiddenMatches(hidden, filters, mode)}.`}
        </p>
      )}
      {near.length > 0 && (
        <p className="text-muted text-sm">
          Did you mean{" "}
          {near.map((tool, i) => (
            <span key={tool.slug}>
              {i > 0 && (i === near.length - 1 ? " or " : ", ")}
              <Link
                href={`/tools/${tool.slug}`}
                className="text-fg hover:text-accent font-medium underline underline-offset-4"
              >
                {tool.name}
              </Link>
            </span>
          ))}
          ?
        </p>
      )}
      <p className="text-muted max-w-sm text-sm">
        Try other words, or reset the filters to see all {toolCount} tools.
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        {filtered && (
          <button
            type="button"
            onClick={onShowHidden}
            className="border-line-strong hover:bg-panel text-fg rounded-ctl border px-4 py-2 text-sm font-medium transition-colors"
          >
            {`Show the ${hidden === 1 ? "match" : `${hidden} matches`}`}
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="border-line-strong hover:bg-panel text-fg rounded-ctl border px-4 py-2 text-sm font-medium transition-colors"
        >
          Reset filters
        </button>
        <Link
          href="/guides"
          className="text-muted hover:text-fg inline-flex items-center gap-1.5 px-2 py-2 text-sm font-medium transition-colors"
        >
          <BookOpen className="size-4" aria-hidden />
          Browse the guides
        </Link>
      </div>
    </section>
  );
}

/**
 * The home page's cards, in a grid: boxed, a gap between them. WAS index
 * rows, a hairline under each and no gap (until 2026-10-23).
 */
const GRID =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

function ToolGrid({
  tools: list,
  icons,
}: {
  tools: readonly Tool[];
  icons: ToolIcons;
}) {
  return (
    <div className={GRID}>
      {list.map((tool) =>
        VIEW_TRANSITIONS ? (
          <div
            key={tool.slug}
            className="grid"
            style={{ viewTransitionName: `tool-${tool.slug}` }}
          >
            <ToolCardView tool={tool} icon={icons[tool.slug]} />
          </div>
        ) : (
          <ToolCardView key={tool.slug} tool={tool} icon={icons[tool.slug]} />
        ),
      )}
    </div>
  );
}
