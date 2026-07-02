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
    sitemap: new URL("/sitemap.xml", siteConfig.url).toString(),
    host: siteConfig.url,
  };
}
