"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  BookOpen,
  FileX,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { categories, getCategoryCounts, toolCount, tools } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { categoryHref } from "@/lib/tools/category-href";
import { toolAcceptsFormat, type Format } from "@/lib/intent/formats";
import type { SearchMode } from "@/lib/intent/search";
import type { UnsupportedAnswer } from "@/lib/intent/unsupported";
import type { ToolRanking } from "@/lib/tools/search-tools";
import {
  parseToolsQuery,
  toolsSearch,
  type ToolsFilter,
  type ToolsQuery,
} from "@/lib/tools/tools-query";
import { ToolCard } from "@/components/tools/tool-card";
import { cn } from "@/lib/utils";

const counts = getCategoryCounts();

/** How long typing must pause before the result count is announced. */
export const ANNOUNCE_DELAY_MS = 400;

const noSubscription = () => () => {};

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
}

/**
 * The words a screen reader hears after the grid changes. One sentence for
 * every state, including the empty one — "No tools found" used to be a plain
 * div that mounted silently (WCAG 4.1.3) — and it says which KIND of answer
 * this is: the best matches, only the closest ones, or the tools that take a
 * format.
 */
export function resultAnnouncement(
  count: number,
  state: Pick<ToolsQuery, "category" | "query"> & {
    readonly accepts?: Format | null;
  },
  outcome: ResultOutcome = {},
): string {
  const q = state.query.trim();
  const accepts = state.accepts ?? null;
  const category =
    state.category === "all"
      ? undefined
      : categories.find((c) => c.id === state.category)?.name;
  const inCategory = category ? ` in ${category}` : "";
  const prefix = outcome.unsupported ? `${outcome.unsupported} ` : "";
  const noun = count === 1 ? "tool" : "tools";
  if (count === 0) {
    if (q) return `${prefix}No tools match “${q}”${inCategory}`;
    return accepts
      ? `${prefix}No tools take ${accepts}${inCategory}`
      : `${prefix}No tools found`;
  }
  if (q && outcome.mode === "closest") {
    return `${prefix}No tool matches every word of “${q}”. ${count} closest ${count === 1 ? "match" : "matches"}${inCategory}`;
  }
  if (q) {
    return `${prefix}${count} ${noun} for “${q}”${accepts ? ` that take ${accepts}` : ""}${inCategory}`;
  }
  if (accepts) {
    return `${prefix}${count} ${noun} ${count === 1 ? "takes" : "take"} ${accepts}${inCategory}`;
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
 */
export function ToolsExplorer({
  loadEngine = loadSearchEngine,
}: {
  /** The engine loader; a test seam for a chunk that fails to load. */
  loadEngine?: () => Promise<SearchEngine>;
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
  const update = (patch: Partial<ToolsQuery>) =>
    setChosen({ ...state, ...patch });
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
  }, [chosen]);

  // The engine arrives on demand. Until it does, a query shows the grid as
  // served (not a guess at a ranking), and nothing is announced.
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
  const pending = Boolean(trimmed) && !ranking && !engineFailed;
  const mode: SearchMode = ranking?.mode ?? "all";
  const answer = ranking?.answer ?? null;
  const near = ranking?.near ?? [];

  const results = useMemo(
    () =>
      (ranking?.ranked ?? tools).filter(
        (tool) =>
          (active === "all" || tool.category === active) &&
          (accepts === null || toolAcceptsFormat(tool.accept, accepts)),
      ),
    [ranking, active, accepts],
  );

  // One always-mounted live region, debounced so typing "compress" is not
  // read out letter by letter, and silent on load so the page does not open
  // by announcing "50 tools".
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!chosen || pending) return;
    const text = resultAnnouncement(
      results.length,
      { category: active, query: ranking ? trimmed : "", accepts },
      { mode, unsupported: answer?.headline ?? null },
    );
    const timer = setTimeout(() => setAnnouncement(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    chosen,
    pending,
    results.length,
    active,
    trimmed,
    ranking,
    accepts,
    mode,
    answer,
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
    { id: "all", label: "All tools", count: toolCount },
    ...categories.map((c) => ({
      id: c.id as ToolsFilter,
      label: c.short,
      count: counts[c.id],
    })),
  ];

  const resultsHeading = useId();
  const reset = () =>
    updateAndRefocus({ category: "all", query: "", accepts: null });

  return (
    <div className="flex flex-col gap-6">
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </p>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative w-full lg:max-w-md">
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
            className="bg-panel border-line placeholder:text-faint focus:border-accent/40 focus-visible:ring-accent/50 text-fg h-12 w-full rounded-[3px] border pr-11 pl-11 text-sm transition outline-none focus-visible:ring-2"
          />
          {query && (
            <button
              type="button"
              onClick={() => updateAndRefocus({ ...state, query: "" })}
              aria-label="Clear search"
              className="text-muted hover:bg-wash hover:text-fg absolute top-1/2 right-3.5 grid size-6 -translate-y-1/2 place-items-center rounded-md transition"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {accepts && (
            <button
              type="button"
              onClick={() => updateAndRefocus({ ...state, accepts: null })}
              aria-label={`Takes ${accepts}, remove this filter`}
              className="border-line-strong bg-select text-fg hover:border-accent/60 focus-visible:ring-accent/50 rounded-tag inline-flex h-8 items-center gap-1.5 border pr-2 pl-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
            >
              Takes {accepts}
              <X className="text-muted size-3.5" aria-hidden />
            </button>
          )}
          <p className="text-muted inline-flex items-center gap-2 text-sm">
            <SlidersHorizontal className="size-4" aria-hidden />
            <span className="tabular-nums">{results.length}</span>
            {results.length === 1 ? " tool" : " tools"}
          </p>
        </div>
      </div>

      <div
        className="-mx-1 flex flex-wrap gap-2 px-1"
        role="group"
        aria-label="Filter by category"
      >
        {filters.map((filter) => {
          const selected = active === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              aria-pressed={selected}
              onClick={() => update({ category: filter.id })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[2px] border px-3.5 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? "bg-invert text-fg-invert border-transparent"
                  : "border-line text-muted hover:border-line-strong hover:bg-wash hover:text-fg",
              )}
            >
              {filter.label}
              <span
                className={cn(
                  "text-xs tabular-nums",
                  selected ? "text-fg-invert/70" : "text-faint",
                )}
              >
                {filter.count}
              </span>
            </button>
          );
        })}
      </div>

      {answer && (
        <AnswerBlock
          answer={answer}
          onShowFormat={(format) =>
            updateAndRefocus({ category: "all", query: "", accepts: format })
          }
        />
      )}

      {engineFailed && trimmed && (
        <p
          role="note"
          className="border-line bg-wash text-muted rounded-panel border px-4 py-3 text-sm"
        >
          Search could not load. Reload the page to search, or browse every tool
          below.
        </p>
      )}

      {results.length === 0 ? (
        answer ? null : (
          <EmptyState
            query={ranking ? trimmed : ""}
            accepts={accepts}
            category={
              active === "all"
                ? undefined
                : categories.find((c) => c.id === active)?.name
            }
            near={near}
            onReset={reset}
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
              className="font-display text-fg text-2xl font-medium tracking-tight"
            >
              {`${mode === "closest" ? "Closest" : "Best"} matches for “${trimmed}”`}
            </h2>
            {mode === "closest" && (
              <p className="text-muted text-sm leading-relaxed">
                No tool matches every word, so these match some of them.
              </p>
            )}
          </div>
          <ToolGrid tools={results} />
        </section>
      ) : (
        <div className="flex flex-col gap-12" aria-busy={pending || undefined}>
          {groups.map(({ category, tools: groupTools }) => (
            <section
              key={category.id}
              aria-labelledby={`tools-group-${category.id}`}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <h2
                  id={`tools-group-${category.id}`}
                  className="font-display text-fg text-2xl font-medium tracking-tight"
                >
                  <Link
                    href={categoryHref(category.id)}
                    className="hover:text-accent transition-colors"
                  >
                    {category.name}
                  </Link>
                  <span className="text-faint ml-2.5 align-middle font-mono text-xs font-normal tracking-normal">
                    {groupTools.length}
                  </span>
                </h2>
                <p className="text-muted text-sm leading-relaxed">
                  {category.description}
                </p>
              </div>
              <ToolGrid tools={groupTools} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "No tool here opens HEIC photos." — and the way in, derived from the
 * catalogue: the tool that takes the format to save a copy as, or for an
 * archive, the tools that take what is usually inside it.
 */
function AnswerBlock({
  answer,
  onShowFormat,
}: {
  answer: UnsupportedAnswer<Tool>;
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <ToolCard tool={alt.tool} />
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

/** Nothing to show — said in words, with a way back and a way elsewhere. */
function EmptyState({
  query,
  accepts,
  category,
  near,
  onReset,
}: {
  query: string;
  accepts: Format | null;
  category: string | undefined;
  near: readonly Tool[];
  onReset: () => void;
}) {
  const heading = useId();
  const inCategory = category ? ` in ${category}` : "";
  return (
    <section
      aria-labelledby={heading}
      className="border-line-strong bg-wash rounded-panel flex flex-col items-center gap-3 border border-dashed px-6 py-14 text-center"
    >
      <SearchX className="text-faint size-6" aria-hidden />
      <h2 id={heading} className="text-fg text-lg font-semibold">
        {query
          ? `Nothing matches “${query}”${inCategory}`
          : accepts
            ? `No tools take ${accepts}${inCategory}`
            : `No tools found${inCategory}`}
      </h2>
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

function ToolGrid({ tools: list }: { tools: readonly Tool[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((tool) => (
        <ToolCard key={tool.slug} tool={tool} />
      ))}
    </div>
  );
}
