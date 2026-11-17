/**
 * The straight lines and boxes a PDF page draws, read from pdf.js's operator
 * list. Part of the Create Forms field finder: this walker only collects
 * geometry; `./form-detect` decides what a line or a box might be.
 *
 * WHAT IT READS. Straight segments and axis-aligned rectangles in user space
 * after the current transformation matrix (the CTM), plus the boxes images
 * are painted into. No viewport is applied here: `./form-detect-read` maps
 * the results into the page frame. Curves are not read (they end a straight
 * run and are otherwise skipped), clip-only paths are not read, and paths
 * painted in near-white are dropped, because a white line on a white page is
 * not something a reader sees.
 *
 * CLIPPING, for the same reason: a line clipped away is not on the page. The
 * clip is kept as a BOX, the intersection of the bounding boxes of every
 * `W`/`W*` path, form /BBox and group bbox in force (saved and restored with
 * the rest of the state). What falls outside it is dropped, a line across
 * its edge is trimmed, a filled box is cut to it and an outlined box is cut
 * into its visible edges. A clip that is not a rectangle is read as its
 * bounding box, so a line inside that box but outside the shape is kept.
 * Soft masks and images are not clipped.
 *
 * THE PDF.JS 6 LAYOUT this depends on (pdfjs-dist 6.2.108, `buildPath` in
 * pdf.worker.mjs; the same reading as page-scan.ts in the PDF to Office
 * export): every path arrives as ONE `constructPath` operator whose
 *
 *   - `args[0]` is the paint operator (`OPS.stroke`, `OPS.fill`, ...,
 *     `OPS.endPath` for a clip-only path),
 *   - `args[1][0]` is the path data, a Float32Array of DrawOPS
 *     (0 moveTo x y, 1 lineTo x y, 2 curveTo x1 y1 x2 y2 x y,
 *     3 quadraticCurveTo x1 y1 x y, 4 closePath), or `null` for an empty path,
 *   - `args[2]` is the path's [minX, minY, maxX, maxY] before the CTM.
 *
 * A PDF `re` arrives as moveTo + 3 lineTo + closePath (a zero-width or
 * zero-height `re` as moveTo + lineTo + closePath), and colour operators
 * arrive as `setStrokeRGBColor` / `setFillRGBColor` with a "#rrggbb" string,
 * whatever colour space the file used. If an upgrade moves any of this, the
 * walker health tests H1/H2 in form-detect.corpus.test.ts turn red (they read
 * a real page's operator list), rather than every page quietly reading as
 * having no lines at all.
 *
 * Pure: `OPS` is a parameter, so this module imports nothing from pdf.js and
 * its unit tests drive it with hand-built operator lists.
 */

/** A straight segment, in user space after the CTM. */
export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * Stroke thickness after the CTM, measured ACROSS the segment (see
   * {@link strokeAcross}); a CTM that stretches one axis more than the other
   * makes it depend on the segment's direction.
   */
  width: number;
  stroked: boolean;
  filled: boolean;
  /** Luminance (0 black .. 1 white) of the colour that paints it. */
  lum: number;
}

/** An axis-aligned rectangle (x0 <= x1, y0 <= y1), in user space after the CTM. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Stroke thickness of its thickest edge, after the CTM. */
  width: number;
  stroked: boolean;
  filled: boolean;
  lum: number;
}

/** An image's unit square under the CTM, as its bounding box. */
export interface ImageBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PathScan {
  segs: Seg[];
  rects: Rect[];
  /** Boxes images were painted into (for the "likely a scan" outcome). */
  images: ImageBox[];
  /** Operators walked. */
  ops: number;
  /**
   * Operators that put ink on the page: painted paths (near-white ones
   * included) and images. A cut content stream can leave a `q` or a `cm`
   * behind with nothing drawn, so "nothing drawn" is decided on this, not on
   * `ops`.
   */
  painted: number;
  /** Operators skipped inside form XObjects nested deeper than the cap. */
  ignored: number;
  capped: false | "ops" | "primitives";
}

/** The operator codes the walker reads; pdf.js's `OPS` satisfies it. */
export interface OpsLike {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  constructPath: number;
  setLineWidth: number;
  setStrokeRGBColor: number;
  setFillRGBColor: number;
  setStrokeGray: number;
  setFillGray: number;
  endPath: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
  clip?: number;
  eoClip?: number;
  beginGroup?: number;
  endGroup?: number;
  paintImageXObject?: number;
  paintInlineImageXObject?: number;
  paintImageMaskXObject?: number;
}

