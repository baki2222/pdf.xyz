import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site";
import { OG_BACKGROUND_IMAGE, OgWordmark, loadCardFonts } from "@/lib/og";
import { categories, toolCount } from "@/lib/tools";

/**
 * Share card for the tool catalogue.
 *
 * `/tools` is the page people link to when they recommend the product as a whole
 * ("just use pdf.xyz/tools"), and until now it fell back to the site-wide brand
 * card — the same image the homepage shows, saying nothing about what is behind
 * the link. This one leads with the count and the categories, because breadth is
 * the reason someone shares this URL rather than a single tool.
 *
 * Generating the image is only half of it: `buildMetadata` always sets an explicit
 * `openGraph.images`, and an explicit value beats the file convention — so
 * `page.tsx` must point `imagePath` here by hand or this file is never used. Both
 * halves or neither; `src/lib/seo.test.ts` guards the pairing.
 */
export const runtime = "nodejs";
export const alt = `${siteConfig.name} — all ${toolCount} PDF tools`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function ToolsOpengraphImage() {
  const fonts = await loadCardFonts();

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

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
            The complete toolkit
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 104,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: -2,
            }}
          >
            {toolCount} PDF tools
          </div>
          <div style={{ display: "flex", fontSize: 32, color: "#94a3b8", maxWidth: 940 }}>
            Merge, split, compress, convert, sign, secure — and see exactly where
            each one runs before you upload anything.
          </div>
        </div>

        {/* The categories double as proof of the breadth the headline claims. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {categories.map((category) => (
            <div
              key={category.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 20px",
                borderRadius: 9999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.05)",
                fontSize: 22,
                color: "#e2e8f0",
              }}
            >
              {category.name}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
