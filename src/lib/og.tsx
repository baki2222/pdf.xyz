import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { toolCount } from "./tools";
import { processingSplit } from "./tools/processing-split";

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
  /** `--sf-accent`, dark: the mark square, `.xyz`, and the second headline. */
  accent: "#53c1ee",
  /** `--sf-ok`, dark: the one line on a card that is a privacy claim. */
  ok: "#34d399",
  /**
   * `--sf-invert`, LIGHT: the ink tile the accent square sits on.
   *
   * Only the favicon and the app icons use it. The site's own lockup is a bare
   * accent square beside the wordmark with no tile at all (`logo.tsx`), and the
   * cards render it that way too; an icon cannot, because a 32px square on
   * transparency is not a mark.
   */
  tile: "#10151a",
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

/**
 * The lockup every card opens with: the site's own, not a card-shaped variant.
 *
 * `logo.tsx` renders a bare accent square beside a mono wordmark, `pdf` in the
 * foreground and `.xyz` muted. This restates those proportions at card scale —
 * the header sets a 10px square against 17px text, so a 40px wordmark takes a
 * 24px square — and `og-identity.test.ts` reads the classes off `logo.tsx` to
 * check the two still agree about which part is the accent.
 *
 * WAS a 72px rounded tile with the square inside it and `.xyz` in the accent:
 * a lockup that existed on no page of the site.
 */
export function OgWordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 23 }}>
      <div style={{ width: 24, height: 24, background: CARD.accent }} />
      <div
        style={{
          display: "flex",
          fontFamily: "Geist Mono",
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: CARD.fg,
        }}
      >
        <span>pdf</span>
        <span style={{ color: CARD.muted }}>.xyz</span>
      </div>
    </div>
  );
}

/**
 * The pdf.xyz mark: an ink tile, trim-mark corner ticks, and the accent square
 * the header wordmark uses. Kept in sync with `src/app/icon.svg` (the static
 * favicon) so every surface reads the same.
 *
 * IT WAS NOT, AND "KEPT IN SYNC" WAS THE WHOLE PROBLEM. The sentence above was
 * true of this file and icon.svg and false of the product: the header retired
 * the violet gradient tile and its document glyph — logo.tsx calls it
 * "everyone's mark" — while these two copies went on rendering it into the
 * browser tab, the installed icon and every social preview. Two files agreeing
 * with each other is not the same as agreeing with the site, and no test could
 * tell the difference: the e2e check asserts only that the card returns 200
 * with an image content-type. `src/lib/og-identity.test.ts` now binds the mark
 * to the palette and to icon.svg.
 */
const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${CARD.tile}"/>
  <g stroke="${CARD.accent}" stroke-width="1.15" fill="none" stroke-linecap="square">
    <path d="M6.5 6.5 H10 M6.5 6.5 V10"/>
    <path d="M25.5 6.5 H22 M25.5 6.5 V10"/>
    <path d="M6.5 25.5 H10 M6.5 25.5 V22"/>
    <path d="M25.5 25.5 H22 M25.5 25.5 V22"/>
  </g>
  <rect x="12.25" y="12.25" width="7.5" height="7.5" fill="${CARD.accent}"/>
</svg>`;

const BRAND_MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(
  BRAND_MARK_SVG,
).toString("base64")}`;

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

/** Render a square brand mark at `size` px — used for the PWA/Apple icons. */
export function renderBrandMark(size: number): ImageResponse {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <img src={BRAND_MARK_DATA_URI} width={size} height={size} alt="" />
    </div>,
    { width: size, height: size },
  );
}
