import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";
import { tools } from "@/lib/tools";
import { isToolSupported } from "@/lib/pdf/registry";

/**
 * /sitemap.xml — the home page, the tool catalog, and every tool page.
 * /workspace is intentionally omitted (it is `noindex`).
 *
 * Tools that already ship a live in-browser runner rank slightly higher than
 * the ones still showing an implementation-ready overview.
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
  ];

  const toolRoutes: MetadataRoute.Sitemap = tools.map((tool) => ({
    url: url(`/tools/${tool.slug}`),
    lastModified,
    changeFrequency: "monthly",
    priority: isToolSupported(tool.slug) ? 0.8 : 0.6,
  }));

  return [...staticRoutes, ...toolRoutes];
}
