import type { RgbaImage } from "../signature-image";
import { SIGNATURE_INK } from "./model";

/**
 * The inks a signature can be made in (audit sign-pdf#2, 2026-11-06).
 *
 * Black comes first and is the ink Sign PDF has always used, so leaving the
 * choice alone changes nothing; blue is there because many people and
 * institutions sign in blue so the original tells apart from a photocopy.
 * The panel names each swatch by its label; the drawn pad strokes in it and
 * its pixels are tinted to it when exported (`tintInk`), and a typed
 * signature's text is filled with it (`typedSignatureObject`).
 *
 * Feature-scoped: imported by the editor's lazy chunk (the signature panel
 * and pad) and by the server-rendered copy that names the swatches
 * (`content/sign-pdf.ts`, `guides/catalog.ts`).
 */
export const SIGNATURE_INKS = [
  { id: "black", label: "Black", hex: SIGNATURE_INK },
  { id: "blue", label: "Blue", hex: "#1d4ed8" },
  { id: "red", label: "Red", hex: "#b91c1c" },
  { id: "green", label: "Green", hex: "#15803d" },
] as const;

export type SignatureInk = (typeof SIGNATURE_INKS)[number];

/** `#rrggbb` → [r, g, b], 0–255. */
export function inkRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace(/^#/, ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Every pixel of a drawing in `hex`, its alpha untouched: the pad draws one
 * ink on a transparent canvas, so this recolours the strokes, anti-aliased
 * edges included, and a change of ink after drawing reaches what was drawn.
 */
export function tintInk(img: RgbaImage, hex: string): RgbaImage {
  const [r, g, b] = inkRgb(hex);
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return { width: img.width, height: img.height, data };
}
