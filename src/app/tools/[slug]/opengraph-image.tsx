import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site";
import { OG_BACKGROUND_IMAGE, OgWordmark, loadCardFonts } from "@/lib/og";
import { getAllToolSlugs, getToolBySlug, getCategory } from "@/lib/tools";
import { getProcessingMeta } from "@/lib/tools/processing";
import type { ProcessingMode } from "@/lib/tools/types";

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

/** Satori has no Tailwind, so the chip tones are restated as literal colours. */
const PROCESSING_TONE: Record<
  ProcessingMode,
  { text: string; border: string; background: string }
> = {
  client: {
    text: "#6ee7b7",
    border: "rgba(52,211,153,0.32)",
    background: "rgba(52,211,153,0.12)",
  },
  server: {
    text: "#93c5fd",
    border: "rgba(96,165,250,0.32)",
    background: "rgba(96,165,250,0.12)",
  },
  hybrid: {
    text: "#67e8f9",
    border: "rgba(34,211,238,0.32)",
    background: "rgba(34,211,238,0.12)",
  },
  ai: {
    text: "#c4b5fd",
    border: "rgba(167,139,250,0.32)",
    background: "rgba(167,139,250,0.12)",
  },
};

export default async function ToolOpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  const fonts = await loadCardFonts();

  // An unknown slug still 404s as a page; the image just falls back to the
  // brand line rather than throwing during static generation.
  const name = tool?.name ?? siteConfig.name;
  const tagline = tool?.tagline ?? siteConfig.tagline;
  const category = tool ? getCategory(tool.category) : undefined;
  const processing = tool ? getProcessingMeta(tool.processing) : undefined;
  const tone = tool ? PROCESSING_TONE[tool.processing] : undefined;

  // Long tool names would otherwise overflow the card and clip mid-word.
  const nameFontSize = name.length > 22 ? 72 : name.length > 15 ? 88 : 104;

  const formatChips = [
    ...(tool?.accept?.length ? [`In: ${tool.accept.join(", ")}`] : []),
    ...(tool?.outputs?.length ? [`Out: ${tool.outputs.join(", ")}`] : []),
  ];

  return new ImageResponse(
    (
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
          color: "#ffffff",
          fontFamily: "Inter",
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
                color: "#a5b4fc",
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
              color: "#94a3b8",
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
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.05)",
                fontSize: 24,
                color: "#e2e8f0",
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
