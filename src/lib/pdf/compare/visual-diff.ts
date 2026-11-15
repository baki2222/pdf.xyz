/**
 * Compare PDF's Overlay (audit compare-pdf#3, S3, 2026-11-15): the pure
 * half. Two pages drawn to LUMINANCE planes are lined up (shift only),
 * compared pixel by pixel with a one-pixel neighbourhood tolerance, and the
 * differing pixels are grouped into numbered regions. No DOM: the planes
 * come from `capturePdfPages` (`runner/compare/visual-pairs.ts`), and the
 * composite is written into a caller's RGBA buffer.
 *
 * WHAT IT CAN SEE. Ink that, averaged over a 3 × 3 box, is darker on one
 * side than anywhere within one pixel of the same place on the other, by
 * more than {@link TOLERANCE} of 255, in a patch of at least {@link
 * CELL_MIN_PX} such pixels inside one {@link CELL_PX}-pixel cell. Both sides are drawn by the same pdf.js on
 * the same machine, so identical content is pixel-identical; the tolerance
 * absorbs one pixel of jitter and anti-aliasing from fractional origins.
 *
 * WHAT IT CANNOT SEE, each pinned by a test in `visual-diff.test.ts`:
 * - a hue change at equal lightness (it compares luminance, Rec. 601, the
 *   plane `luminancePlane` makes; "hue-only change at equal luma");
 * - anything smaller than a few pixels at the drawing's resolution (about
 *   {@link VISUAL_DPI} dpi, less on pages larger than {@link
 *   VISUAL_MAX_SIDE_PX} px at that dpi; "a 1 px speck");
 * - a shift of more than {@link MAX_SHIFT_PX} px is not lined up, so it
 *   shows as removed and added ink, never as silence ("beyond 12").
 *
 * BOUND. Work per pair is O(n), n ≤ 4 M (2,000 × 2,000 px). Memory owned
 * here while a pair is compared: two box-averaged darkness arrays and two
 * filter buffers of n bytes each (≤ 16 MB, the filter buffers reused for
 * both directions), and two bitsets of n/8 bytes (≤ 1 MB) that the result
 * keeps; the planes themselves are the caller's.
 */

/** The drawing's resolution, in dots per inch. */
export const VISUAL_DPI = 150;
/** The longest side a page is drawn at: a page is at most 4 megapixels. */
export const VISUAL_MAX_SIDE_PX = 2000;
/** How much darker (of 255) a pixel must be than its partner's neighbourhood. */
export const TOLERANCE = 48;
/** The neighbourhood a pixel is compared against: 1 means 3 × 3. */
export const NEIGHBOUR_RADIUS = 1;
/** The side of a cell, in pixels: regions are made of cells. */
export const CELL_PX = 8;
/** A cell is marked when it holds at least this many differing pixels. */
export const CELL_MIN_PX = 3;
/** Regions kept per page: the largest, so a page of noise stays readable. */
export const MAX_REGIONS = 100;
/** The furthest a page is moved to line up with its partner, in pixels. */
export const MAX_SHIFT_PX = 12;
/** A shift is used only when it lowers the mismatch to this fraction or less. */
export const SHIFT_GAIN = 0.8;
/** Above this share of inked cells differing, the page "differs almost everywhere". */
export const EVERYWHERE_FRACTION = 0.3;

/** One page drawn to luminance: one byte per pixel, row-major. */
export interface Plane {
  w: number;
  h: number;
  data: Uint8Array;
}

/** How PDF 2's page is moved to line up with PDF 1's: R(x + dx, y + dy) ≈ L(x, y). */
export interface Shift {
  dx: number;
  dy: number;
}

export const NO_SHIFT: Shift = { dx: 0, dy: 0 };

export type RegionKind = "removed" | "added" | "changed";

/** A group of differing pixels, in PDF 1's pixel frame. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RegionKind;
  /** Differing pixels inside it. */
  pixels: number;
}

