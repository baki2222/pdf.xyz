"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";

/** What the 404 needs from a matched tool — nothing else crosses the boundary. */
interface Suggestion {
  slug: string;
  name: string;
}

/**
 * "Did you mean …?" on the 404 page, from the address that was asked for.
 * Renders nothing when the path names no tool, rather than a guess.
 *
 * The matcher (`@/lib/tools/path-suggest`) searches the whole catalogue, so it
 * is imported HERE, on mount, and never statically. This component sits in the
 * ROOT not-found boundary, which Next ships with every route: a static import
 * put the entire tool catalogue in the first load of the homepage and every
 * guide (measured 2026-10-08: all 49 plain taglines in index.html's chunks),
 * under budgets that only bound size. `bundle-budget.test.ts` ("ships the tool
 * catalogue only on pages that need it") reads the chunk CONTENT and fails if
 * it comes back.
 */
type PathSuggest = typeof import("@/lib/tools/path-suggest");

/** The real matcher, fetched on demand. Tests pass a failing one (no vi.mock). */
const loadPathSuggest = (): Promise<PathSuggest> =>
  import("@/lib/tools/path-suggest");

export function MissingPathSuggestion({
  loadMatcher = loadPathSuggest,
}: { loadMatcher?: () => Promise<PathSuggest> } = {}) {
  const pathname = usePathname() ?? "";
  // Keyed by the path they were computed for: after a client navigation to
  // another missing path, the previous path's suggestions never render, not
  // even for the frame before the effect below runs.
  const [result, setResult] = useState<{
    path: string;
    list: Suggestion[];
  } | null>(null);
  const suggestions = result?.path === pathname ? result.list : [];

  useEffect(() => {
    let live = true;
    loadMatcher()
      .then(({ toolsForMissingPath }) => {
        if (!live) return;
        setResult({
          path: pathname,
          list: toolsForMissingPath(pathname).map(({ slug, name }) => ({
            slug,
            name,
          })),
        });
      })
      // A chunk that fails to load (a tab holding a pre-deploy build, a
      // dropped request) costs only the suggestion: the page keeps its links
      // home, to every tool, and the popular tools.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname, loadMatcher]);

  if (suggestions.length === 0) return null;
  return (
    <div className="border-line bg-wash rounded-panel flex flex-col items-center gap-3 border px-5 py-4">
      <p className="text-fg text-sm font-medium">Did you mean</p>
      <ul className="flex flex-wrap items-center justify-center gap-2">
        {suggestions.map((tool) => (
          <li key={tool.slug}>
            <Link
              href={`/tools/${tool.slug}`}
              className="text-accent inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4"
            >
              {tool.name}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
