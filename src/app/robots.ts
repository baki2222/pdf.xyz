import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

/**
 * /robots.txt — allow everything and point crawlers at the sitemap. We
 * deliberately do NOT disallow /workspace here: it carries a `noindex` meta
 * tag, and blocking it in robots.txt would stop crawlers from ever seeing that
 * directive.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    // BOTH entry points. The index was added 2026-09-20 after Search
    // Console reported the flat sitemap unreadable for four weeks while every
    // measurement said it was fine (see src/app/sitemap-index.xml/route.ts);
    // robots.txt advertising both means auto-discovery does not depend on
    // which record a search engine happens to hold.
    sitemap: [
      new URL("/sitemap-index.xml", siteConfig.url).toString(),
      new URL("/sitemap.xml", siteConfig.url).toString(),
    ],
    host: siteConfig.url,
  };
}
