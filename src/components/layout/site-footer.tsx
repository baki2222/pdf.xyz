import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { footerNav, siteConfig } from "@/lib/site";
import { LEGAL_ENTITY } from "@/lib/legal";
import { GUIDE_META } from "@/lib/guides/meta.generated";
import { getToolsGroupedByCategory, toolCount } from "@/lib/tools";
import { CATEGORY_PATH_PREFIX, categoryHref } from "@/lib/tools/category-href";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/layout/logo";

/** How many guides the Guides column names before "All guides". */
const FOOTER_GUIDES = 5;

/** A column's heading: plain small type, not a mono capital kicker. */
const HEADING = "text-fg text-sm font-semibold";
const LINK = "text-muted hover:text-fg tap-row text-sm transition-colors";

/**
 * The columns the footer draws: every `footerNav` column but the one that
 * lists the category pages. Found by what its links ARE, not by its title:
 * each category is named by its group in the tools band below, whose
 * heading links its page, so a column of the same names would list them
 * twice. `footerNav` keeps the column — the command palette and the
 * category-link guards read it as the site's list of pages.
 */
const COLUMNS = footerNav.filter(
  (column) =>
    !column.items.every((item) => item.href?.startsWith(CATEGORY_PATH_PREFIX)),
);

/**
 * Footer. Like the header it carries the paper scope itself: an opaque paper
 * band that closes every route. No top margin — each page owns the space
 * above it.
 *
 * ONE COMPACT FOOTER (owner, 2026-10-23). It was two link blocks: five
 * columns — one of them every category — stacked one above another on a
 * phone, then the tools band naming the same categories again with every
 * tool under them: 1,927px on a phone, 1,209 at 1440. Now the brand and four
 * columns (two to a row on a phone), then the tools band, where each
 * category is named once and its heading links its page.
 *
 * THE TOOLS BAND (WP-09, G.3): every tool, by category, on every page, read
 * from the catalogue so a tool added tomorrow is linked from every page by
 * existing. From `sm` the groups stand open, packed in columns; on a phone
 * each is a `<details>`, closed, its links still in the served HTML. A
 * server component: none of it ships as script. `site-landmarks.test.tsx`
 * and `e2e/seo-structure.spec.ts` hold the band to the catalogue, one link
 * per tool.
 */
export function SiteFooter() {
  const year = 2026;

  return (
    <footer className="bg-canvas border-line border-t">
      <Container className="py-10 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-[1fr_3fr] lg:gap-12">
          <div className="flex flex-col gap-3">
            <Logo className="tap-row" />
            <p className="text-muted max-w-xs text-sm leading-relaxed">
              {siteConfig.tagline} {toolCount} tools for every document — most
              run entirely in your browser.
            </p>
          </div>

          {/* The link columns are the footer's navigation: a landmark, so a
              screen-reader user can reach them from the rotor. */}
          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4"
          >
            {COLUMNS.map((column) => (
              <div key={column.title} className="flex flex-col gap-3">
                <h3 className={HEADING}>{column.title}</h3>
                <ul className="flex flex-col gap-2">
                  {column.items.map((item) => (
                    <li key={item.label}>
                      {item.href ? (
                        <Link href={item.href} className={LINK}>
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
              <h3 className={HEADING}>Guides</h3>
              <ul className="flex flex-col gap-2">
                {GUIDE_META.slice(0, FOOTER_GUIDES).map((guide) => (
                  <li key={guide.slug}>
                    <Link href={`/guides/${guide.slug}`} className={LINK}>
                      {guide.title}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href="/guides"
                    className="text-fg hover:text-accent tap-row text-sm font-medium transition-colors"
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
          className="border-line mt-10 border-t pt-4 sm:columns-2 sm:gap-8 sm:pt-8 lg:columns-4"
        >
          {getToolsGroupedByCategory().map(({ category, tools }) => (
            <details
              key={category.id}
              className="border-line border-b sm:mb-6 sm:break-inside-avoid sm:border-0 sm:[&::details-content]:[content-visibility:visible]"
            >
              {/* On a phone the name opens its group; from `sm` the groups
                  stand open and the name is its category page's link. */}
              <summary className="text-fg flex cursor-pointer list-none items-center justify-between py-3 text-sm font-semibold sm:cursor-auto sm:py-0 sm:pb-2 [&::-webkit-details-marker]:hidden">
                <span className="sm:hidden">{category.name}</span>
                <Link
                  href={categoryHref(category.id)}
                  className="hover:text-accent transition-colors max-sm:hidden"
                >
                  {category.name}
                </Link>
                <ChevronDown
                  className="text-muted size-4 sm:hidden"
                  aria-hidden
                />
              </summary>
              <ul className="flex flex-col gap-2 pb-3 sm:gap-1.5 sm:pb-0">
                {tools.map((tool) => (
                  <li key={tool.slug}>
                    <Link href={`/tools/${tool.slug}`} className={LINK}>
                      {tool.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </nav>

        <div className="border-line mt-8 flex flex-col items-start justify-between gap-4 border-t pt-6 sm:mt-6 sm:flex-row sm:items-center">
          <p className="text-muted text-xs">
            {/* The operating company, not the product name — a copyright line
                that names a domain identifies nobody. */}
            © {year} {LEGAL_ENTITY.name}. All rights reserved.
          </p>
          <div className="text-muted flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            {/* These pointed at homepage anchors — marketing sections, not
                policies. A site that processes people's documents and offers no
                privacy policy anywhere is missing the document a visitor goes
                looking for precisely when they are deciding whether to trust it. */}
            <Link
              href="/privacy"
              className="hover:text-fg tap-row transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="hover:text-fg tap-row transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/#security"
              className="hover:text-fg tap-row transition-colors"
            >
              Security practices
            </Link>
            <Link
              href="/tools"
              className="hover:text-fg tap-row transition-colors"
            >
              All tools
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
