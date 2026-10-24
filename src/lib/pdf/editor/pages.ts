import type { ExportFrame } from "./geometry";
import { changeOf, type Change } from "./history";
import {
  moveObject,
  objectBounds,
  type EditorObject,
  type Rect,
  type TextHeight,
} from "./model";

/**
 * The editor's page list: which page of the source file each displayed page
 * is, the quarter turn added to it, and blank pages inserted between them.
 * Pure data and pure operations — the rail and the Pages sheet dispatch
 * them, the reducer keeps the list in the same undo history as the objects
 * (`history.ts`, a command's `pages`), and the export replays it on the file
 * BEFORE anything is drawn (`editor-export.ts`), so every object is written
 * in the frame of the page it is displayed on.
 *
 * Objects keep `page` as a DISPLAY index. Every operation returns the
 * object changes that keep each one on its page: renumbered when pages move,
 * removed with a deleted page, and turned with a rotated one. A link to a
 * page names it by {@link PageRef.id}, so it follows a reorder untouched.
 */

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface PageRef {
  /** Stable for the session: `s<n>` for the file's own page n, fresh for an inserted one. */
  id: string;
  /** 0-based page of the source file, or null for an inserted blank page. */
  source: number | null;
  /** Clockwise turn ADDED to the page's own `/Rotate`. */
  rotate: QuarterTurn;
  /** A blank page's displayed size, points. */
  size?: { width: number; height: number };
}

/** The id the file's own page `index` carries. */
export function sourcePageId(index: number): string {
  return `s${index}`;
}

/** The file's pages, as they are. */
export function sourcePages(count: number): PageRef[] {
  return Array.from({ length: count }, (_, i) => ({
    id: sourcePageId(i),
    source: i,
    rotate: 0 as QuarterTurn,
  }));
}

/** Is this the file's own page list, unchanged? */
export function isIdentity(pages: readonly PageRef[], count: number): boolean {
  return (
    pages.length === count &&
    pages.every((p, i) => p.source === i && p.rotate === 0)
  );
}

/** The frame a page is displayed (and will be exported) in. */
export function displayFrame(
  ref: PageRef,
  sources: readonly ExportFrame[],
): ExportFrame | null {
  if (ref.source === null) {
    const size = ref.size ?? { width: 612, height: 792 };
    return {
      box: { x: 0, y: 0, width: size.width, height: size.height },
      rotation: 0,
      width: size.width,
      height: size.height,
    };
  }
  const f = sources[ref.source];
  if (!f) return null;
  const quarter = ref.rotate === 90 || ref.rotate === 270;
  return {
    box: f.box,
    rotation: ((f.rotation + ref.rotate) % 360) as ExportFrame["rotation"],
    width: quarter ? f.height : f.width,
    height: quarter ? f.width : f.height,
  };
}

export function displayFrames(
  pages: readonly PageRef[],
  sources: readonly ExportFrame[],
): ExportFrame[] {
  return pages.map(
    (p) =>
      displayFrame(p, sources) ?? {
        box: { x: 0, y: 0, width: 612, height: 792 },
        rotation: 0,
        width: 612,
        height: 792,
      },
  );
}

/** 1-based number of the page `id` names, or null when it was deleted. */
export function pageNumberOf(
  pages: readonly PageRef[],
  id: string,
): number | null {
  const i = pages.findIndex((p) => p.id === id);
  return i < 0 ? null : i + 1;
}

/* ---------------------------- turning a page ---------------------------- */

type Pt = { x: number; y: number };

/** A point on a W × H page, after the page turns 90° clockwise (now H × W). */
export function turnPoint(p: Pt, height: number): Pt {
  return { x: height - p.y, y: p.x };
}

/** An axis-aligned rect, turned with its page: exact, width and height swap. */
export function turnRect(r: Rect, height: number): Rect {
  return {
    x: height - (r.y + r.height),
    y: r.x,
    width: r.height,
    height: r.width,
  };
}

/**
 * One object on a W × H page, after the page turns 90° clockwise.
 *
 * Areas that mark the page's content (shapes, whiteout, redaction,
 * highlight, a link's box, an edited run's cover) turn exactly: their width
 * and height swap. Lines and drawings turn point by point. Text, notes,
 * pictures, signatures, check marks and form fields keep their size and stay
 * upright — they are things a person reads — and their centre turns with
 * the page, then is kept on it.
 */
