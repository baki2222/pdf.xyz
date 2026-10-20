import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { footerNav, siteConfig } from "@/lib/site";
import { LEGAL_ENTITY } from "@/lib/legal";
import { GUIDE_META } from "@/lib/guides/meta.generated";
import { getToolsGroupedByCategory, toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/layout/logo";

/** How many guides the Guides column names before "All guides". */
const FOOTER_GUIDES = 5;

/**
 * Footer. Like the header it carries the paper scope itself: an opaque paper
 * band that closes every route. No top margin — each page owns the space
 * above it (the homepage ends on the ink colophon, flush against this).
 *
 * WP-09 (D.1): a Guides column (the first guides, then "All guides"), and
 * below the columns the TOOLS BAND — every tool, by category, on every page
 * (G.3), read from the catalogue so a tool added tomorrow is linked from
 * every page by existing. At `sm` and up the categories stand open in four
 * columns; on a phone each is a `<details>`, closed, its links still in
 * the served HTML. A server component: none of it ships as script.
 * `site-landmarks.test.tsx` and `e2e/seo-structure.spec.ts` hold the band
 * to the catalogue, one link per tool.
 */
export function SiteFooter() {
  const year = 2026;

  return (
    <footer className="bg-canvas border-line border-t">
      <Container className="py-14">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_4fr]">
          <div className="flex flex-col gap-4">
            <Logo />
            <p className="text-muted max-w-xs text-sm leading-relaxed">
              {siteConfig.tagline} {toolCount} tools for every document — most
              run entirely in your browser.
            </p>
            <p className="text-muted inline-flex items-center gap-2 text-xs">
              <span
                className="bg-ok size-1.5 shrink-0 rounded-full"
                aria-hidden
              />
              Privacy-first by architecture, not by policy.
            </p>
          </div>

          {/* The link columns are the footer's navigation: a landmark, so a
              screen-reader user can reach them from the rotor. */}
          <nav
            aria-label="Footer"
            className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5"
          >
            {footerNav.map((column) => (
              <div key={column.title} className="flex flex-col gap-3">
                <h3 className="text-faint kicker">{column.title}</h3>
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
            <div className="flex flex-col gap-3">
              <h3 className="text-faint kicker">Guides</h3>
              <ul className="flex flex-col gap-2.5">
                {GUIDE_META.slice(0, FOOTER_GUIDES).map((guide) => (
                  <li key={guide.slug}>
                    <Link
                      href={`/guides/${guide.slug}`}
                      className="text-muted hover:text-fg text-sm transition-colors"
                    >
                      {guide.title}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href="/guides"
                    className="text-fg hover:text-accent text-sm font-medium transition-colors"
                  >
                    All guides
                  </Link>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <nav
          aria-label="Tools by category"
          className="border-line mt-12 grid border-t pt-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4"
        >
          {getToolsGroupedByCategory().map(({ category, tools }) => (
            <details
              key={category.id}
              className="border-line border-b sm:border-0 sm:[&::details-content]:[content-visibility:visible]"
            >
              <summary className="text-faint kicker flex list-none items-center justify-between py-3">
                {category.name}
                <ChevronDown className="size-4 sm:hidden" aria-hidden />
              </summary>
              <ul className="flex flex-col gap-2 pb-3">
                {tools.map((tool) => (
                  <li key={tool.slug}>
                    <Link
                      href={`/tools/${tool.slug}`}
                      className="text-muted hover:text-fg text-sm transition-colors"
                    >
                      {tool.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </nav>

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
              Security practices
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
