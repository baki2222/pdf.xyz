import Link from "next/link";
import { footerNav, siteConfig } from "@/lib/site";
import { LEGAL_ENTITY } from "@/lib/legal";
import { toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/layout/logo";

/**
 * Footer. Like the header it carries the paper scope itself: an opaque paper
 * band that closes every route. No top margin — each page owns the space
 * above it (the homepage ends on the ink colophon, flush against this).
 */
export function SiteFooter() {
  const year = 2026;

  return (
    <footer className="bg-canvas border-line border-t">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="flex flex-col gap-4">
            <Logo />
            <p className="text-muted max-w-xs text-sm leading-relaxed">
              {siteConfig.tagline} {toolCount} tools for every document — most
              run entirely in your browser.
            </p>
            <p className="text-muted inline-flex items-center gap-2 text-xs">
              <span
                className="size-1.5 shrink-0 rounded-full bg-emerald-600"
                aria-hidden
              />
              Privacy-first by architecture, not by policy.
            </p>
          </div>

          {footerNav.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <h3 className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
                {column.title}
              </h3>
              <ul className="flex flex-col gap-2.5">
                {column.items.map((item) => (
                  <li key={item.label}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="text-muted hover:text-fg text-sm transition-colors"
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <span className="text-muted text-sm">{item.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-line mt-12 flex flex-col items-start justify-between gap-4 border-t pt-6 sm:flex-row sm:items-center">
          <p className="text-muted text-xs">
            {/* The operating company, not the product name — a copyright line
                that names a domain identifies nobody. */}
            © {year} {LEGAL_ENTITY.name}. All rights reserved.
          </p>
          <div className="text-muted flex items-center gap-5 text-xs">
            {/* These pointed at homepage anchors — marketing sections, not
                policies. A site that processes people's documents and offers no
                privacy policy anywhere is missing the document a visitor goes
                looking for precisely when they are deciding whether to trust it. */}
            <Link href="/privacy" className="hover:text-fg transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-fg transition-colors">
              Terms
            </Link>
            <Link href="/#security" className="hover:text-fg transition-colors">
              Security
            </Link>
            <Link href="/tools" className="hover:text-fg transition-colors">
              All tools
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