export function turnObject(
  obj: EditorObject,
  width: number,
  height: number,
  textHeight: TextHeight,
): EditorObject {
  switch (obj.kind) {
    case "line": {
      const a = turnPoint({ x: obj.x1, y: obj.y1 }, height);
      const b = turnPoint({ x: obj.x2, y: obj.y2 }, height);
      return { ...obj, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case "ink":
      return { ...obj, points: obj.points.map((p) => turnPoint(p, height)) };
    case "shape":
    case "whiteout":
    case "redact":
    case "highlight":
      return { ...obj, ...turnRect(obj, height) };
    case "link":
      return {
        ...obj,
        ...turnRect(obj, height),
        ...(obj.origin
          ? {
              origin: {
                ...obj.origin,
                rect: turnRect(obj.origin.rect, height),
              },
            }
          : {}),
      };
    case "textedit": {
      const base = turnPoint({ x: obj.baseX, y: obj.baseY }, height);
      let angle = obj.angle + 90;
      if (angle > 180) angle -= 360;
      return {
        ...obj,
        ...turnRect(obj, height),
        baseX: base.x,
        baseY: base.y,
        angle,
      };
    }
    default: {
      const b = objectBounds(obj, textHeight);
      const c = turnPoint(
        { x: b.x + b.width / 2, y: b.y + b.height / 2 },
        height,
      );
      // The page is now `height` wide and `width` tall.
      const x = Math.min(
        Math.max(0, c.x - b.width / 2),
        Math.max(0, height - b.width),
      );
      const y = Math.min(
        Math.max(0, c.y - b.height / 2),
        Math.max(0, width - b.height),
      );
      return moveObject(obj, x - b.x, y - b.y);
    }
  }
}

/* ------------------------------ operations ------------------------------ */

export interface PageOp {
  pages: PageRef[];
  changes: Change[];
  label: string;
}

/** Deletions first, highest index first, so an undo puts each back in its place. */
function ordered(changes: Change[]): Change[] {
  const removed = changes
    .filter((c) => c.after === null)
    .sort((a, b) => b.at - a.at);
  const kept = changes.filter((c) => c.after !== null);
  return [...removed, ...kept];
}

/** Renumber every object by `map` (old display index → new, or null = gone). */
function remap(
  objects: readonly EditorObject[],
  map: (page: number) => number | null,
  touch?: (obj: EditorObject) => EditorObject,
): Change[] {
  const changes: Change[] = [];
  for (const obj of objects) {
    const to = map(obj.page);
    if (to === null) {
      changes.push(changeOf(objects, obj, null));
      continue;
    }
    let next = to === obj.page ? obj : { ...obj, page: to };
    if (touch) next = touch(next);
    if (next !== obj) changes.push(changeOf(objects, obj, next));
  }
  return ordered(changes);
}

/** Turn page `index` a quarter clockwise, its objects with it. */
export function rotatePage(
  pages: readonly PageRef[],
  index: number,
  objects: readonly EditorObject[],
  frames: readonly Pick<ExportFrame, "width" | "height">[],
  textHeight: TextHeight,
): PageOp | null {
  const ref = pages[index];
  const f = frames[index];
  if (!ref || !f) return null;
  const next = pages.slice();
  next[index] = {
    ...ref,
    rotate: ((ref.rotate + 90) % 360) as QuarterTurn,
    ...(ref.size
      ? { size: { width: ref.size.height, height: ref.size.width } }
      : {}),
  };
  // A blank page is turned by swapping its size, not by /Rotate: it has no
  // content to turn, and its frame stays unrotated.
  if (ref.source === null) next[index] = { ...next[index]!, rotate: 0 };
  return {
    label: `Rotate page ${index + 1}`,
    pages: next,
    changes: remap(
      objects,
      (p) => p,
      (o) =>
        o.page === index ? turnObject(o, f.width, f.height, textHeight) : o,
    ),
  };
}

/** Insert a blank page after `index`, the size that page is displayed at. */
export function insertBlankAfter(
  pages: readonly PageRef[],
  index: number,
  objects: readonly EditorObject[],
  frames: readonly Pick<ExportFrame, "width" | "height">[],
  id: string,
): PageOp | null {
  const f = frames[index];
  if (!pages[index] || !f) return null;
  const next = pages.slice();
  next.splice(index + 1, 0, {
    id,
    source: null,
    rotate: 0,
    size: { width: f.width, height: f.height },
  });
  return {
    label: `Insert a blank page after page ${index + 1}`,
    pages: next,
    changes: remap(objects, (p) => (p > index ? p + 1 : p)),
  };
}

/** Delete page `index` and what is placed on it. The last page cannot go. */
export function deletePage(
  pages: readonly PageRef[],
  index: number,
  objects: readonly EditorObject[],
): PageOp | null {
  if (pages.length <= 1 || !pages[index]) return null;
  const next = pages.filter((_, i) => i !== index);
  return {
    label: `Delete page ${index + 1}`,
    pages: next,
    changes: remap(objects, (p) =>
      p === index ? null : p > index ? p - 1 : p,
    ),
  };
}

/** Move page `from` so it becomes page `to` (0-based, in the new order). */
export function movePage(
  pages: readonly PageRef[],
  from: number,
  to: number,
  objects: readonly EditorObject[],
): PageOp | null {
  if (from === to || !pages[from] || to < 0 || to >= pages.length) return null;
  const next = pages.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  const order = next.map((p) => pages.indexOf(p));
  const where = new Map(order.map((old, now) => [old, now]));
  return {
    label: `Move page ${from + 1} to ${to + 1}`,
    pages: next,
    changes: remap(objects, (p) => where.get(p) ?? p),
  };
}
