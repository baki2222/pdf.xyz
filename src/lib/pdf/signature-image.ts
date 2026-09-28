/**
 * Turn a drawn or uploaded signature into the bitmap that should be placed:
 * cropped to the ink, with paper keyed out, at a sensible resolution.
 *
 * The audit (at 67e8d0f) found three things wrong with what used to be
 * embedded, all silent:
 *
 *  - Drawn signatures were the WHOLE 520×180 pad. The Size control sizes the
 *    embedded image, so a signature drawn in the middle of the pad came out a
 *    fraction of the requested width and floated inside its corner; margin 0
 *    still left a visible gap.
 *  - An uploaded photo or scan of a signature on paper was embedded opaque, so
 *    it landed as a white or grey rectangle over the signature line and any
 *    text beneath it.
 *  - At full phone resolution (≈4032×3024) it was re-encoded as a lossless PNG
 *    and embedded unscaled, adding megabytes for a 200 pt mark.
 *
 * Pure pixel arithmetic on RGBA — no DOM, no canvas — so every rule here is
 * tested on synthetic pixels with known answers; the runner only decodes and
 * encodes around it.
 */

/** RGBA pixels, row-major, 4 bytes per pixel (the canvas `ImageData` shape). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PreparedSignature extends RgbaImage {
  /**
   * Every pixel is fully opaque — the paper was kept. The runner can then
   * encode it as a JPEG instead of inflating it into a lossless PNG.
   */
  opaque: boolean;
}

/** Longest edge, in pixels, of any bitmap we embed. */
export const SIGNATURE_MAX_EDGE = 1200;

/**
 * Longest edge an upload is decoded at before any of this runs. A 48 MP phone
 * photo is 192 MB of RGBA at full size; the signature is a fraction of it and
 * leaves here at {@link SIGNATURE_MAX_EDGE} at most, so decoding at 2.5× that
 * keeps its detail while bounding memory and every pass below.
 */
export const SIGNATURE_DECODE_MAX_EDGE = 3000;

/** Alpha at or below this is empty canvas, not ink. */
const EMPTY_ALPHA = 8;

/**
 * Keying: a pixel at least this fraction as bright as the paper is paper
 * (transparent); at or below {@link INK_FRACTION} of it, it is ink (opaque).
 * Between the two, alpha ramps — the anti-aliased edge of a pen stroke.
 */
const PAPER_FRACTION = 0.85;
const INK_FRACTION = 0.55;

/** Paper differs from ink by at least this much luma, or there is no ink. */
const MIN_CONTRAST = 24;

/** Padding around the ink, as a fraction of its longer side (min 2 px). */
const PAD_FRACTION = 0.03;

function luma(d: Uint8ClampedArray, i: number): number {
  return 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
}

/** Whether every pixel is fully opaque — a photo or scan, not a cut-out. */
export function isOpaque(img: RgbaImage): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false;
  return true;
}

/**
 * The paper's brightness: the 75th-percentile luma. A signature is a small
 * fraction of its own photo, so most pixels are paper — and a phone photo's
 * paper is grey, not white, which a fixed "near-white" cut-off gets wrong.
 */
export function paperLuma(img: RgbaImage): number {
  const hist = new Uint32Array(256);
  const d = img.data;
  const n = img.width * img.height;
  for (let i = 0; i < d.length; i += 4) hist[Math.round(luma(d, i))]! += 1;
  let seen = 0;
  const target = n * 0.75;
  for (let v = 0; v < 256; v += 1) {
    seen += hist[v]!;
    if (seen >= target) return v;
  }
  return 255;
}

/**
 * Make the paper transparent: alpha from each pixel's darkness relative to the
 * paper, the ink's own colour kept (a blue pen stays blue). Returns a copy.
 *
 * `paper` defaults to this image's own {@link paperLuma}; pass the WHOLE
 * photo's when keying a crop of it, since a crop is mostly ink and its own
 * percentile would call the ink paper.
 */
