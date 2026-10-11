/**
 * A picture's pixels, from what pdf.js decoded to what the deck carries:
 * resampled from pdf.js's own layouts without a full-size copy, and cut to
 * the shape the page shows it through.
 *
 * ── WHY NO FULL-SIZE COPY ───────────────────────────────────────────────────
 *
 * Until 2026-10-11 every re-encoded picture went through an RGBA copy at its
 * full size before it was scaled down: 4 bytes a pixel on top of what pdf.js
 * already held. For a 124 MP drawing that is 496 MB for a picture that ships
 * at 3,600 pixels on its long side. `resampleImage` reads pdf.js's 1-bit,
 * RGB and RGBA rows directly, one source row at a time.
 *
 * ── WHY THE PICTURE IS CUT HERE ─────────────────────────────────────────────
 *
 * A PDF shows a picture through its clip: a circle for a profile photo, a
 * frame a turned photo sits in. A slide picture is a rectangle. Placing the
 * whole picture showed what the page hides — the photo's corners, the turned
 * photo's overhang across the title — and "paint order is privacy" applies to
 * clips too: cropping is the other way authors hide things. So a picture whose
 * clip is not exactly its own rectangle is cut here: its pixels are cropped to
 * what the clip can show, and every pixel the clip hides is made transparent
 * (and its colour zeroed), by an anti-aliased coverage raster of the clip
 * (`coverage`) at the picture's output resolution. It stays one picture, at
 * its own place, angle and size, so it can still be moved or replaced.
 */
import { encodePngImage } from "./png-encode";

/** pdf.js's decoded image: ImageKind 1 = 1-bit grey, 2 = RGB, 3 = RGBA. */
export interface DecodedImage {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
  ref?: string;
}

export function isDecodedImage(v: unknown): v is DecodedImage {
  const o = v as DecodedImage | null;
  return (
    !!o &&
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    typeof o.kind === "number" &&
    !!o.data &&
    typeof (o.data as Uint8Array).length === "number"
  );
}

/** One source row as RGBA, from any of pdf.js's three layouts. */
function readRow(
  img: DecodedImage,
  y: number,
  x0: number,
  width: number,
  out: Uint8ClampedArray,
): void {
  const { kind, data } = img;
  if (kind === 3) {
    const start = (y * img.width + x0) * 4;
    out.set(data.subarray(start, start + width * 4));
    return;
  }
  if (kind === 2) {
    let p = (y * img.width + x0) * 3;
    for (let q = 0; q < width * 4; q += 4, p += 3) {
      out[q] = data[p]!;
      out[q + 1] = data[p + 1]!;
      out[q + 2] = data[p + 2]!;
      out[q + 3] = 255;
    }
    return;
  }
  // 1 bit per pixel, rows padded to a byte; a set bit is white.
  const row = y * ((img.width + 7) >> 3);
  for (let x = 0, q = 0; x < width; x++, q += 4) {
    const sx = x0 + x;
    const v = (data[row + (sx >> 3)]! >> (7 - (sx & 7))) & 1 ? 255 : 0;
    out[q] = out[q + 1] = out[q + 2] = v;
    out[q + 3] = 255;
  }
}

/**
 * RGBA at `width` × `height` from the source rectangle `region` (whole
 * pixels: x0, y0, x1, y1) of a decoded image, each target pixel the average
 * of its footprint, in premultiplied alpha so a transparent edge does not
 * darken. Never larger than the region: callers pick a size within it.
 *
 * Not the canvas's `drawImage`: measured on @napi-rs/canvas 1.0.2 (the one
 * pdf.js hands back), a canvas pdf.js created reads back transparent through
 * `getImageData` but is copied by `drawImage`, and encoded by `toBuffer`, as
 * OPAQUE white wherever it was transparent. A layer over a screenshot came
 * out as a white rectangle hiding it. Pixels leave a canvas through
 * `getImageData` only; PNGs are written by `./png-encode`.
 */
