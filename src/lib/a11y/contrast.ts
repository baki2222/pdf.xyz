/**
 * WCAG 2.1 contrast math.
 *
 * Kept dependency-free and side-effect-free so it can be unit-tested directly
 * and imported by both the Playwright audit driver (`scripts/a11y-contrast-audit.ts`)
 * and any future in-app check.
 *
 * The one thing worth knowing before using this: for light text on a dark
 * background the contrast ratio is MONOTONE DECREASING in the background's
 * relative luminance. That is what makes a single worst-case background
 * measurement sufficient for a whole palette decision — if a foreground passes
 * against the lightest background it renders on, it passes against every darker
 * one. `contrastRatio` is symmetric, so this property holds only while the
 * background stays darker than the text; assert that before relying on it.
 */

export type Rgb = { r: number; g: number; b: number };
export type Rgba = Rgb & { a: number };

/** Parse `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)`. Returns null if unparseable. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const digits = hex[1] ?? "";
    const nibble = (i: number) => parseInt(digits.charAt(i).repeat(2), 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: nibble(0),
        g: nibble(1),
        b: nibble(2),
        a: digits.length === 4 ? nibble(3) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      const pair = (i: number) => parseInt(digits.slice(i, i + 2), 16);
      return {
        r: pair(0),
        g: pair(2),
        b: pair(4),
        a: digits.length === 8 ? pair(6) / 255 : 1,
      };
    }
    return null;
  }

  // `rgb(0 0 0 / 50%)` and `rgba(0, 0, 0, 0.5)` are both emitted by browsers.
  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!fn?.[1]) return null;
  const parts = fn[1]
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  const [rawR, rawG, rawB, rawA] = parts;
  if (rawR === undefined || rawG === undefined || rawB === undefined) {
    return null;
  }
  const channel = (raw: string) =>
    raw.endsWith("%") ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
  const alpha = (raw: string | undefined) => {
    if (raw === undefined) return 1;
    return raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
  };
  const rgba = {
    r: channel(rawR),
    g: channel(rawG),
    b: channel(rawB),
    a: alpha(rawA),
  };
  return Object.values(rgba).some((n) => Number.isNaN(n)) ? null : rgba;
}

/** Source-over composite of a (possibly translucent) colour onto an opaque one. */
export function compositeOver(top: Rgba, bottom: Rgb): Rgb {
  const a = Math.min(Math.max(top.a, 0), 1);
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
  };
}

function channelLuminance(value255: number): number {
  const c = Math.min(Math.max(value255, 0), 255) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG contrast ratio, 1 to 21. Symmetric in its arguments. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG 1.4.3 "large scale" text: at least 18pt (24px), or 14pt (18.66px) bold.
 * The pt→px conversion is the one the spec itself uses (1pt = 4/3 px).
 */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  if (fontSizePx >= 24) return true;
  return fontWeight >= 700 && fontSizePx >= 18.66;
}

/** Minimum ratio for WCAG 2.1 AA (1.4.3) at the given type size. */
export function requiredRatioAA(
  fontSizePx: number,
  fontWeight: number,
): number {
  return isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;
}
