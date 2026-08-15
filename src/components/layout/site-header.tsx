"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { primaryNav } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/layout/logo";
import { cn } from "@/lib/utils";

/**
 * Masthead. Carries the paper theme scope itself because it renders outside
 * every page's own wrapper: an opaque paper band with a hairline rule, on
 * every route. No blur, no translucency — a masthead, not a glass strip.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href.startsWith("/") &&
    !href.includes("#") &&
    (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="theme-paper bg-canvas border-line sticky top-0 z-50 border-b">
      <Container className="flex h-14 items-center justify-between gap-4">
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
          type="button"
          onClick={() => setOpen((v) => !v)}
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
        <div
          id="mobile-menu"
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
        </div>
      )}
    </header>
  );
}