export function resampleImage(
  img: DecodedImage,
  region: readonly [number, number, number, number],
  width: number,
  height: number,
): Uint8ClampedArray {
  const [x0, y0, x1, y1] = region;
  const sw = x1 - x0;
  const sh = y1 - y0;
  const out = new Uint8ClampedArray(width * height * 4);
  const fx = sw / width;
  const fy = sh / height;
  const row = new Uint8ClampedArray(sw * 4);
  const acc = new Float64Array(sw * 4);
  for (let ty = 0; ty < height; ty++) {
    const ya = ty * fy;
    const yb = Math.min(sh, (ty + 1) * fy);
    acc.fill(0);
    for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
      const wy = Math.min(y + 1, yb) - Math.max(y, ya);
      if (wy <= 0) continue;
      readRow(img, y0 + y, x0, sw, row);
      for (let q = 0; q < sw * 4; q += 4) {
        const a = (row[q + 3]! / 255) * wy;
        if (a === 0) continue;
        acc[q] = acc[q]! + row[q]! * a;
        acc[q + 1] = acc[q + 1]! + row[q + 1]! * a;
        acc[q + 2] = acc[q + 2]! + row[q + 2]! * a;
        acc[q + 3] = acc[q + 3]! + a;
      }
    }
    const tall = yb - ya;
    for (let tx = 0; tx < width; tx++) {
      const xa = tx * fx;
      const xb = Math.min(sw, (tx + 1) * fx);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
        const wx = Math.min(x + 1, xb) - Math.max(x, xa);
        if (wx <= 0) continue;
        const q = x * 4;
        r += acc[q]! * wx;
        g += acc[q + 1]! * wx;
        b += acc[q + 2]! * wx;
        a += acc[q + 3]! * wx;
      }
      const o = (ty * width + tx) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = (a / ((xb - xa) * tall)) * 255;
    }
  }
  return out;
}

/** `[w, h]` scaled down, aspect kept, so the longer side is at most `max`. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): [number, number] {
  const longest = Math.max(width, height);
  if (longest <= max) return [width, height];
  const s = max / longest;
  return [
    Math.max(1, Math.round(width * s)),
    Math.max(1, Math.round(height * s)),
  ];
}

/* ------------------------------------------------------------------ *
 *  Clip shapes
 * ------------------------------------------------------------------ */

/** A clip: closed polygons (flat x, y, x, y …) and its fill rule. */
export interface ClipShape {
  polys: number[][];
  evenOdd: boolean;
}

type Matrix = readonly [number, number, number, number, number, number];

function apply(m: readonly number[], x: number, y: number): [number, number] {
  return [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
}

/**
 * pdf.js's path data (DrawOPS: 0 moveTo, 1 lineTo, 2 curveTo, 3 quadratic,
 * 4 close) under `m`, flattened into closed polygons. Curves are cut into
 * chords no longer than about a point after `m`.
 */
export function flattenPath(
  data: ArrayLike<number>,
  m: readonly number[],
): number[][] {
  const polys: number[][] = [];
  let cur: number[] = [];
  let start: [number, number] = [0, 0];
  let at: [number, number] = [0, 0];
  const finish = () => {
    if (cur.length >= 6) polys.push(cur);
    cur = [];
  };
  const steps = (len: number) =>
    Math.min(64, Math.max(4, Math.ceil(Math.sqrt(len) * 1.5)));
  for (let i = 0; i < data.length;) {
    const op = data[i++]!;
    if (op === 0) {
      finish();
      at = apply(m, data[i++]!, data[i++]!);
      start = at;
      cur = [at[0], at[1]];
    } else if (op === 1) {
      at = apply(m, data[i++]!, data[i++]!);
      if (cur.length === 0) cur = [start[0], start[1]];
      cur.push(at[0], at[1]);
    } else if (op === 2 || op === 3) {
      const n = op === 2 ? 3 : 2;
      const pts: [number, number][] = [at];
      for (let k = 0; k < n; k++) pts.push(apply(m, data[i++]!, data[i++]!));
      let len = 0;
      for (let k = 1; k < pts.length; k++)
        len += Math.hypot(
          pts[k]![0] - pts[k - 1]![0],
          pts[k]![1] - pts[k - 1]![1],
        );
      const count = steps(len);
      if (cur.length === 0) cur = [at[0], at[1]];
      for (let s = 1; s <= count; s++) {
        const t = s / count;
        const u = 1 - t;
        let x: number;
        let y: number;
        if (op === 2) {
          const [p0, p1, p2, p3] = pts as [number, number][];
          x =
            u * u * u * p0![0] +
            3 * u * u * t * p1![0] +
            3 * u * t * t * p2![0] +
            t * t * t * p3![0];
          y =
            u * u * u * p0![1] +
            3 * u * u * t * p1![1] +
            3 * u * t * t * p2![1] +
            t * t * t * p3![1];
        } else {
          const [p0, p1, p2] = pts as [number, number][];
          x = u * u * p0![0] + 2 * u * t * p1![0] + t * t * p2![0];
          y = u * u * p0![1] + 2 * u * t * p1![1] + t * t * p2![1];
        }
        cur.push(x, y);
      }
      at = pts[pts.length - 1]!;
    } else if (op === 4) {
      finish();
      at = start;
    } else break;
  }
  finish();
  return polys;
}

/** The box of polygons: [x0, y0, x1, y1]. */
export function polysBox(
  polys: readonly number[][],
): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polys)
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]!);
      x1 = Math.max(x1, p[i]!);
      y0 = Math.min(y0, p[i + 1]!);
      y1 = Math.max(y1, p[i + 1]!);
    }
  return [x0, y0, x1, y1];
}

