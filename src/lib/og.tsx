import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { LOGO_ASPECT, logoSvg, tileSvg } from "./brand";
import { toolCount } from "./tools";
import { processingSplit } from "./tools/processing-split";

/**
 * Server-only helpers for generating brand imagery at build time — Open Graph /
 * Twitter cards and the PWA/app icons. Everything is rendered locally (brand
 * font loaded from disk, logo and mark inlined as SVG from `./brand`), so image
 * generation never touches the network. Import this only from route/metadata files that run on the server.
 */

/** Social card dimensions (Open Graph + Twitter `summary_large_image`). */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/**
 * Every colour a card paints, restated once.
 *
 * Satori has no Tailwind and no CSS custom properties, so a card cannot read
 * `--sf-*`; the values have to be literal somewhere. The defect is not that
 * they are literal, it is that they were literal in FIVE places — this file
 * and each of the four card routes — and the routes were the copies nobody
 * looked at. On 2026-09-20 `/opengraph-image`, the card behind every link to
 * the site's front page, was still painting the violet gradient tile the
 * header retired, because it never called `OgWordmark` at all. The library was
 * correct and the reader got the old mark.
 *
 * So: a card route may contain NO colour literal of its own. Brand chrome
 * comes from here, category hues come from `processing.ts`, and
 * `og-identity.test.ts` walks the app tree and fails any metadata route that
 * writes a hex, `rgb(` or `hsl(` itself. Values below are the dark scheme from
 * `globals.css`, and that test binds each one to the stylesheet, so editing
 * the site's palette without editing the cards is red.
 */
export const CARD = {
  /** `--sf-canvas`, dark: the ground the whole card sits on. */
  ground: "#0c1014",
  /** `--sf-panel`, dark: the lighter corner of the background sweep. */
  panel: "#131920",
  /** `--sf-fg`, dark: headline and any text that must carry the card. */
  fg: "#e8edf1",
  /** `--sf-muted`, dark: the sentence under the headline. */
  muted: "#a8b3bd",
  /** `--sf-faint`, dark: the quietest line on the card. */
  faint: "#909ba6",
  /** `--sf-accent`, dark: the eyebrow, the second headline, the glows. */
  accent: "#53c1ee",
  /** `--sf-ok`, dark: the one line on a card that is a privacy claim. */
  ok: "#34d399",
} as const;

/** Hairline and fill for the pill chips, derived from `CARD.fg` at low alpha. */
export const CARD_CHIP = {
  border: "rgba(232,237,241,0.14)",
  background: "rgba(232,237,241,0.05)",
} as const;

/**
 * The card background: base wash plus the two brand glows, as one value.
 *
 * Satori is not a browser. It does not resolve `radial-gradient(closest-side,
 * …)` — a card using that syntax renders each glow as a hard-edged disc with a
 * dark middle instead of a soft falloff — and it clips a gradient to its
 * element's box rather than letting it bleed, so glows painted onto absolutely
 * positioned child divs leave a straight seam where the box ends. Painting all
 * three layers onto the card's own background avoids both: explicit percentage
 * stops Satori understands, and no child box to clip against.
 *
 * Shared from here so the site-wide card and the per-tool cards cannot drift.
 */
export const OG_BACKGROUND_IMAGE = [
  "radial-gradient(circle at 12% 8%, rgba(83,193,238,0.22) 0%, rgba(83,193,238,0.07) 32%, rgba(83,193,238,0) 58%)",
  "radial-gradient(circle at 88% 6%, rgba(47,180,234,0.16) 0%, rgba(47,180,234,0.06) 30%, rgba(47,180,234,0) 55%)",
  `linear-gradient(135deg, ${CARD.panel} 0%, ${CARD.ground} 55%)`,
].join(", ");

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

/**
 * The faces every card is set in — Geist Sans for the headline, Geist Mono for
 * the wordmark. Read from `node_modules/geist` at build time, never fetched, so
 * a card renders identically offline.
 *
 * WAS Inter, loaded from `src/assets/fonts`, for the three page cards, while
 * the site-wide card loaded Geist "as a deliberate exception". Inter is a
 * typeface this site does not ship on a single page: the header wordmark is
 * Geist Mono, body copy is Geist Sans, headlines are Bricolage Grotesque. The
 * exception was the only card set in the right family, and the rule was the
 * drift. There is now one loader, so a new card cannot pick a face the site
 * does not use without deleting this function first.
 */
