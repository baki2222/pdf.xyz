import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { toolCount } from "./tools";

/**
 * Server-only helpers for generating brand imagery at build time — Open Graph /
 * Twitter cards and the PWA/app icons. Everything is rendered locally (brand
 * font loaded from disk, mark inlined as SVG), so image generation never touches
 * the network. Import this only from route/metadata files that run on the server.
 */

/** Social card dimensions (Open Graph + Twitter `summary_large_image`). */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/**
 * The pdf.xyz mark: a gradient rounded square + document glyph. Kept in sync
 * with `src/app/icon.svg` (the static favicon) so every surface reads the same.
 */
const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="0.5" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="url(#g)"/>
  <g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 2.75h7L18.25 8v11.5a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 5.25 19.5V4.5A1.75 1.75 0 0 1 6 2.75Z"/>
    <path d="M13 3v5h5"/>
    <path d="M8.5 13.5h5M8.5 16.5h3"/>
  </g>
</svg>`;

const BRAND_MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(
  BRAND_MARK_SVG,
).toString("base64")}`;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

/** Load Geist (the brand font) from node_modules — never fetched over the wire. */
async function loadBrandFonts() {
  const dir = join(
    process.cwd(),
    "node_modules/geist/dist/fonts/geist-sans",
  );
  const [regular, semibold, bold] = await Promise.all([
    readFile(join(dir, "Geist-Regular.ttf")),
    readFile(join(dir, "Geist-SemiBold.ttf")),
    readFile(join(dir, "Geist-Bold.ttf")),
  ]);
  return [
    { name: "Geist", data: toArrayBuffer(regular), weight: 400 as const, style: "normal" as const },
    { name: "Geist", data: toArrayBuffer(semibold), weight: 600 as const, style: "normal" as const },
    { name: "Geist", data: toArrayBuffer(bold), weight: 700 as const, style: "normal" as const },
  ];
}

/** Render the 1200×630 social card used for Open Graph and Twitter. */
export async function renderSocialImage(): Promise<ImageResponse> {
  const fonts = await loadBrandFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          fontFamily: "Geist",
          color: "#f8fafc",
          background:
            "radial-gradient(1100px 620px at 8% -20%, #2b1d6b 0%, rgba(6,6,17,0) 55%), radial-gradient(900px 620px at 108% 8%, #123a6b 0%, rgba(6,6,17,0) 52%), #060611",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <img src={BRAND_MARK_DATA_URI} width={76} height={76} alt="" />
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>
            <span>pdf</span>
            <span style={{ color: "#8ab4ff" }}>.xyz</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", fontSize: 82, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Every PDF tool.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 82,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#a5b4fc",
            }}
          >
            Private by design.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 27,
            color: "#94a3b8",
          }}
        >
          <div style={{ display: "flex" }}>
            {toolCount}+ tools · merge, split, compress, convert, sign, AI
          </div>
          <div style={{ display: "flex", color: "#34d399", fontWeight: 600 }}>
            Runs in your browser
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}

/** Render a square brand mark at `size` px — used for the PWA/Apple icons. */
export function renderBrandMark(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        <img src={BRAND_MARK_DATA_URI} width={size} height={size} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
