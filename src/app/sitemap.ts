import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";
import { categories, tools } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";
import { guides } from "@/lib/guides";
import { isToolSupported } from "@/lib/pdf/registry";

/**
 * /sitemap.xml — the home page, the tool catalog, the category landing pages,
 * every tool page, the guides
 * and every guide page, and the policy and status pages. /workspace is
 * intentionally omitted: it is the one route that declares
 * `noindex, nofollow`.
 *
 * Tools that already ship a live in-browser runner rank slightly higher than
 * the ones still showing an implementation-ready overview.
 *
 * THE INVARIANT THIS FILE IS ONE HALF OF: every indexable route belongs here,
 * and everything here must be indexable. `route-indexability.test.ts` walks
 * `src/app` for page files and checks both directions against the `Metadata`
 * each segment actually exports — so adding a page without adding it here
 * fails, which is precisely what did not happen for `/status`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const url = (path: string) => new URL(path, siteConfig.url).toString();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: url("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: url("/tools"),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: url("/guides"),
      lastModified,
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
      lastModified,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // Low priority, but indexed on purpose: for a product whose headline claim
    // is privacy, the policy is a page people search for by name before they
    // decide to trust it.
    {
      url: url("/privacy"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: url("/terms"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const toolRoutes: MetadataRoute.Sitemap = tools.map((tool) => ({
    url: url(`/tools/${tool.slug}`),
    lastModified,
    changeFrequency: "monthly",
    priority: isToolSupported(tool.slug) ? 0.8 : 0.6,
  }));

  // The category landing pages, from `categories` — the same array their
  // `generateStaticParams` reads — through the one helper that spells the URL.
  const categoryRoutes: MetadataRoute.Sitemap = categories.map((category) => ({
    url: url(categoryHref(category.id)),
    lastModified,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  // Derived from the same module `generateStaticParams` reads, so the sitemap
  // and the route set cannot disagree about which guides exist.
  const guideRoutes: MetadataRoute.Sitemap = guides.map((guide) => ({
    url: url(`/guides/${guide.slug}`),
    lastModified,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...categoryRoutes, ...toolRoutes, ...guideRoutes];
}
