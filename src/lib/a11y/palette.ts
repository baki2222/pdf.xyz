/**
 * Measured colour facts about this product's dark theme.
 *
 * Every number here was OBSERVED, not looked up. Tailwind v4 defines its
 * palette in oklch and Chromium serialises computed colours in the same space,
 * so `getComputedStyle(el).color` on this site returns strings like
 * `oklch(0.554 0.046 257.417)` — not something a hand-written `rgb()` parser
 * can read. The sRGB values below were produced by handing each token to a 2D
 * canvas in Chromium 141 and reading back the painted pixel
 * (`scripts/a11y-contrast-audit.ts` uses the same technique at runtime).
 *
 * Regenerate them the same way if Tailwind's palette moves; do not hand-convert.
 */

import type { Rgb } from "./contrast";

/** Tailwind v4 `--color-slate-*`, resolved to sRGB by Chromium on 2026-08-05. */
export const SLATE: Record<number, Rgb> = {
  50: { r: 248, g: 250, b: 252 },
  100: { r: 241, g: 245, b: 249 },
  200: { r: 226, g: 232, b: 240 },
  300: { r: 202, g: 213, b: 226 },
  400: { r: 144, g: 161, b: 185 },
  500: { r: 98, g: 116, b: 142 },
  600: { r: 69, g: 85, b: 108 },
  700: { r: 49, g: 65, b: 88 },
  800: { r: 29, g: 41, b: 61 },
  900: { r: 15, g: 23, b: 43 },
  950: { r: 2, g: 6, b: 24 },
};

/**
 * The lightest background pixel measured underneath muted body text anywhere in
 * the audited product surface — `rgb(28, 27, 65)`, on a tool page.
 *
 * This is the load-bearing constant, and it is a MEASUREMENT rather than
 * `--color-ink`. The theme's base ink is `#060611`, but nothing sits directly
 * on it: `body::before` paints an ambient violet/blue gradient above the body
 * colour, and the product's panels are translucent glass stacked on top of
 * that. Text therefore sits on a composite that is materially lighter than the
 * token — and for light-on-dark, lighter background means LESS contrast. Using
 * `--color-ink` here would flatter every colour by roughly 0.8 of a ratio point.
 *
 * Because contrast is monotone in background luminance, checking against the
 * lightest observed background is sufficient for every darker one — which is
 * what lets a single constant stand in for hundreds of individual sites.
 *
 * Source: `pnpm a11y:contrast` over 12 routes × 2 viewports, 2958 text runs,
 * 2026-08-05.
 */
export const LIGHTEST_TEXT_BACKGROUND: Rgb = { r: 28, g: 27, b: 65 };