export function keyOutPaper(
  img: RgbaImage,
  paper: number = paperLuma(img),
): RgbaImage {
  const hi = paper * PAPER_FRACTION;
  const lo = paper * INK_FRACTION;
  const out = new Uint8ClampedArray(img.data);
  for (let i = 0; i < out.length; i += 4) {
    const l = luma(out, i);
    const a =
      paper - l < MIN_CONTRAST || l >= hi
        ? 0
        : l <= lo
          ? 1
          : (hi - l) / (hi - lo);
    out[i + 3] = Math.round(out[i + 3]! * a);
  }
  return { width: img.width, height: img.height, data: out };
}

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The bounding box of the ink, or null when there is none. With `paper`
 * given, an opaque pixel is ink when it is darker than the paper by the keying
 * margin; otherwise ink is any pixel that is not (nearly) transparent.
 */
export function inkBounds(img: RgbaImage, paper?: number): PixelBox | null {
  const { width, height, data: d } = img;
  const cut = paper === undefined ? 0 : paper * PAPER_FRACTION;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (d[i + 3]! <= EMPTY_ALPHA) continue;
      if (paper !== undefined) {
        const l = luma(d, i);
        if (paper - l < MIN_CONTRAST || l >= cut) continue;
      }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Grow a box by `pad` on every side, clipped to the image. */
export function padBox(
  box: PixelBox,
  pad: number,
  width: number,
  height: number,
): PixelBox {
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(width, box.x + box.width + pad) - x,
    height: Math.min(height, box.y + box.height + pad) - y,
  };
}

export function crop(img: RgbaImage, box: PixelBox): RgbaImage {
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  for (let row = 0; row < box.height; row += 1) {
    const from = ((box.y + row) * img.width + box.x) * 4;
    out.set(img.data.subarray(from, from + box.width * 4), row * box.width * 4);
  }
  return { width: box.width, height: box.height, data: out };
}

/** The size that fits `maxEdge` on the longer side, never enlarging. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Area-average downscale, weighting colour by alpha so the transparent
 * surround does not bleed a pale halo into the ink's edge.
 */
export function downscale(
  img: RgbaImage,
  width: number,
  height: number,
): RgbaImage {
  if (width === img.width && height === img.height) return img;
  const sx = img.width / width;
  const sy = img.height / height;
  const out = new Uint8ClampedArray(width * height * 4);
  const d = img.data;
  for (let oy = 0; oy < height; oy += 1) {
    const ya = oy * sy;
    const yb = ya + sy;
    for (let ox = 0; ox < width; ox += 1) {
      const xa = ox * sx;
      const xb = xa + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb); y += 1) {
        const wy = Math.min(yb, y + 1) - Math.max(ya, y);
        for (let x = Math.floor(xa); x < Math.ceil(xb); x += 1) {
          const w = wy * (Math.min(xb, x + 1) - Math.max(xa, x));
          const i = (y * img.width + x) * 4;
          const pa = d[i + 3]! * w;
          r += d[i]! * pa;
          g += d[i + 1]! * pa;
          b += d[i + 2]! * pa;
          a += pa;
          area += w;
        }
      }
      const o = (oy * width + ox) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / area;
    }
  }
  return { width, height, data: out };
}

/**
 * Crop a signature to its ink, key out the paper of an opaque source (unless
 * `removeBackground` is false), and bound its resolution. Returns null when
 * there is no ink at all — an empty pad, or a blank photo.
 */
export function prepareSignatureBitmap(
  img: RgbaImage,
  opts: { removeBackground?: boolean; maxEdge?: number } = {},
): PreparedSignature | null {
  const { removeBackground = true, maxEdge = SIGNATURE_MAX_EDGE } = opts;
  if (img.width === 0 || img.height === 0) return null;
  const opaqueSource = isOpaque(img);
  const paper = opaqueSource ? paperLuma(img) : undefined;
  const bounds = inkBounds(img, paper);
  if (!bounds) return null;
  const pad = Math.max(
    2,
    Math.round(Math.max(bounds.width, bounds.height) * PAD_FRACTION),
  );
  // Crop FIRST, then key the crop against the whole photo's paper: keying is
  // per pixel, so the result is the same, without copying the entire photo.
  let cropped = crop(img, padBox(bounds, pad, img.width, img.height));
  if (paper !== undefined && removeBackground) {
    cropped = keyOutPaper(cropped, paper);
  }
  const size = fitWithin(cropped.width, cropped.height, maxEdge);
  const scaled = downscale(cropped, size.width, size.height);
  return { ...scaled, opaque: opaqueSource && !removeBackground };
}
