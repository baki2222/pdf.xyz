import type { Metadata } from "next";
import { siteConfig } from "./site";

interface BuildMetadataArgs {
  title?: string;
  description?: string;
  path?: string;
  keywords?: string[];
  noIndex?: boolean;
}

/**
 * Build consistent, SEO-complete metadata for any page. Titles are templated
 * as "Page — pdf.xyz" via the root layout's title.template.
 */
export function buildMetadata({
  title,
  description = siteConfig.description,
  path = "/",
  keywords = [],
  noIndex = false,
}: BuildMetadataArgs = {}): Metadata {
  const url = new URL(path, siteConfig.url).toString();

  return {
    title,
    description,
    keywords: [...siteConfig.keywords, ...keywords],
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: siteConfig.name,
      title: title ? `${title} — ${siteConfig.name}` : siteConfig.name,
      description,
      locale: siteConfig.locale,
    },
    twitter: {
      card: "summary_large_image",
      title: title ? `${title} — ${siteConfig.name}` : siteConfig.name,
      description,
      creator: "@pdfxyz",
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}
