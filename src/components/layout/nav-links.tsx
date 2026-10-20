"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { subscribeLocation } from "@/lib/location-search";
import { currentNavHref, primaryNav } from "@/lib/site";
import { cn } from "@/lib/utils";

type Variant = "bar" | "menu";

interface LinksProps {
  readonly variant: Variant;
  readonly onNavigate?: () => void;
}

/**
 * The query, once the page is in the browser; `null` on the server and in
 * the hydrating render, so the served links and the first client render
 * agree (current by pathname alone).
 */
function useSearch(): URLSearchParams | null {
  // Read again on every render — a navigation re-renders this through
  // `usePathname` — and on every announced in-place change.
  const search = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => null,
  );
  return useMemo(
    () => (search === null ? null : new URLSearchParams(search)),
    [search],
  );
}

/**
 * The primary links, current by path AND query (`currentNavHref`): "AI
 * tools" is current on `/tools?category=ai`, and "All tools" is not.
 *
 * The server cannot know the query of a prerendered page, so the served
 * links are current by pathname alone, and the query-aware answer follows
 * after hydration. Every link is in the served HTML either way. (The spec
 * asked for `useSearchParams()` inside `<Suspense>`; that bails the
 * boundary out of the server render on every page — see
 * `@/lib/location-search`.)
 */
export function NavLinks({ variant, onNavigate }: LinksProps) {
  const pathname = usePathname() ?? "/";
  const search = useSearch();
  const current = currentNavHref(pathname, search);
  return (
    <>
      {primaryNav.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={
              variant === "bar"
                ? cn(
                    "text-sm whitespace-nowrap transition-colors",
                    item.wide && "max-lg:hidden",
                    active
                      ? "text-fg decoration-accent underline decoration-2 underline-offset-[6px]"
                      : "text-muted hover:text-fg",
                  )
                : cn(
                    "rounded-ctl flex h-11 items-center px-3 text-base font-medium transition-colors",
                    active ? "bg-select text-fg" : "text-fg hover:bg-wash",
                  )
            }
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
