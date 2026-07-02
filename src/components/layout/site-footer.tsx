import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { footerNav, siteConfig } from "@/lib/site";
import { toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/layout/logo";

export function SiteFooter() {
  const year = 2026;

  return (
    <footer className="mt-24 border-t border-white/10 bg-ink-2/60">
      <Container className="py-14">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div className="flex flex-col gap-4">
            <Logo />
            <p className="max-w-xs text-sm leading-relaxed text-slate-400">
              {siteConfig.tagline} {toolCount} tools for every document — most
              run entirely in your browser.
            </p>
            <p className="inline-flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="size-4 text-emerald-400" aria-hidden />
              Privacy-first by architecture, not by policy.
            </p>
          </div>

          {footerNav.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                {column.title}
              </h3>
              <ul className="flex flex-col gap-2.5">
                {column.items.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="text-sm text-slate-400 transition-colors hover:text-white"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-500">
            © {year} {siteConfig.name}. All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-xs text-slate-500">
            <Link href="/#privacy" className="transition hover:text-white">
              Privacy
            </Link>
            <Link href="/#security" className="transition hover:text-white">
              Security
            </Link>
            <Link href="/tools" className="transition hover:text-white">
              All tools
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