/** Work caps: past either, the page is reported as too complex to search. */
export const PATH_LIMITS = {
  maxOps: 200_000,
  maxPrimitives: 20_000,
  maxFormDepth: 32,
} as const;

/** Paths painted at or above this luminance are dropped (white on white). */
export const NEAR_WHITE_LUM = 0.95;

/** Edges within this many points of level or plumb count as axis-aligned. */
export const AXIS_EPS = 0.01;

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `ctm`: pdf.js's `Util.transform(ctm, m)`, the PDF `cm` rule. */
export function concat(ctm: readonly number[], m: readonly number[]): Matrix {
  return [
    ctm[0]! * m[0]! + ctm[2]! * m[1]!,
    ctm[1]! * m[0]! + ctm[3]! * m[1]!,
    ctm[0]! * m[2]! + ctm[2]! * m[3]!,
    ctm[1]! * m[2]! + ctm[3]! * m[3]!,
    ctm[0]! * m[4]! + ctm[2]! * m[5]! + ctm[4]!,
    ctm[1]! * m[4]! + ctm[3]! * m[5]! + ctm[5]!,
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * The thickness, after the CTM, of a stroke `lineWidth` wide along a segment
 * whose direction AFTER the CTM is (dx, dy). The stroke is lineWidth wide
 * across the segment's pre-CTM direction u; after the CTM that becomes
 * lineWidth x |det M| / |M u|, which is lineWidth x |adj(M) d| for the unit
 * after-CTM direction d (adj(M) = |det M| x M^-1, so no division by det).
 * A zero-length segment has no direction: sqrt(|det M|) is used.
 */
export function strokeAcross(
  ctm: readonly number[],
  lineWidth: number,
  dx: number,
  dy: number,
): number {
  const a = ctm[0]!;
  const b = ctm[1]!;
  const c = ctm[2]!;
  const d = ctm[3]!;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return lineWidth * Math.sqrt(Math.abs(a * d - b * c));
  const ux = dx / len;
  const uy = dy / len;
  // adj of the linear part [[a c], [b d]] is [[d -c], [-b a]].
  return lineWidth * Math.hypot(d * ux - c * uy, -b * ux + a * uy);
}

function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof (value as ArrayLike<number>).length !== "number")
    return null;
  const a = Array.from(value as ArrayLike<number>);
  if (a.length < 6 || !a.slice(0, 6).every((n) => Number.isFinite(n)))
    return null;
  return a.slice(0, 6) as Matrix;
}

/** Rec. 709 luminance of 0..1 channels. */
function rgbLum(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The luminance of a colour operator's arguments: pdf.js 6 hands a
 * "#rrggbb" string; a hand-built list may hand [r, g, b] (0..1, or 0..255
 * when any channel is above 1) or a single grey level.
 */
export function colourLum(args: unknown): number {
  const first = (args as unknown[] | undefined)?.[0];
  if (typeof first === "string") {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(first);
    if (!m) return 0;
    return rgbLum(
      parseInt(m[1]!, 16) / 255,
      parseInt(m[2]!, 16) / 255,
      parseInt(m[3]!, 16) / 255,
    );
  }
  const nums = Array.from((args as ArrayLike<unknown>) ?? []).filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  );
  if (nums.length === 1) return Math.min(1, Math.max(0, nums[0]!));
  if (nums.length >= 3) {
    const scale = nums.slice(0, 3).some((n) => n > 1) ? 255 : 1;
    return rgbLum(nums[0]! / scale, nums[1]! / scale, nums[2]! / scale);
  }
  return 0;
}

/** [x0, y0, x1, y1] in user space after the CTM; empty when x0 > x1 or y0 > y1. */
type ClipBox = [number, number, number, number];

interface GState {
  ctm: Matrix;
  lineWidth: number;
  strokeLum: number;
  fillLum: number;
  /**
   * The bounding box of the clip: every `W`/`W*` path, form /BBox and group
   * bbox in force, intersected. null: nothing clips.
   */
  clip: ClipBox | null;
}

