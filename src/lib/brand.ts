/**
 * The pdf.xyz identity — the Folded P — as data, once.
 *
 * A petrol P whose top-right corner is a cyan page fold: a document corner and
 * a monogram in one shape. In the horizontal logo the P IS the first letter of
 * the name, followed by `df.xyz`; there is no second p. Geometry and colours
 * are the owner's brand pack (`PDFXYZ-Logo-Pack`, revision 2, 2026-10-21):
 * the path data below is copied verbatim from its SVG masters, and the pack's
 * print files and guidelines PDF stay out of the repo.
 *
 * EVERY SURFACE DRAWS FROM HERE. The header and footer lockup (`logo.tsx`),
 * the social cards and the app icons (`og.tsx`), the tab icon a finished run
 * marks (`tab-signal-engine.ts`) and the favicon bytes (`pnpm icon:favicon`)
 * import these strings. `src/app/icon.svg` cannot import, so it restates them
 * and `og-identity.test.ts` holds it to them.
 *
 * The previous mark — an accent square beside a mono wordmark, and an ink
 * tile with the square and trim ticks for the icons — was retired here.
 */

/**
 * The pack's palette (`06-guidelines/brand-colors.css`). Ink, petrol and paper
 * ARE the site's light tokens (`--sf-fg`, `--sf-accent`, `--sf-canvas`), and
 * `og-identity.test.ts` binds them to globals.css; cyan and the dark-surface
 * values exist only in the identity.
 */
export const BRAND = {
  ink: "#10151a",
  petrol: "#07567a",
  cyan: "#0891b2",
  paper: "#f4f6f8",
  white: "#ffffff",
  /** The P and the dot on a dark ground. */
  darkMark: "#68d5ef",
  /** `.xyz` on a dark ground. */
  darkSuffix: "#a9e9f8",
  /** The fold on a dark ground. */
  darkFold: "#c6f4ff",
} as const;

/** The P's body, in its own 128 x 176 box; even-odd, so the counter is open. */
export const P_BODY =
  "M20 0H84L128 44V92C128 119 110 137 83 137H42V176H0V20C0 9 9 0 20 0Z M42 54V102H78C85 102 89 98 89 91V65C89 58 85 54 78 54Z";

/** The corner fold, in the same box. */
export const P_FOLD = "M84 0L128 44H96C89.373 44 84 38.627 84 32Z";

/** What each part of the horizontal logo is, for colour. */
export type LogoRole = "mark" | "fold" | "letters" | "suffix" | "dot";

/** Where the P sits in the horizontal logo: its bowl on the baseline, its stem the descender. */
export const LOGO_P_TRANSFORM = "translate(0 34) scale(.8)";

/** The lettering after the P — `df` in the letter colour, `xyz` in the suffix colour. */
export const LOGO_GLYPHS: readonly {
  role: "letters" | "suffix";
  x: number;
  d: string;
}[] = [
  {
    role: "letters",
    x: 118,
    d: "M95 0H128V144H95V130C85 141 73 147 56 147C22 147 0 123 0 92C0 61 22 37 56 37C73 37 85 42 95 54Z M89 92C89 75 78 65 62 65C47 65 36 75 36 92C36 109 47 119 62 119C78 119 89 109 89 92Z",
  },
  {
    role: "letters",
    x: 254,
    d: "M24 40V29C24 9 36 -2 59 -2C70 -2 80 0 86 3V32C80 30 75 29 69 29C61 29 57 33 57 40H85V67H57V144H24V67H5V40Z",
  },
  {
    role: "suffix",
    x: 411,
    d: "M0 40H38L59 74L80 40H118L80 91L119 144H81L58 109L36 144H0L39 91Z",
  },
  {
    role: "suffix",
    x: 534,
    d: "M0 40H37L62 107L85 40H121L76 156C68 178 56 186 35 186C25 186 19 184 12 182L18 154C23 156 28 157 33 157C41 157 46 153 49 145Z",
  },
  {
    role: "suffix",
    x: 664,
    d: "M0 40H108V65L47 115H108V144H0V119L61 69H0Z",
  },
];

/** The dot of `.xyz`, which echoes the fold. */
export const LOGO_DOT = { cx: 379, cy: 128, r: 17 } as const;

/**
 * The logo's box, cropped to its ink: x 0-772 (the P's stem to the z), y -2
 * (the f's hook) to 186 (the y's tail). The pack's masters add 18 units of
 * clear space on every side; a page gives that space with its own layout.
 */
export const LOGO_VIEWBOX = "0 -2 772 188";
export const LOGO_ASPECT = 772 / 188;

/** Each part's colour on a light ground (`light`) and on a dark one (`dark`). */
export const LOGO_COLOURS: Record<
  "light" | "dark",
  Record<LogoRole, string>
> = {
  light: {
    mark: BRAND.petrol,
    fold: BRAND.cyan,
    letters: BRAND.ink,
    suffix: BRAND.petrol,
    dot: BRAND.cyan,
  },
  dark: {
    mark: BRAND.darkMark,
    fold: BRAND.darkFold,
    letters: BRAND.white,
    suffix: BRAND.darkSuffix,
    dot: BRAND.darkMark,
  },
};

/** The horizontal logo as a standalone SVG document, for a raster renderer. */
export function logoSvg(scheme: "light" | "dark"): string {
  const c = LOGO_COLOURS[scheme];
  const glyphs = LOGO_GLYPHS.map(
    (g) =>
      `<path fill="${c[g.role]}" fill-rule="evenodd" transform="translate(${g.x} 0)" d="${g.d}"/>`,
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}">` +
    `<g transform="${LOGO_P_TRANSFORM}">` +
    `<path fill="${c.mark}" fill-rule="evenodd" d="${P_BODY}"/>` +
    `<path fill="${c.fold}" d="${P_FOLD}"/></g>` +
    glyphs +
    `<circle cx="${LOGO_DOT.cx}" cy="${LOGO_DOT.cy}" r="${LOGO_DOT.r}" fill="${c.dot}"/>` +
    `</svg>`
  );
}

/**
 * The square icon: a white P with its cyan fold on a petrol ground.
 *
 * `favicon` is the browser-tab tile — rounded, its outer corners transparent,
 * the P large enough to read at 16 px. `app` is the home-screen and PWA icon —
 * the ground runs to every edge (the OS applies its own mask) and the P sits
 * inside the maskable safe zone, the 80% circle. Both are the pack's
 * (`03-web-ready/favicon.svg`, `pdfxyz-app-icon.svg`), normalised to 128.
 * `extra` is drawn on top: the tab signal's ring.
 */
export function tileSvg(kind: "favicon" | "app", extra = ""): string {
  const ground =
    kind === "favicon"
      ? `<rect width="128" height="128" rx="24.32" fill="${BRAND.petrol}"/>`
      : `<rect width="128" height="128" fill="${BRAND.petrol}"/>`;
  const place =
    kind === "favicon"
      ? "translate(33.28 21.76) scale(.48)"
      : "translate(39.796 30.72) scale(.378181)";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
    ground +
    `<g transform="${place}">` +
    `<path fill="${BRAND.white}" fill-rule="evenodd" d="${P_BODY}"/>` +
    `<path fill="${BRAND.cyan}" d="${P_FOLD}"/></g>` +
    extra +
    `</svg>`
  );
}