export async function loadCardFonts() {
  const sans = join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans");
  const mono = join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono");
  const [regular, semibold, bold, monoSemibold] = await Promise.all([
    readFile(join(sans, "Geist-Regular.ttf")),
    readFile(join(sans, "Geist-SemiBold.ttf")),
    readFile(join(sans, "Geist-Bold.ttf")),
    readFile(join(mono, "GeistMono-SemiBold.ttf")),
  ]);
  return [
    {
      name: "Geist",
      data: toArrayBuffer(regular),
      weight: 400 as const,
      style: "normal" as const,
    },
    {
      name: "Geist",
      data: toArrayBuffer(semibold),
      weight: 600 as const,
      style: "normal" as const,
    },
    {
      name: "Geist",
      data: toArrayBuffer(bold),
      weight: 700 as const,
      style: "normal" as const,
    },
    {
      name: "Geist Mono",
      data: toArrayBuffer(monoSemibold),
      weight: 600 as const,
      style: "normal" as const,
    },
  ];
}

/** An SVG document as an `<img>` source Satori can rasterise. */
const svgDataUri = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** The logo on every card: 56px tall, the cards' ground being dark. */
const OG_LOGO_HEIGHT = 56;
const OG_LOGO_DATA_URI = svgDataUri(logoSvg("dark"));

/**
 * The lockup every card opens with: the site's own logo, the Folded P as the
 * first letter of the name, in the pack's dark-ground variant — the same
 * paths `logo.tsx` draws, from `./brand`. `card-pixels.test.ts` finds the P
 * where the card starts.
 *
 * WAS an accent square beside the name set in Geist Mono — the previous
 * header lockup, restated at card scale; and before that a 72px rounded tile
 * with the square inside it, a lockup that existed on no page of the site.
 */
export function OgWordmark() {
  return (
    // Satori rasterises this; it never reaches a page, so next/image has no say.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={OG_LOGO_DATA_URI}
      width={Math.round(OG_LOGO_HEIGHT * LOGO_ASPECT)}
      height={OG_LOGO_HEIGHT}
      alt=""
    />
  );
}

/**
 * The site-wide social card: every link to pdf.xyz that anyone pastes anywhere.
 *
 * WAS INLINED IN `src/app/opengraph-image.tsx`, with its own font loading, its
 * own palette, and its own hand-drawn wordmark — a violet gradient tile with a
 * white document glyph, the mark `logo.tsx` retired as "everyone's mark". This
 * function existed the whole time, already on the new identity, and NOTHING
 * CALLED IT. The route had a copy, so the library was decoration: correct,
 * cheap, well-reasoned, and reaching nobody.
 *
 * The layout below is the route's (eyebrow, two-line headline, three chips),
 * because that is the card that has actually been shipping. Only the identity
 * and the palette changed. The route is now three lines of delegation, which is
 * the fix that cannot drift again — there is no second copy left to forget.
 */
/**
 * The three chips on the shared card. The middle one used to read "Runs in
 * your browser" — of a catalogue in which about two in five tools upload the
 * file to a worker. It now states the conservative union every
 * privacy-framed count takes (see `processing-split.ts`): the tools that can
 * NEVER send the file anywhere. Exported so a test reads what the card paints.
 */
export function socialCardChips(): string[] {
  return [
    `${toolCount} tools`,
    `${processingSplit().neverUploads.length} never upload your file`,
    "No sign-up",
  ];
}

export async function renderSocialImage(): Promise<ImageResponse> {
  const fonts = await loadCardFonts();
  const chips = socialCardChips();

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "72px 80px",
        backgroundImage: OG_BACKGROUND_IMAGE,
        fontFamily: "Geist",
        color: CARD.fg,
      }}
    >
      <OgWordmark />

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "flex",
            fontFamily: "Geist Mono",
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: CARD.accent,
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
            letterSpacing: "-0.025em",
          }}
        >
          <span>Every PDF tool.</span>
          <span style={{ color: CARD.accent }}>Private by design.</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: CARD.muted,
            maxWidth: 900,
          }}
        >
          Merge, split, compress, convert, edit, sign, and run AI — most tools
          run entirely in your browser.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {chips.map((chip) => (
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
    { ...OG_SIZE, fonts },
  );
}

/**
 * Render the square mark at `size` px: the white Folded P on petrol
 * (`tileSvg` in `./brand`). `app` — the default — runs the ground to the edges
 * with the P in the maskable safe zone: the Apple touch icon and both PWA
 * icons. `favicon` is the rounded tab tile: `pnpm icon:favicon` packs it at
 * 16/32/48 into `favicon.ico`, the same drawing `icon.svg` restates.
 */
export function renderBrandMark(
  size: number,
  kind: "app" | "favicon" = "app",
): ImageResponse {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori, not a page */}
      <img src={svgDataUri(tileSvg(kind))} width={size} height={size} alt="" />
    </div>,
    { width: size, height: size },
  );
}
