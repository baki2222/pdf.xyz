import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site";
import {
  CARD,
  CARD_CHIP,
  OG_BACKGROUND_IMAGE,
  OgWordmark,
  loadCardFonts,
} from "@/lib/og";
import { getAllToolSlugs, getToolBySlug, getCategory } from "@/lib/tools";
import { getProcessingMeta } from "@/lib/tools/processing";

/**
 * Per-tool share card.
 *
 * A shared tool link is the main way this product travels, so the card leads
 * with the one thing competitors do not say up front: where the file is
 * actually processed. The processing chip is the same honest label the tool
 * page shows, in the same colour, so the promise made in a Slack preview is the
 * promise the page keeps.
 *
 * This file only GENERATES the image. It is not picked up automatically: an
 * explicit `openGraph.images` from `generateMetadata` wins over the file
 * convention, and `buildMetadata` always sets one. The tool page therefore
 * points `imagePath` at this route by hand. Without both halves, tool pages fall
 * back to the site-wide card — or, before `buildMetadata` carried an image at
 * all, to no share image whatsoever.
 */
export const runtime = "nodejs";
export const alt = `${siteConfig.name} — PDF tool`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Pre-render one card per tool at build time, matching the tool pages. */
export function generateStaticParams(): { slug: string }[] {
  return getAllToolSlugs().map((slug) => ({ slug }));
}

/**
 * The catalogue is the complete set of slugs, so anything outside it is a 404.
 *
 * This is declared for the same reason as on the page, but it does NOT do the
 * job on its own here: measured on Next 16.2.9, a metadata image route still
 * runs for a param outside `generateStaticParams` and answers 200. Hence the
 * explicit refusal in the handler below. The config alone would have been a
 * fix that looks right and changes nothing.
 */
export const dynamicParams = false;

/**
 * REMOVED: a `PROCESSING_TONE` table restating all four mode hues as literal
 * colours, under a comment explaining that Satori has no Tailwind. True, and
 * it is the reason the hue belongs in `processing.ts` with both syntaxes
 * beside each other — not the reason to keep a third copy here.
 */

export default async function ToolOpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);

  // A card for a page that 404s is a share preview for nothing, and it made
  // `/tools/<anything>/opengraph-image` an unbounded set of URLs that each
  // rendered a PNG. Refuse before doing any of that work.
  if (!tool) return new Response(null, { status: 404 });

  const fonts = await loadCardFonts();
  const name = tool.name;
  const tagline = tool.tagline;
  const category = getCategory(tool.category);
  const processing = getProcessingMeta(tool.processing);
  const tone = processing.hue.card;

  // Long tool names would otherwise overflow the card and clip mid-word.
  const nameFontSize = name.length > 22 ? 72 : name.length > 15 ? 88 : 104;

  const formatChips = [
    ...(tool.accept.length ? [`In: ${tool.accept.join(", ")}`] : []),
    ...(tool.outputs.length ? [`Out: ${tool.outputs.join(", ")}`] : []),
  ];

  return new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "72px 80px",
        backgroundImage: OG_BACKGROUND_IMAGE,
        color: CARD.fg,
        fontFamily: "Geist",
      }}
    >
      <OgWordmark />

      {/* Tool identity */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {category ? (
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: CARD.accent,
            }}
          >
            {category.name}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            fontSize: nameFontSize,
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: -2,
          }}
        >
          {name}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 32,
            color: CARD.muted,
            maxWidth: 940,
          }}
        >
          {tagline}
        </div>
      </div>

      {/* The honest bit: where this tool actually runs. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {processing && tone ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 24px",
              borderRadius: 9999,
              border: `1px solid ${tone.border}`,
              background: tone.background,
              fontSize: 24,
              fontWeight: 700,
              color: tone.text,
            }}
          >
            {processing.label}
          </div>
        ) : null}
        {formatChips.map((chip) => (
          <div
            key={chip}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 22px",
              borderRadius: 9999,
              border: `1px solid ${CARD_CHIP.border}`,
              background: CARD_CHIP.background,
              fontSize: 24,
              color: CARD.fg,
            }}
          >
            {chip}
          </div>
        ))}
      </div>
    </div>,
    { ...size, fonts },
  );
}
