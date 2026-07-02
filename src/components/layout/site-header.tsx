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

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href.startsWith("/") &&
    !href.includes("#") &&
    (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-ink/70 backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {primaryNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-white/10 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white",
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
          className="grid size-10 place-items-center rounded-xl border border-white/10 text-slate-200 transition hover:bg-white/5 md:hidden"
        >
          {open ? (
            <X className="size-5" aria-hidden />
          ) : (
            <Menu className="size-5" aria-hidden />
          )}
        </button>
      </Container>

      {open && (
        <div className="border-t border-white/10 bg-ink/95 backdrop-blur-xl md:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {primaryNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/5 hover:text-white"
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
