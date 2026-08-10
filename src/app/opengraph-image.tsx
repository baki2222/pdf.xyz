import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { siteConfig } from "@/lib/site";
import { OG_BACKGROUND_IMAGE } from "@/lib/og";
import { toolCount } from "@/lib/tools";

// Generated at build time (no dynamic params), so the fonts are read from disk
// once during `next build` and the PNG is emitted as a static asset.
export const runtime = "nodejs";
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) =>
  readFile(join(process.cwd(), "src/assets/fonts", file));

export default async function OpengraphImage() {
  const [bold, regular] = await Promise.all([
    font("Inter-Bold.woff"),
    font("Inter-Regular.woff"),
  ]);

  const chips = [`${toolCount} tools`, "Runs in your browser", "No sign-up"];

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
      {/* Wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 84,
            height: 84,
            borderRadius: 22,
            background:
              "linear-gradient(135deg, #8b5cf6, #6366f1 55%, #3b82f6)",
            boxShadow: "0 12px 40px rgba(99,102,241,0.45)",
          }}
        >
          <div
            style={{
              width: 40,
              height: 50,
              borderRadius: 7,
              background: "#ffffff",
            }}
          />
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
          <span>pdf</span>
          <span style={{ color: "#a5b4fc" }}>.xyz</span>
        </div>
      </div>

      {/* Headline block */}
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
          Privacy-first PDF platform
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 82,
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: -2,
          }}
        >
          <span>Every PDF tool.</span>
          <span style={{ color: "#93c5fd" }}>Private by design.</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#94a3b8",
            maxWidth: 900,
          }}
        >
          Merge, split, compress, convert, edit, sign, and run AI — most tools
          run entirely in your browser.
        </div>
      </div>

      {/* Footer chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {chips.map((chip) => (
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
    </div>,
    {
      ...size,
      fonts: [
        { name: "Inter", data: bold, weight: 700, style: "normal" },
        { name: "Inter", data: regular, weight: 400, style: "normal" },
      ],
    },
  );
}