/**
 * When the polygons are exactly one axis-aligned rectangle, that rectangle;
 * otherwise null. A clip of this shape is a crop, nothing more.
 */
export function asAxisRect(
  polys: readonly number[][],
): [number, number, number, number] | null {
  if (polys.length !== 1) return null;
  const p = polys[0]!;
  const pts: [number, number][] = [];
  for (let i = 0; i < p.length; i += 2) {
    const q: [number, number] = [p[i]!, p[i + 1]!];
    const last = pts.at(-1);
    if (
      !last ||
      Math.abs(last[0] - q[0]) > 1e-3 ||
      Math.abs(last[1] - q[1]) > 1e-3
    )
      pts.push(q);
  }
  if (
    pts.length > 1 &&
    Math.abs(pts[0]![0] - pts.at(-1)![0]) < 1e-3 &&
    Math.abs(pts[0]![1] - pts.at(-1)![1]) < 1e-3
  )
    pts.pop();
  if (pts.length !== 4) return null;
  for (let k = 0; k < 4; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % 4]!;
    if (Math.abs(a[0] - b[0]) > 1e-3 && Math.abs(a[1] - b[1]) > 1e-3)
      return null;
  }
  return polysBox(polys);
}

/** Map every vertex of a clip through `m`. */
export function mapShape(shape: ClipShape, m: readonly number[]): ClipShape {
  return {
    evenOdd: shape.evenOdd,
    polys: shape.polys.map((p) => {
      const out = new Array<number>(p.length);
      for (let i = 0; i < p.length; i += 2) {
        const [x, y] = apply(m, p[i]!, p[i + 1]!);
        out[i] = x;
        out[i + 1] = y;
      }
      return out;
    }),
  };
}

function windingAt(shape: ClipShape, x: number, y: number): number {
  let w = 0;
  for (const p of shape.polys) {
    const n = p.length / 2;
    for (let k = 0; k < n; k++) {
      const ax = p[2 * k]!;
      const ay = p[2 * k + 1]!;
      const bx = p[2 * ((k + 1) % n)]!;
      const by = p[2 * ((k + 1) % n) + 1]!;
      if (ay <= y ? by > y : by <= y) {
        const xi = ax + ((y - ay) / (by - ay)) * (bx - ax);
        if (xi > x) w += by > ay ? 1 : -1;
      }
    }
  }
  return w;
}

function inside(shape: ClipShape, x: number, y: number): boolean {
  const w = windingAt(shape, x, y);
  return shape.evenOdd ? (w & 1) === 1 : w !== 0;
}

function segmentsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Does the clip show ALL of the rectangle [x0, y0, x1, y1]? Its corners and
 * centre inside, and no edge of the clip crossing the rectangle's edges.
 * Shrunk by `slack` so a clip that coincides with the picture's own edge (the
 * common "clip to the picture" idiom) counts as containing it.
 */