export interface VisualDiff {
  /** The compared area: the larger of the two sizes on each axis. */
  w: number;
  h: number;
  /** The two drawings differ in size by more than a pixel on an axis. */
  sizeDiffers: boolean;
  shift: Shift;
  /** Bitsets over w × h: ink only in PDF 1, ink only in PDF 2. */
  onlyL: Uint8Array;
  onlyR: Uint8Array;
  /** At most {@link MAX_REGIONS}, the largest, in reading order. */
  regions: Region[];
  /** More regions were found than were kept. */
  capped: boolean;
  /** Differing cells over inked cells passed {@link EVERYWHERE_FRACTION}. */
  everywhere: boolean;
  /** Both planes hold no ink darker than {@link TOLERANCE}. */
  blank: boolean;
}

const bit = (bits: Uint8Array, i: number) => (bits[i >> 3]! >> (i & 7)) & 1;

/** Darkness of `p` at (x, y), or 0 (white) outside it. */
function darkAt(p: Plane, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < p.w && y < p.h
    ? 255 - p.data[y * p.w + x]!
    : 0;
}

/**
 * A plane's darkness over the w × h frame, read at an offset, averaged over
 * each pixel's 3 × 3 box. The average keeps a stroke's COVERAGE where its
 * anti-aliasing moves it: drawn 0.3 pt further right, one glyph stem is
 * half dark on two pixels instead of fully dark on one (measured on pdf.js
 * through @napi-rs/canvas, 2026-11-15: 11 regions of nothing but that on a
 * page of text, before this pass), and a max filter alone cannot see that
 * the two are the same ink. A 1 px speck averages to a ninth of its
 * darkness, below {@link TOLERANCE}: the resolution limit, pinned.
 */
function boxDark(
  src: Plane,
  off: Shift,
  w: number,
  h: number,
  out: Uint8Array,
) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          sum += darkAt(src, x + dx + off.dx, y + dy + off.dy);
      out[y * w + x] = Math.round(sum / 9);
    }
}

/**
 * The (2r+1)² max filter of a w × h darkness array, as two separable
 * passes: `tmp` holds the horizontal pass, `out` the result. Both are
 * w × h and are overwritten.
 */
function maxFilter(
  src: Uint8Array,
  w: number,
  h: number,
  r: number,
  tmp: Uint8Array,
  out: Uint8Array,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) continue;
        const k = src[y * w + xx]!;
        if (k > m) m = k;
      }
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        const k = tmp[yy * w + x]!;
        if (k > m) m = k;
      }
      out[y * w + x] = m;
    }
  }
}

/** 4× box-downsampled darkness of a plane read at an offset, over w × h. */
function downsample(p: Plane, w: number, h: number): Plane {
  const dw = Math.ceil(w / 4);
  const dh = Math.ceil(h / 4);
  const data = new Uint8Array(dw * dh);
  for (let by = 0; by < dh; by++)
    for (let bx = 0; bx < dw; bx++) {
      let sum = 0;
      for (let y = by * 4; y < by * 4 + 4; y++)
        for (let x = bx * 4; x < bx * 4 + 4; x++) sum += darkAt(p, x, y);
      data[by * dw + bx] = sum >> 4;
    }
  return { w: dw, h: dh, data };
}

/** Mean |a − b| of darkness, a against b read at (x + dx, y + dy), over a's frame. */
function cost(
  a: Plane,
  b: Plane,
  dx: number,
  dy: number,
  dark: boolean,
): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const av = dark ? a.data[y * a.w + x]! : 255 - a.data[y * a.w + x]!;
      const bx = x + dx;
      const by = y + dy;
      const bv =
        bx >= 0 && by >= 0 && bx < b.w && by < b.h
          ? dark
            ? b.data[by * b.w + bx]!
            : 255 - b.data[by * b.w + bx]!
          : 0;
      sum += Math.abs(av - bv);
      n++;
    }
  return n === 0 ? 0 : sum / n;
}

