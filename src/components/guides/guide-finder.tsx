"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SearchDoc, SearchIndex } from "@/lib/intent/search";

/** A guide as the finder searches it: plain data from the server page. */
export interface GuideFinderDoc {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  /** The primary tool's name, which a reader often searches by. */
  readonly toolName?: string;
}

type SearchModule = typeof import("@/lib/intent/search");

const noSubscribe = () => () => {};

/**
 * "Find a guide" on the guides index (design spec D.9).
 *
 * The spec's button opens the command palette scoped to guides. The palette
 * is WP-09's, and it was not on main when this shipped, so the button opens
 * an in-page finder over the same ranked search the palette uses
 * (`@/lib/intent/search`, guide documents) — loaded when the reader first
 * types, never in the page's first load.
 *
 * It only HIDES cards (`[data-guide-card]`, server-rendered), so the index
 * stays a complete list for a crawler and for a reader without JavaScript;
 * for them the button never renders (it appears on hydration, in a row
 * reserved for it, so nothing moves).
 */
export function GuideFinder({ docs }: { docs: readonly GuideFinderDoc[] }) {
  // False in the server render and on hydration, true after: the button is
  // never in markup a reader without JavaScript receives.
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<number | null>(null);
  const index = useRef<{
    mod: SearchModule;
    index: SearchIndex<SearchDoc>;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    let live = true;
    const apply = (visible: ReadonlySet<string> | null) => {
      let count = 0;
      for (const card of document.querySelectorAll<HTMLElement>(
        "[data-guide-card]",
      )) {
        const show = visible === null || visible.has(card.dataset.guideCard!);
        card.hidden = !show;
        if (show) count += 1;
      }
      setShown(visible === null ? null : count);
    };
    if (query.trim() === "") {
      apply(null);
      return;
    }
    const load = index.current
      ? Promise.resolve(index.current)
      : import("@/lib/intent/search").then((mod) => {
          const built = {
            mod,
            index: mod.buildIndex<SearchDoc>(
              docs.map((doc) => ({
                kind: "guide",
                id: doc.slug,
                name: doc.title,
                keywords: doc.keywords,
                tagline: doc.toolName,
                description: doc.description,
              })),
            ),
          };
          index.current = built;
          return built;
        });
    load
      .then(({ mod, index: built }) => {
        if (!live) return;
        const { results } = mod.search(built, query);
        apply(new Set(results.map((doc) => doc.id)));
      })
      // The search failed to load: the list stays whole, which is the page
      // without the finder.
      .catch(() => live && apply(null));
    return () => {
      live = false;
    };
  }, [query, docs]);

  return (
    <div data-slot="guide-finder" className="flex min-h-16 flex-col gap-1">
      {hydrated &&
        (open ? (
          <div role="search" className="flex max-w-md flex-col gap-1">
            <label htmlFor="guide-finder-q" className="sr-only">
              Find a guide
            </label>
            <input
              ref={input}
              id="guide-finder-q"
              type="search"
              value={query}
              placeholder="Merge, sign, scanned…"
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              className="border-line-strong bg-panel text-fg placeholder:text-faint focus-visible:outline-accent rounded-ctl h-11 w-full border px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2"
            />
            <p aria-live="polite" className="text-muted h-5 text-sm">
              {shown === 0
                ? "No guide matches that yet — try a tool's name."
                : shown !== null
                  ? `${shown} of ${docs.length} guides`
                  : ""}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              buttonVariants({ variant: "secondary", size: "md" }),
              "self-start",
            )}
          >
            <Search className="size-4" aria-hidden />
            Find a guide
          </button>
        ))}
    </div>
  );
}