/** The bounding box of `box` (a [x0, y0, x1, y1] in the space `m` maps from). */
function boxUnder(m: Matrix, box: readonly number[]): ClipBox {
  const corners = [
    apply(m, box[0]!, box[1]!),
    apply(m, box[2]!, box[1]!),
    apply(m, box[0]!, box[3]!),
    apply(m, box[2]!, box[3]!),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Four finite numbers, as a box, or null. */
function asBox(value: unknown): number[] | null {
  if (!value || typeof (value as ArrayLike<number>).length !== "number")
    return null;
  const a = Array.from(value as ArrayLike<number>).slice(0, 4);
  return a.length === 4 && a.every((n) => Number.isFinite(n)) ? a : null;
}

function intersect(a: ClipBox | null, b: ClipBox): ClipBox {
  if (!a) return b;
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
}

/**
 * The part of the segment p-q inside `clip` widened by `pad` (Liang-Barsky),
 * or null when none of it is.
 */
function clipSegment(
  p: [number, number],
  q: [number, number],
  clip: ClipBox,
  pad: number,
): [[number, number], [number, number]] | null {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, p[0] - (clip[0] - pad)],
    [dx, clip[2] + pad - p[0]],
    [-dy, p[1] - (clip[1] - pad)],
    [dy, clip[3] + pad - p[1]],
  ];
  for (const [den, num] of edges) {
    if (den === 0) {
      if (num < 0) return null;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [
    [p[0] + t0 * dx, p[1] + t0 * dy],
    [p[0] + t1 * dx, p[1] + t1 * dy],
  ];
}

interface SubPath {
  /** Points after the CTM, in order. */
  pts: [number, number][];
  /** Index pairs into `pts` joined by a lineTo. */
  lines: [number, number][];
  closed: boolean;
  /** A curve was part of it: never a rectangle. */
  curved: boolean;
}

/** Split DrawOPS path data into subpaths under `m`. */
function subPaths(data: ArrayLike<number>, m: Matrix): SubPath[] {
  const out: SubPath[] = [];
  let cur: SubPath | null = null;
  let start: [number, number] = [0, 0];
  let at: [number, number] = [0, 0];
  const open = (p: [number, number]) => {
    cur = { pts: [p], lines: [], closed: false, curved: false };
    out.push(cur);
  };
  for (let i = 0; i < data.length;) {
    const op = data[i++]!;
    if (op === 0) {
      at = apply(m, data[i++]!, data[i++]!);
      start = at;
      open(at);
    } else if (op === 1) {
      const p = apply(m, data[i++]!, data[i++]!);
      if (!cur) open(at);
      const sp = cur as unknown as SubPath;
      sp.pts.push(p);
      sp.lines.push([sp.pts.length - 2, sp.pts.length - 1]);
      at = p;
    } else if (op === 2 || op === 3) {
      const n = op === 2 ? 3 : 2;
      let end: [number, number] = at;
      for (let k = 0; k < n; k++) end = apply(m, data[i++]!, data[i++]!);
      if (!cur) open(at);
      const sp = cur as unknown as SubPath;
      sp.curved = true;
      // The curve ends the straight run: the next lineTo starts from its end.
      sp.pts.push(end);
      at = end;
    } else if (op === 4) {
      if (cur) (cur as SubPath).closed = true;
      at = start;
      cur = null;
    } else break;
  }
  return out;
}

/**
 * The subpath as an axis-aligned rectangle: closed (by closePath, or by
 * returning to its first point), four corners, every edge level or plumb.
 */
function asRect(sp: SubPath): [number, number, number, number] | null {
  if (sp.curved) return null;
  const pts = sp.pts.slice();
  const same = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) <= AXIS_EPS && Math.abs(a[1] - b[1]) <= AXIS_EPS;
  let closed = sp.closed;
  if (pts.length === 5 && same(pts[0]!, pts[4]!)) {
    pts.pop();
    closed = true;
  }
  if (!closed || pts.length !== 4 || sp.lines.length < 3) return null;
  for (let k = 0; k < 4; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % 4]!;
    const level = Math.abs(a[1] - b[1]) <= AXIS_EPS;
    const plumb = Math.abs(a[0] - b[0]) <= AXIS_EPS;
    if (level === plumb) return null; // diagonal, or a zero-length edge
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Walk one page's operator list. See the module docblock for the layout read
 * and for what is skipped.
 */
export function scanPaths(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  OPS: OpsLike,
  limits: Partial<typeof PATH_LIMITS> = {},
): PathScan {
  const maxOps = limits.maxOps ?? PATH_LIMITS.maxOps;
  const maxPrimitives = limits.maxPrimitives ?? PATH_LIMITS.maxPrimitives;
  const maxFormDepth = limits.maxFormDepth ?? PATH_LIMITS.maxFormDepth;

  const segs: Seg[] = [];
  const rects: Rect[] = [];
  const images: ImageBox[] = [];
  let painted = 0;
  let ignored = 0;
  let capped: PathScan["capped"] = false;

  let st: GState = {
    ctm: IDENTITY,
    lineWidth: 1,
    strokeLum: 0,
    fillLum: 0,
    clip: null,
  };
  const stack: GState[] = [];
  // Form XObjects entered; those past the cap are skipped whole.
  let depth = 0;
  let deepFrom = Infinity;
  // A `W` / `W*` marks the NEXT path as a clip, which takes effect once that
  // path is painted (or ended by `n`): it never clips its own painting.
  let pendingClip = false;

  const strokeOps = new Set([OPS.stroke, OPS.closeStroke]);
  const fillOps = new Set([OPS.fill, OPS.eoFill]);
  const bothOps = new Set([
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  const imageOps = new Set(
    [
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,
    ].filter((n): n is number => typeof n === "number"),
  );
  const clipOps = new Set(
    [OPS.clip, OPS.eoClip].filter((n): n is number => typeof n === "number"),
  );

  /** A segment, trimmed to the clip (widened by half its stroke). */
  const pushSeg = (
    p: [number, number],
    q: [number, number],
    width: number,
    stroked: boolean,
    filled: boolean,
    lum: number,
  ) => {
    let a = p;
    let b = q;
    if (st.clip) {
      const cut = clipSegment(p, q, st.clip, stroked ? width / 2 : 0);
      if (!cut) return;
      [a, b] = cut;
    }
    segs.push({
      x0: a[0],
      y0: a[1],
      x1: b[0],
      y1: b[1],
      width,
      stroked,
      filled,
      lum,
    });
  };

  /**
   * A Rect, against the clip: kept whole inside it, dropped outside it, and
   * across its edge trimmed (a fill) or cut into its visible edges (an
   * outline, whose cut sides were never drawn).
   */
  const pushRect = (
    r: [number, number, number, number],
    level: number,
    plumb: number,
    stroked: boolean,
    filled: boolean,
    lum: number,
  ) => {
    const width = Math.max(level, plumb);
    const c = st.clip;
    const pad = stroked ? width / 2 : 0;
    const [x0, y0, x1, y1] = r;
    if (
      !c ||
      (x0 >= c[0] - pad &&
        y0 >= c[1] - pad &&
        x1 <= c[2] + pad &&
        y1 <= c[3] + pad)
    ) {
      rects.push({ x0, y0, x1, y1, width, stroked, filled, lum });
      return;
    }
    if (!stroked) {
      const t: ClipBox = [
        Math.max(x0, c[0]),
        Math.max(y0, c[1]),
        Math.min(x1, c[2]),
        Math.min(y1, c[3]),
      ];
      if (t[0] < t[2] && t[1] < t[3])
        rects.push({
          x0: t[0],
          y0: t[1],
          x1: t[2],
          y1: t[3],
          width,
          stroked,
          filled,
          lum,
        });
      return;
    }
    pushSeg([x0, y0], [x1, y0], level, stroked, filled, lum);
    pushSeg([x1, y0], [x1, y1], plumb, stroked, filled, lum);
    pushSeg([x1, y1], [x0, y1], level, stroked, filled, lum);
    pushSeg([x0, y1], [x0, y0], plumb, stroked, filled, lum);
  };

  /** The path's bounding box after the CTM, for a `W` waiting on it. */
  const pathBox = (args: unknown[]): ClipBox | null => {
    const mm = asBox(args[2]);
    if (mm) return boxUnder(st.ctm, mm);
    const holder = args[1] as unknown[] | null | undefined;
    const data = Array.isArray(holder) ? holder[0] : undefined;
    if (!data || typeof (data as ArrayLike<number>).length !== "number")
      return null;
    const pts = subPaths(data as ArrayLike<number>, st.ctm).flatMap(
      (sp) => sp.pts,
    );
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };

  /** Read one painted path; true when the primitive cap was reached. */
  const paintPath = (paintOp: number, args: unknown[]): boolean => {
    if (paintOp === OPS.endPath) return false; // a clip only
    let stroked = strokeOps.has(paintOp) || bothOps.has(paintOp);
    let filled = fillOps.has(paintOp) || bothOps.has(paintOp);
    if (!stroked && !filled) return false;
    painted++;
    // Read args[1][0], the pdf.js 6 place for the data (see the docblock).
    const holder = args[1] as unknown[] | null | undefined;
    const data = Array.isArray(holder) ? holder[0] : undefined;
    if (
      !data ||
      typeof (data as ArrayLike<number>).length !== "number" ||
      typeof (data as ArrayLike<number>)[0] !== "number"
    )
      return false;
    // Fill-and-stroke in a near-white fill is a stroked outline; a
    // near-white stroke around a dark fill is a filled shape.
    if (stroked && filled) {
      if (st.fillLum >= NEAR_WHITE_LUM) filled = false;
      else if (st.strokeLum >= NEAR_WHITE_LUM) stroked = false;
    }
    const lum = stroked ? st.strokeLum : st.fillLum;
    if (lum >= NEAR_WHITE_LUM) return false;
    const across = (dx: number, dy: number) =>
      strokeAcross(st.ctm, st.lineWidth, dx, dy);
    for (const sp of subPaths(data as ArrayLike<number>, st.ctm)) {
      const r = asRect(sp);
      if (r) {
        // Its level edges and its plumb edges.
        pushRect(r, across(1, 0), across(0, 1), stroked, filled, lum);
      } else {
        // Every lineTo, a two-point `m l` subpath included.
        for (const [a, b] of sp.lines) {
          const p = sp.pts[a]!;
          const q = sp.pts[b]!;
          pushSeg(p, q, across(q[0] - p[0], q[1] - p[1]), stroked, filled, lum);
        }
      }
      if (segs.length + rects.length > maxPrimitives) {
        capped = "primitives";
        return true;
      }
    }
    return false;
  };

  const total = fnArray.length;
  const n = Math.min(total, maxOps);
  if (total > maxOps) capped = "ops";

  let i = 0;
  for (; i < n; i++) {
    const fn = fnArray[i]!;
    const args = (argsArray[i] ?? []) as unknown[];

    if (fn === OPS.paintFormXObjectBegin) {
      depth++;
      if (depth > maxFormDepth) {
        if (deepFrom === Infinity) deepFrom = depth;
        ignored++;
        continue;
      }
      stack.push({ ...st });
      const matrix = asMatrix(args[0]);
      if (matrix) st = { ...st, ctm: concat(st.ctm, matrix) };
      // The form's /BBox, in form space: it clips what the form draws.
      const bbox = asBox(args[1]);
      if (bbox)
        st = { ...st, clip: intersect(st.clip, boxUnder(st.ctm, bbox)) };
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) {
      if (depth >= deepFrom) {
        ignored++;
        if (depth === deepFrom) deepFrom = Infinity;
      } else {
        st = stack.pop() ?? st;
      }
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth >= deepFrom) {
      ignored++;
      continue;
    }

    if (fn === OPS.save) {
      stack.push({ ...st });
    } else if (fn === OPS.restore) {
      st = stack.pop() ?? st;
    } else if (OPS.beginGroup !== undefined && fn === OPS.beginGroup) {
      // A form with a /Group hands its bbox here, not to the form begin
      // (pdf.js 6 `buildFormXObject`). The bbox is in form space, under the
      // form's matrix, which the form begin that follows then applies.
      stack.push({ ...st });
      const g = args[0] as { matrix?: unknown; bbox?: unknown } | undefined;
      const bbox = asBox(g?.bbox);
      if (bbox) {
        const m = asMatrix(g?.matrix);
        const under = m ? concat(st.ctm, m) : st.ctm;
        st = { ...st, clip: intersect(st.clip, boxUnder(under, bbox)) };
      }
    } else if (OPS.endGroup !== undefined && fn === OPS.endGroup) {
      st = stack.pop() ?? st;
    } else if (fn === OPS.transform) {
      const m = asMatrix(args);
      if (m) st = { ...st, ctm: concat(st.ctm, m) };
    } else if (fn === OPS.setLineWidth) {
      const w = Number(args[0]);
      if (Number.isFinite(w) && w >= 0) st = { ...st, lineWidth: w };
    } else if (fn === OPS.setStrokeRGBColor || fn === OPS.setStrokeGray) {
      st = { ...st, strokeLum: colourLum(args) };
    } else if (fn === OPS.setFillRGBColor || fn === OPS.setFillGray) {
      st = { ...st, fillLum: colourLum(args) };
    } else if (clipOps.has(fn)) {
      pendingClip = true;
    } else if (imageOps.has(fn)) {
      painted++;
      const corners = [
        apply(st.ctm, 0, 0),
        apply(st.ctm, 1, 0),
        apply(st.ctm, 0, 1),
        apply(st.ctm, 1, 1),
      ];
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      images.push({
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      });
    } else if (fn === OPS.constructPath) {
      const clipBox = pendingClip ? pathBox(args) : null;
      pendingClip = false;
      const stop = paintPath(args[0] as number, args);
      if (clipBox) st = { ...st, clip: intersect(st.clip, clipBox) };
      if (stop) {
        i++;
        break;
      }
    }
  }

  return { segs, rects, images, ops: i, painted, ignored, capped };
}