export function containsRect(
  shape: ClipShape,
  rect: readonly [number, number, number, number],
  slack = 0.01,
): boolean {
  const [x0, y0, x1, y1] = [
    rect[0] + slack,
    rect[1] + slack,
    rect[2] - slack,
    rect[3] - slack,
  ];
  if (x1 <= x0 || y1 <= y0) return true;
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  if (!corners.every(([x, y]) => inside(shape, x, y))) return false;
  if (!inside(shape, (x0 + x1) / 2, (y0 + y1) / 2)) return false;
  for (const p of shape.polys) {
    const n = p.length / 2;
    for (let k = 0; k < n; k++) {
      const ax = p[2 * k]!;
      const ay = p[2 * k + 1]!;
      const bx = p[2 * ((k + 1) % n)]!;
      const by = p[2 * ((k + 1) % n) + 1]!;
      for (let e = 0; e < 4; e++) {
        const [cx, cy] = corners[e]!;
        const [dx, dy] = corners[(e + 1) % 4]!;
        if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return false;
      }
    }
  }
  return true;
}

/** Sub-scanlines per pixel row of the coverage raster. */
const SUBSAMPLES = 4;

/**
 * How much of each pixel of a `width` × `height` grid the clip covers, 0–1:
 * `SUBSAMPLES` scanlines a row, exact horizontal span coverage on each, the
 * clip's own fill rule. Polygons are in grid pixels.
 */
export function coverage(
  shape: ClipShape,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height);
  const edges: [number, number, number, number, number][] = [];
  for (const p of shape.polys) {
    const n = p.length / 2;
    for (let k = 0; k < n; k++) {
      const ax = p[2 * k]!;
      const ay = p[2 * k + 1]!;
      const bx = p[2 * ((k + 1) % n)]!;
      const by = p[2 * ((k + 1) % n) + 1]!;
      if (ay === by) continue;
      edges.push(ay < by ? [ax, ay, bx, by, 1] : [bx, by, ax, ay, -1]);
    }
  }
  const hits: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let s = 0; s < SUBSAMPLES; s++) {
      const yy = y + (s + 0.5) / SUBSAMPLES;
      hits.length = 0;
      for (const [ax, ay, bx, by, dir] of edges)
        if (yy >= ay && yy < by)
          hits.push([ax + ((yy - ay) / (by - ay)) * (bx - ax), dir]);
      if (hits.length === 0) continue;
      hits.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let h = 0; h + 1 < hits.length; h++) {
        wind += hits[h]![1];
        const on = shape.evenOdd ? (wind & 1) === 1 : wind !== 0;
        if (!on) continue;
        const xa = Math.max(0, hits[h]![0]);
        const xb = Math.min(width, hits[h + 1]![0]);
        if (xb <= xa) continue;
        const row = y * width;
        const first = Math.floor(xa);
        const last = Math.min(width - 1, Math.ceil(xb) - 1);
        for (let x = first; x <= last; x++) {
          const span = Math.min(x + 1, xb) - Math.max(x, xa);
          if (span > 0) out[row + x] = out[row + x]! + span / SUBSAMPLES;
        }
      }
    }
  }
  for (let i = 0; i < out.length; i++) if (out[i]! > 1) out[i] = 1;
  return out;
}

/**
 * Multiply each pixel's alpha by every clip's coverage; a pixel no clip
 * shows loses its colour too, so what the page hides is not in the file.
 */
export function applyClipCoverage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  shapes: readonly ClipShape[],
): void {
  for (const shape of shapes) {
    const cov = coverage(shape, width, height);
    for (let i = 0, q = 0; i < cov.length; i++, q += 4) {
      const c = cov[i]!;
      if (c >= 1) continue;
      const a = Math.round(rgba[q + 3]! * c);
      rgba[q + 3] = a;
      if (a === 0) rgba[q] = rgba[q + 1] = rgba[q + 2] = 0;
    }
  }
}

/** A grey or colour PNG for RGBA pixels that are all opaque, else RGBA. */
export function pngOf(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  let opaque = true;
  let grey = true;
  for (let q = 0; q < rgba.length; q += 4) {
    if (rgba[q + 3]! < 255) opaque = false;
    if (rgba[q] !== rgba[q + 1] || rgba[q] !== rgba[q + 2]) grey = false;
    if (!opaque && !grey) break;
  }
  return encodePngImage(
    width,
    height,
    opaque ? (grey ? "gray8" : "rgb8") : "rgba8",
    rgba,
  );
}

export type { Matrix };
