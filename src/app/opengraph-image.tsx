import { siteConfig } from "@/lib/site";
import { OG_CONTENT_TYPE, OG_SIZE, renderSocialImage } from "@/lib/og";

/**
 * The card behind every link to the front page.
 *
 * WAS 140 LINES OF ITS OWN. It loaded its own fonts, restated the palette in
 * eight literal hexes, and hand-drew a wordmark: a violet gradient tile with a
 * white document glyph. `logo.tsx` retired that mark — "which is to say:
 * everyone's mark" — and `renderSocialImage` in `@/lib/og` had already been
 * rebuilt on the new identity. Nothing called it. The route's copy won by
 * being the copy Next.js looks for, and the site's most-shared image went on
 * serving the old brand for as long as anyone cared to measure.
 *
 * Generated at build time (no dynamic params), so fonts are read from disk once
 * during `next build` and the PNG is emitted as a static asset.
 */
export const runtime = "nodejs";
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function OpengraphImage() {
  return renderSocialImage();
}
