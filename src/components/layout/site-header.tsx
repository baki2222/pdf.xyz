"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { activeNavHref, primaryNav } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/layout/logo";
import { cn } from "@/lib/utils";

/**
 * Masthead. Carries the paper theme scope itself because it renders outside
 * every page's own wrapper: an opaque paper band with a hairline rule, on
 * every route. No blur, no translucency — a masthead, not a glass strip.
 *
 * Below `md` the desktop `<nav>` is display:none, so the mobile menu is the
 * page's primary navigation landmark and is a `<nav>` itself (it was a plain
 * div, which left phones with no navigation landmark on most pages). It
 * closes on Escape, returning focus to the toggle, and on any route change —
 * including back/forward, which the per-link `onClick` never saw.
 */
export function SiteHeader() {
  const pathname = usePathname();
  // Open FOR a pathname: the menu is open only while the route it was opened
  // on is still the current one, so a navigation closes it with no effect
  // and no setState-in-effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenOn(null);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const current = activeNavHref(pathname);
  const isActive = (href: string) => href === current;

  return (
    <header className="bg-canvas border-line sticky top-0 z-50 border-b">
      <Container className="flex h-[var(--sf-header-h)] items-center justify-between gap-4">
        <Logo />

        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {primaryNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "text-sm transition-colors",
                isActive(item.href)
                  ? "text-fg decoration-accent underline decoration-2 underline-offset-[6px]"
                  : "text-muted hover:text-fg",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/tools"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Explore tools
          </Link>
          <Link
            href="/workspace"
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            Open workspace
          </Link>
        </div>

        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="border-line text-fg hover:bg-wash grid size-9 place-items-center rounded-[3px] border transition-colors md:hidden"
        >
          {open ? (
            <X className="size-5" aria-hidden />
          ) : (
            <Menu className="size-5" aria-hidden />
          )}
        </button>
      </Container>

      {open && (
        <nav
          id="mobile-menu"
          aria-label="Primary"
          className="bg-canvas border-line border-t md:hidden"
        >
          <Container className="flex flex-col gap-1 py-4">
            {primaryNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className="text-fg hover:bg-wash rounded-[3px] px-3 py-2.5 text-sm font-medium transition-colors"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <Link
                href="/tools"
                onClick={() => setOpen(false)}
                className={buttonVariants({ variant: "outline", size: "md" })}
              >
                Explore tools
              </Link>
              <Link
                href="/workspace"
                onClick={() => setOpen(false)}
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                Open workspace
              </Link>
            </div>
          </Container>
        </nav>
      )}
    </header>
  );
}
