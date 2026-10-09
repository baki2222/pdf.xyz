"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useRecents } from "@/lib/intent/recents";
import { cn } from "@/lib/utils";
import { loadTicketView } from "./use-ticket";

/** Recent tools the slot names, at most — one line, never two. */
const SHOWN = 3;

type NameOf = (slug: string) => string | undefined;

/**
 * Tool names, fetched only when there is a recent tool to name — with the
 * ticket's chunk, which carries the catalogue and which this desk fetches as
 * soon as a file approaches anyway. The catalogue is not the home page's to
 * load up front (`bundle-budget.test.ts`, "ships the tool catalogue only on
 * pages that need it"), and a first visit has nothing recent to show.
 */
function loadNames(): Promise<NameOf> {
  return loadTicketView().then(
    ({ getToolBySlug }) =>
      (slug: string) =>
        getToolBySlug(slug)?.name,
  );
}

/**
 * "Recent: Merge PDF · Compress PDF" — the tools that last finished a job in
 * this browser, as links to their pages. A slot of fixed height, empty on the
 * server and on a first visit, so filling it moves nothing (`data-slot`,
 * held by `e2e/layout-stability.spec.ts`). Recents hold slugs and times only;
 * a slug the catalogue no longer has is skipped.
 */
export function RecentsSlot({ className }: { className?: string }) {
  const recents = useRecents();
  const [nameOf, setNameOf] = useState<NameOf | null>(null);
  const wanted = recents.length > 0;

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    loadNames().then(
      (fn) => live && setNameOf(() => fn),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [wanted]);

  const shown = nameOf
    ? recents
        .map((r) => ({ slug: r.slug, name: nameOf(r.slug) }))
        .filter((r): r is { slug: string; name: string } => !!r.name)
        .slice(0, SHOWN)
    : [];

  return (
    <div
      data-slot="recents"
      className={cn("flex h-8 items-center overflow-hidden", className)}
    >
      {shown.length > 0 && (
        <nav
          aria-label="Recent tools"
          className="text-muted flex min-w-0 items-center gap-2 text-xs"
        >
          <History className="text-faint size-3.5 shrink-0" aria-hidden />
          <span className="text-faint shrink-0">Recent:</span>
          <ul className="flex min-w-0 items-center gap-1.5 truncate">
            {shown.map((r, i) => (
              <li key={r.slug} className="inline-flex shrink-0 items-center">
                {i > 0 && (
                  <span aria-hidden className="text-faint mr-1.5">
                    ·
                  </span>
                )}
                <a
                  href={`/tools/${r.slug}`}
                  className="text-fg decoration-line-strong hover:decoration-accent underline decoration-1 underline-offset-4"
                >
                  {r.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
