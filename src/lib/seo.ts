import type { Metadata } from "next";
import { siteConfig } from "./site";

interface BuildMetadataArgs {
  title?: string;
  description?: string;
  path?: string;
  keywords?: string[];
  noIndex?: boolean;
  /**
   * Route of a page-specific share card, e.g. `/tools/merge-pdf/opengraph-image`.
   * Defaults to the site-wide card. Pass this rather than relying on a segment's
   * `opengraph-image` file being picked up: an explicit `images` here wins over
   * the file convention, so a page that wants its own card must say so.
   */
  imagePath?: string;
  /** Alt text for a page-specific share card. */
  imageAlt?: string;
}

/**
 * The site-wide share card route.
 *
 * Returning an `openGraph` object from a nested segment REPLACES the one the
 * root segment resolved — including the image contributed by the root
 * `opengraph-image` file. Every page built here therefore has to carry an image
 * of its own, or it ships a share card with no picture at all.
 */
const DEFAULT_SHARE_IMAGE_PATH = "/opengraph-image";

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
  imagePath = DEFAULT_SHARE_IMAGE_PATH,
  imageAlt = `${siteConfig.name} — ${siteConfig.tagline}`,
}: BuildMetadataArgs = {}): Metadata {
  const url = new URL(path, siteConfig.url).toString();
  const socialTitle = title ? `${title} — ${siteConfig.name}` : siteConfig.name;
  const shareImage = new URL(imagePath, siteConfig.url).toString();

  return {
    // Omit the key entirely rather than passing `title: undefined`. Next treats
    // a title that is PRESENT-but-undefined as the page declaring it has none,
    // which overrides the root layout's `title.default` and leaves the document
    // with no title at all — the homepage's exact case, since it calls this with
    // no title of its own. An absent key is what falls back to the default.
    ...(title === undefined ? {} : { title }),
    description,
    keywords: [...siteConfig.keywords, ...keywords],
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: siteConfig.name,
      title: socialTitle,
      description,
      locale: siteConfig.locale,
      images: [{ url: shareImage, width: 1200, height: 630, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      creator: "@pdfxyz",
      images: [shareImage],
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}
