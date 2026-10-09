import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";
import { categories, tools } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";
import { guides } from "@/lib/guides";
import { LEGAL_UPDATED } from "@/lib/legal";

/**
 * /sitemap.xml — the home page, the tool catalog, the category landing pages,
 * every tool page, the guides
 * and every guide page, and the policy and status pages. /workspace is
 * intentionally omitted: it is the one route that declares
 * `noindex, nofollow`.
 *
 * ── LASTMOD IS A CLAIM, SO ONLY REAL DATES ─────────────────────────────────
 *
 * This WAS `const lastModified = new Date()` on every entry. Production's
 * sitemap on 2026-09-20 carried `2026-09-20T16:59:10.943Z` for all 67 URLs —
 * /terms included — while each guide's own TechArticle said
 * `"dateModified": "2026-09-17"` and the sitemap index named a child OLDER
 * than every entry inside it. And since `/sitemaps/pages.xml` renders this
 * function per request, "now" was not even the deploy time: it was the fetch
 * time. Google uses lastmod only when it is consistently verifiable, and a
 * value that moves when the page does not teaches it to ignore the field on
 * every URL — including the ones that really changed.
 *
 * So an entry carries `lastModified` ONLY when a date exists that the page
 * itself states and a human moves when the content moves:
 *
 *   - a guide: `guide.updated` — the date its page prints and its TechArticle
 *     publishes as `dateModified`;
 *   - /guides: the newest of those, since the listing is those guides;
 *   - /privacy and /terms: `LEGAL_UPDATED`, the date both documents print.
 *
 * Everything else — home, the catalogue, categories, tool pages, /status —
 * has NO recorded content date, and gets no lastmod rather than an invented
 * one: an absent lastmod is "unknown", a wrong one is a lie. A constant typed
 * here for them would be the same defect on a slower clock (nothing would
 * move it when a tool's copy changes), and a git date at build time is the
 * clone date on a shallow CI checkout. Nothing in this file may call
 * `new Date()`; `sitemap-lastmod.test.ts` pins that across a clock advance.
 *
 * THE INVARIANT THIS FILE IS ONE HALF OF: every indexable route belongs here,
 * and everything here must be indexable. `route-indexability.test.ts` walks
 * `src/app` for page files and checks both directions against the `Metadata`
 * each segment actually exports — so adding a page without adding it here
 * fails, which is precisely what did not happen for `/status`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => new URL(path, siteConfig.url).toString();
  // ISO dates compare correctly as strings.
  const newestGuideEdit = guides
    .map((guide) => guide.updated)
    .sort()
    .at(-1);

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: url("/"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: url("/tools"),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: url("/guides"),
      ...(newestGuideEdit ? { lastModified: newestGuideEdit } : {}),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    // Indexed on purpose, and ranked above the policies: the privacy policy
    // sends readers here for the authoritative "which tools run where" list, so
    // a page cited as the answer to the product's central privacy question
    // should be findable by searching for it, not only by reading the policy
    // that links it. It already declared `index, follow` and a self-canonical
    // `https://pdf.xyz/status`; the sitemap was the only place that disagreed.
    {
      url: url("/status"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // Low priority, but indexed on purpose: for a product whose headline claim
    // is privacy, the policy is a page people search for by name before they
    // decide to trust it.
    {
      url: url("/privacy"),
      lastModified: LEGAL_UPDATED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: url("/terms"),
      lastModified: LEGAL_UPDATED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  // One priority for every tool page. It WAS `isToolSupported(slug) ? 0.8 :
  // 0.6`, and "supported" means "has an in-browser runner", not "works" — so
  // PDF to Word, Word to PDF, OCR, Protect and Unlock, all of which run on
  // the worker, ranked below Grayscale.
  const toolRoutes: MetadataRoute.Sitemap = tools.map((tool) => ({
    url: url(`/tools/${tool.slug}`),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  // The category landing pages, from `categories` — the same array their
  // `generateStaticParams` reads — through the one helper that spells the URL.
  const categoryRoutes: MetadataRoute.Sitemap = categories.map((category) => ({
    url: url(categoryHref(category.id)),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  // Derived from the same module `generateStaticParams` reads, so the sitemap
  // and the route set cannot disagree about which guides exist.
  const guideRoutes: MetadataRoute.Sitemap = guides.map((guide) => ({
    url: url(`/guides/${guide.slug}`),
    lastModified: guide.updated,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...categoryRoutes, ...toolRoutes, ...guideRoutes];
}