/**
 * The shift that lines PDF 2's page up with PDF 1's, or {@link NO_SHIFT}.
 * Searched on 4× box-downsampled darkness over ±3 cells (±12 px); a shift
 * is taken only when it lowers the mismatch to {@link SHIFT_GAIN} of the
 * unshifted one, then refined at full resolution ±2 px, clamped to
 * ±{@link MAX_SHIFT_PX}. Ties go to no shift.
 */
export function bestShift(L: Plane, R: Plane): Shift {
  const w = Math.max(L.w, R.w);
  const h = Math.max(L.h, R.h);
  const a = downsample(L, w, h);
  const b = downsample(R, w, h);
  const c0 = cost(a, b, 0, 0, true);
  let best = { dx: 0, dy: 0, c: c0 };
  const cells = MAX_SHIFT_PX / 4;
  for (let dy = -cells; dy <= cells; dy++)
    for (let dx = -cells; dx <= cells; dx++) {
      if (dx === 0 && dy === 0) continue;
      const c = cost(a, b, dx, dy, true);
      if (c < best.c) best = { dx, dy, c };
    }
  if ((best.dx === 0 && best.dy === 0) || best.c > SHIFT_GAIN * c0)
    return NO_SHIFT;
  const window = (cx: number, cy: number) => {
    let fine = { dx: cx, dy: cy, c: Infinity };
    for (let dy = cy - 2; dy <= cy + 2; dy++)
      for (let dx = cx - 2; dx <= cx + 2; dx++) {
        if (Math.abs(dx) > MAX_SHIFT_PX || Math.abs(dy) > MAX_SHIFT_PX)
          continue;
        const c = cost(L, R, dx, dy, false);
        if (c < fine.c) fine = { dx, dy, c };
      }
    return fine;
  };
  const fine = window(best.dx * 4, best.dy * 4);
  // Content that repeats (a ruled table, dot leaders) also lines up one
  // period away. The window round no shift is searched too, at full
  // resolution, and wins ties: a page within 2 px of its partner is not
  // moved (the neighbourhood absorbs 1 px; 2 px shows as ink, never hidden).
  const near = window(0, 0);
  if (near.c <= fine.c) return NO_SHIFT;
  return { dx: fine.dx, dy: fine.dy };
}

/**
 * Compare two pages. `shift` moves PDF 2's page (see {@link bestShift});
 * it is applied by indexing, never by copying a plane.
 */
export function diffPlanes(
  L: Plane,
  R: Plane,
  shift: Shift = NO_SHIFT,
): VisualDiff {
  const w = Math.max(L.w, R.w);
  const h = Math.max(L.h, R.h);
  const n = w * h;
  const sizeDiffers = Math.abs(L.w - R.w) > 1 || Math.abs(L.h - R.h) > 1;
  const onlyL = new Uint8Array((n + 7) >> 3);
  const onlyR = new Uint8Array((n + 7) >> 3);
  const boxL = new Uint8Array(n);
  const boxR = new Uint8Array(n);
  const tmp = new Uint8Array(n);
  const out = new Uint8Array(n);
  const r = NEIGHBOUR_RADIUS;
  boxDark(L, NO_SHIFT, w, h, boxL);
  boxDark(R, shift, w, h, boxR);
  // Ink only in PDF 1: darker than anything near the same place in PDF 2.
  maxFilter(boxR, w, h, r, tmp, out);
  for (let i = 0; i < n; i++)
    if (boxL[i]! - out[i]! > TOLERANCE) onlyL[i >> 3]! |= 1 << (i & 7);
  // And the mirror, with PDF 1 filtered.
  maxFilter(boxL, w, h, r, tmp, out);
  for (let i = 0; i < n; i++)
    if (boxR[i]! - out[i]! > TOLERANCE) onlyR[i >> 3]! |= 1 << (i & 7);
  const found = regionsOf(onlyL, onlyR, w, h, (x, y) =>
    Math.max(darkAt(L, x, y), darkAt(R, x + shift.dx, y + shift.dy)),
  );
  return { w, h, sizeDiffers, shift, onlyL, onlyR, ...found };
}

