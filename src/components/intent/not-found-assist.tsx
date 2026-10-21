"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { pathQuery } from "@/lib/intent/path-query";

/** What the 404 needs from a matched tool — nothing else crosses the boundary. */
interface Suggestion {
  slug: string;
  name: string;
}

/**
 * The 404's reading of the address it was asked for (design spec E.12).
 *
 * Two jobs, both on top of a page that already works without it:
 *
 *  1. It PRE-FILLS the server-rendered search box (`inputId`) with the
 *     path's words — `/pdf-to-doc` becomes "pdf to doc" — unless the reader
 *     has typed something, so the GET form to `/tools` is one press away.
 *  2. After idle, it fills a RESERVED 56px row (`data-slot`, so the
 *     layout-stability spec charges any shift inside it to the slot) with
 *     "Did you mean Merge PDF?", or "No close match — search all tools" when
 *     the matcher found nothing. A matcher that fails to load says nothing:
 *     "no close match" is a finding, and a failed chunk established none.
 *
 * The matcher (`@/lib/tools/path-suggest`) searches the whole catalogue, so
 * it is imported HERE, on idle, and never statically. This island sits in
 * the ROOT not-found boundary, which Next ships with every route: a static
 * import put the entire tool catalogue in the first load of the homepage and
 * every guide (measured 2026-10-08). `bundle-budget.test.ts` ("ships the tool
 * catalogue only on pages that need it") reads the chunk CONTENT and fails if
 * it comes back.
 */
type PathSuggest = typeof import("@/lib/tools/path-suggest");

/** The real matcher, fetched on demand. Tests pass a failing one (no vi.mock). */
const loadPathSuggest = (): Promise<PathSuggest> =>
  import("@/lib/tools/path-suggest");

/** Run `fn` when the page is idle; returns a cancel. */
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(fn, 0);
  return () => window.clearTimeout(timer);
}

/** "A", "A or B", "A, B or C" — each a link. */
function ToolList({ tools }: { tools: Suggestion[] }) {
  return (
    <>
      {tools.map((tool, i) => (
        <span key={tool.slug}>
          {i > 0 && (i === tools.length - 1 ? " or " : ", ")}
          <Link
            href={`/tools/${tool.slug}`}
            className="text-accent font-medium underline underline-offset-4"
          >
            {tool.name}
          </Link>
        </span>
      ))}
    </>
  );
}

export function NotFoundAssist({
  inputId,
  loadMatcher = loadPathSuggest,
}: {
  /** The id of the server-rendered search input to pre-fill. */
  inputId: string;
  loadMatcher?: () => Promise<PathSuggest>;
}) {
  const pathname = usePathname() ?? "";
  // Keyed by the path they were computed for: after a client navigation to
  // another missing path, the previous path's suggestion never renders, not
  // even for the frame before the effect below runs.
  const [result, setResult] = useState<{
    path: string;
    list: Suggestion[];
  } | null>(null);
  const current = result?.path === pathname ? result.list : null;
  const query = pathQuery(pathname);
  // What this island last wrote into the box: replaced on a new path, but a
  // value the reader typed is never overwritten.
  const prefilled = useRef("");

  useEffect(() => {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return;
    if (input.value === "" || input.value === prefilled.current) {
      input.value = query;
      prefilled.current = query;
    }
  }, [inputId, query]);

  useEffect(() => {
    let live = true;
    const cancel = whenIdle(() => {
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
        // dropped request) costs only the suggestion: the page keeps its
        // search, its links home and to every tool, and the popular tools.
        .catch(() => {});
    });
    return () => {
      live = false;
      cancel();
    };
  }, [pathname, loadMatcher]);

  return (
    <div
      data-slot="not-found-assist"
      aria-live="polite"
      className="text-fg flex h-14 items-center justify-center overflow-hidden px-2 text-center text-sm leading-5 text-pretty"
    >
      {current !== null &&
        (current.length > 0 ? (
          <p>
            Did you mean <ToolList tools={current} />?
          </p>
        ) : (
          <p className="text-muted">
            No close match —{" "}
            <Link
              href={`/tools?q=${encodeURIComponent(query)}`}
              className="text-accent font-medium underline underline-offset-4"
            >
              search all tools
            </Link>
          </p>
        ))}
    </div>
  );
}
