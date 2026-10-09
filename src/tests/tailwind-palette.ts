/**
 * Tailwind's palette as sRGB, for tests that need to measure a palette class.
 *
 * Tailwind v4 defines every palette step in `oklch()` in its own
 * `theme.css`; this reads that file — the one the build compiles — rather
 * than a hand-copied hex, so a Tailwind upgrade that moves a colour moves
 * every measurement with it. The conversion is CSS Color 4's OKLab → linear
 * sRGB → gamma-encoded sRGB, with out-of-gamut channels CLIPPED, which is
 * what Chromium paints for an `oklch()` outside sRGB on an sRGB display.
 *
 * Not a substitute for a browser measurement (`pnpm a11y:contrast` reads
 * painted pixels, for text): it exists for the non-text marks that audit
 * cannot see, and its own positive control is pure sRGB red, whose oklch
 * coordinates are published.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Rgb } from "@/lib/a11y/contrast";

/** `oklch(L C H)`, L in 0–1, to sRGB in 0–255. */
export function oklchToRgb(l: number, c: number, h: number): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const encode = (x: number) => {
    const v = Math.min(Math.max(x, 0), 1);
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  };
  return {
    r: encode(linear[0]!),
    g: encode(linear[1]!),
    b: encode(linear[2]!),
  };
}

let theme: string | undefined;

/** A Tailwind palette colour (`"violet-600"`) as sRGB, read from Tailwind's theme. */
export function tailwindColour(name: string): Rgb {
  theme ??= readFileSync(
    path.join(process.cwd(), "node_modules", "tailwindcss", "theme.css"),
    "utf8",
  );
  const prefix = `--color-${name}: oklch(`;
  const at = theme.indexOf(prefix);
  if (at === -1) throw new Error(`Tailwind's theme defines no --color-${name}`);
  const body = theme.slice(at + prefix.length, theme.indexOf(")", at));
  const [l, c, h] = body.trim().split(/\s+/);
  if (!l?.endsWith("%") || c === undefined || h === undefined)
    throw new Error(`--color-${name} is not an oklch(L% C H): ${body}`);
  return oklchToRgb(parseFloat(l) / 100, parseFloat(c), parseFloat(h));
}