/**
 * Group differing pixels into regions: a cell of {@link CELL_PX} px with at
 * least {@link CELL_MIN_PX} differing pixels is marked; marked cells are
 * grown by one cell and labelled 8-connected (iteratively); each region's
 * box is the box of the differing pixels in its marked cells. A region is `removed` (≥ 80% ink only in
 * PDF 1), `added` (≥ 80% only in PDF 2) or `changed`.
 */
export function regionsOf(
  onlyL: Uint8Array,
  onlyR: Uint8Array,
  w: number,
  h: number,
  darkness: (x: number, y: number) => number,
): Pick<VisualDiff, "regions" | "capped" | "everywhere" | "blank"> {
  const cw = Math.ceil(w / CELL_PX);
  const ch = Math.ceil(h / CELL_PX);
  const countL = new Uint32Array(cw * ch);
  const countR = new Uint32Array(cw * ch);
  const inked = new Uint8Array(cw * ch);
  // Each cell's differing pixels' box, so a region's box is the pixels', not the cells'.
  const bx0 = new Uint16Array(cw * ch).fill(65535);
  const by0 = new Uint16Array(cw * ch).fill(65535);
  const bx1 = new Uint16Array(cw * ch);
  const by1 = new Uint16Array(cw * ch);
  let anyInk = false;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = ((y / CELL_PX) | 0) * cw + ((x / CELL_PX) | 0);
      const dl = bit(onlyL, i);
      const dr = bit(onlyR, i);
      if (dl) countL[c]!++;
      if (dr) countR[c]!++;
      if (dl || dr) {
        if (x < bx0[c]!) bx0[c] = x;
        if (y < by0[c]!) by0[c] = y;
        if (x > bx1[c]!) bx1[c] = x;
        if (y > by1[c]!) by1[c] = y;
      }
      if (!inked[c] && darkness(x, y) > TOLERANCE) {
        inked[c] = 1;
        anyInk = true;
      }
    }
  const marked = new Uint8Array(cw * ch);
  let diffCells = 0;
  let inkCells = 0;
  for (let c = 0; c < cw * ch; c++) {
    if (countL[c]! + countR[c]! >= CELL_MIN_PX) {
      marked[c] = 1;
      diffCells++;
    }
    if (inked[c]) inkCells++;
  }
  // Grow by one cell, so strokes a cell apart are one region.
  const grown = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      if (!marked[cy * cw + cx]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && y >= 0 && x < cw && y < ch) grown[y * cw + x] = 1;
        }
    }
  const label = new Int32Array(cw * ch);
  const all: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cw * ch; start++) {
    if (!grown[start] || label[start]) continue;
    const id = all.length + 1;
    label[start] = id;
    stack.push(start);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    let l = 0;
    let rr = 0;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const cx = c % cw;
      const cy = (c / cw) | 0;
      if (marked[c]) {
        if (bx0[c]! < x0) x0 = bx0[c]!;
        if (by0[c]! < y0) y0 = by0[c]!;
        if (bx1[c]! > x1) x1 = bx1[c]!;
        if (by1[c]! > y1) y1 = by1[c]!;
        l += countL[c]!;
        rr += countR[c]!;
      }
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
          const j = y * cw + x;
          if (grown[j] && !label[j]) {
            label[j] = id;
            stack.push(j);
          }
        }
    }
    const pixels = l + rr;
    const kind: RegionKind =
      l >= 0.8 * pixels ? "removed" : rr >= 0.8 * pixels ? "added" : "changed";
    all.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, kind, pixels });
  }
  const kept = [...all]
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, MAX_REGIONS)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    regions: kept,
    capped: all.length > MAX_REGIONS,
    everywhere: diffCells / Math.max(1, inkCells) > EVERYWHERE_FRACTION,
    blank: !anyInk,
  };
}

