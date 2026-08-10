import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site";
import { OG_BACKGROUND_IMAGE, OgWordmark, loadCardFonts } from "@/lib/og";

/**
 * Share card for the workspace.
 *
 * The page is `noIndex`, which is about search engines, not about link previews —
 * a workspace URL pasted into Slack still renders a card, and until now that card
 * was the generic site-wide one.
 *
 * It leads with the privacy claim because that is the only interesting thing about
 * this page and, unusually, it is literally true: the workspace stages files in the
 * browser and uploads nothing. Sharing the link shares the feature, never a file —
 * which is exactly why the card can afford to say so.
 *
 * As with the other page cards, `page.tsx` must point `imagePath` here — an
 * explicit `openGraph.images` from `buildMetadata` beats the file convention.
 */
export const runtime = "nodejs";
export const alt = `${siteConfig.name} — a private, in-browser PDF workspace`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function WorkspaceOpengraphImage() {
  const fonts = await loadCardFonts();

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
          Workspace
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 88,
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: -2,
          }}
        >
          <span>Your files never</span>
          <span style={{ color: "#6ee7b7" }}>leave the browser.</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 32,
            color: "#94a3b8",
            maxWidth: 940,
          }}
        >
          Stage a batch, get tool suggestions from the file mix, and queue the
          work — all locally, with nothing uploaded.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {["Stays on device", "No account", "Clear it any time"].map((chip) => (
          <div
            key={chip}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 24px",
              borderRadius: 9999,
              // The green the product uses everywhere for "runs in your browser".
              border: "1px solid rgba(52,211,153,0.32)",
              background: "rgba(52,211,153,0.12)",
              fontSize: 24,
              fontWeight: 700,
              color: "#6ee7b7",
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