/** Where a region sits on its page, in a thirds grid, in words. */
export function describePlace(
  region: Pick<Region, "x" | "y" | "w" | "h">,
  w: number,
  h: number,
): string {
  const cx = (region.x + region.w / 2) / Math.max(1, w);
  const cy = (region.y + region.h / 2) / Math.max(1, h);
  const col = cx < 1 / 3 ? 0 : cx < 2 / 3 ? 1 : 2;
  const row = cy < 1 / 3 ? 0 : cy < 2 / 3 ? 1 : 2;
  const rows = ["top", "", "bottom"];
  const cols = ["left", "", "right"];
  if (row === 1 && col === 1) return "in the middle";
  const words = [rows[row], cols[col]].filter(Boolean).join(" ");
  return `near the ${words}`;
}

/** Removed ink: red, with a diagonal hatch, so colour is never the only cue. */
export const REMOVED_RGB = [0xb9, 0x1c, 0x1c] as const;
/** Added ink: green, with a dot pattern. */
export const ADDED_RGB = [0x15, 0x80, 0x3d] as const;
/** Each region's outline: the blue S2 uses for the active mark. */
export const OUTLINE_RGB = [0x1d, 0x4e, 0xd8] as const;

/** A removed pixel on the hatch: full strength. Off it, a third. */
export const onHatch = (x: number, y: number) => (x + y) % 6 < 2;
/** An added pixel on the dot grid: full strength. Off it, a third. */
export const onDot = (x: number, y: number) => x % 4 < 2 && y % 4 < 2;

/**
 * Paint the overlay into an RGBA buffer of `diff.w × diff.h`: grey
 * `(1 − w)·PDF 1 + w·PDF 2`, ink only in PDF 1 in red with a diagonal hatch
 * and ink only in PDF 2 in green with a dot pattern (each fading as the
 * slider moves away from its file), and a 2 px outline round each region.
 * `outline: false` leaves the outlines to the caller (forced colours).
 */
export function compositeInto(
  out: Uint8ClampedArray,
  L: Plane,
  R: Plane,
  diff: Pick<VisualDiff, "w" | "h" | "shift" | "onlyL" | "onlyR" | "regions">,
  w01: number,
  outline = true,
): void {
  const { w, h, shift } = diff;
  const wt = Math.min(1, Math.max(0, w01));
  const aL = 0.85 * Math.min(1, 2 * (1 - wt));
  const aR = 0.85 * Math.min(1, 2 * wt);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = 255 - darkAt(L, x, y);
      const r = 255 - darkAt(R, x + shift.dx, y + shift.dy);
      let g = (1 - wt) * l + wt * r;
      let cr = g;
      let cg = g;
      let cb = g;
      const paint = (rgb: readonly number[], a: number) => {
        cr = (1 - a) * cr + a * rgb[0]!;
        cg = (1 - a) * cg + a * rgb[1]!;
        cb = (1 - a) * cb + a * rgb[2]!;
      };
      if (bit(diff.onlyL, i)) paint(REMOVED_RGB, onHatch(x, y) ? aL : aL / 3);
      if (bit(diff.onlyR, i)) paint(ADDED_RGB, onDot(x, y) ? aR : aR / 3);
      g = i * 4;
      out[g] = cr;
      out[g + 1] = cg;
      out[g + 2] = cb;
      out[g + 3] = 255;
    }
  if (!outline) return;
  for (const reg of diff.regions) {
    const x0 = Math.max(0, reg.x - 2);
    const y0 = Math.max(0, reg.y - 2);
    const x1 = Math.min(w - 1, reg.x + reg.w + 1);
    const y1 = Math.min(h - 1, reg.y + reg.h + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const edge = x - x0 < 2 || x1 - x < 2 || y - y0 < 2 || y1 - y < 2;
        if (!edge) continue;
        const o = (y * w + x) * 4;
        out[o] = OUTLINE_RGB[0];
        out[o + 1] = OUTLINE_RGB[1];
        out[o + 2] = OUTLINE_RGB[2];
        out[o + 3] = 255;
      }
  }
}
