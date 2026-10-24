/**
 * The WYSIWYG editor's object model — pure data, no DOM, no pdf-lib.
 *
 * COORDINATES. Every object lives on one page, in that page's VIEWER frame,
 * measured in PDF points from the TOP-LEFT corner of the page as a reader sees
 * it (the visible CropBox, after `/Rotate`), y growing DOWN. That is the frame
 * the pdf.js canvas is drawn in, so the overlay is a plain scale of it
 * (`geometry.ts`), and the frame `viewToContent` maps out of once the y axis
 * is flipped (`editor-export.ts`). Nothing here knows about zoom.
 *
 * Kinds are an id array so the toolbar, the export and the tool page's copy
 * all count the same list (`offered-kinds.ts` reads {@link EDITOR_OBJECT_KINDS}).
 */
import {
  EDITOR_KINDS,
  type EditorKind,
  type SignatureStyle,
} from "../offered-kinds";
import type { RasterImageFormat } from "../pdf-lib";

export const EDITOR_FONTS = ["helvetica", "times", "courier"] as const;
export type EditorFont = (typeof EDITOR_FONTS)[number];
export const EDITOR_FONT_LABEL: Record<EditorFont, string> = {
  helvetica: "Helvetica",
  times: "Times",
  courier: "Courier",
};

export type TextAlign = "left" | "center" | "right";

/** Shared by text boxes and notes: everything that decides how words are laid out. */
export interface TextStyle {
  font: EditorFont;
  /** Font size, points. */
  size: number;
  /** `#rrggbb`. */
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** Line advance as a multiple of `size`. */
  lineHeight: number;
}

interface Base {
  id: string;
  /** 0-based page index. */
  page: number;
}

interface Boxed {
  /** Top-left corner, viewer points. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBoxObject extends Base, TextStyle {
  kind: "text";
  x: number;
  y: number;
  /** Wrap width, points. Height follows from the laid-out lines. */
  width: number;
  text: string;
}

export interface NoteObject extends Base, TextStyle {
  kind: "note";
  x: number;
  y: number;
  width: number;
  text: string;
  /** The note's paper colour. */
  fill: string;
}

export interface ImageObject extends Base, Boxed {
  kind: "image";
  format: RasterImageFormat;
  bytes: Uint8Array;
  opacity: number;
}

export interface SignatureObject extends Base, Boxed {
  kind: "signature";
  format: RasterImageFormat;
  bytes: Uint8Array;
}

export type ShapeType = "rect" | "ellipse";

export interface ShapeObject extends Base, Boxed {
  kind: "shape";
  shape: ShapeType;
  /** Outline colour, or null for none. */
  stroke: string | null;
  strokeWidth: number;
  /** Fill colour, or null for none. */
  fill: string | null;
  opacity: number;
}

export interface LineObject extends Base {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  arrow: boolean;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

/** A plain white box. It COVERS what is under it; it removes nothing. */
export interface WhiteoutObject extends Base, Boxed {
  kind: "whiteout";
}

export interface HighlightObject extends Base, Boxed {
  kind: "highlight";
  color: string;
  opacity: number;
}

export interface InkObject extends Base {
  kind: "ink";
  /** Absolute viewer points, in drawing order. */
  points: { x: number; y: number }[];
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

export type EditorObject =
  | TextBoxObject
  | NoteObject
  | ImageObject
  | SignatureObject
  | ShapeObject
  | LineObject
  | WhiteoutObject
  | HighlightObject
  | InkObject;

export type EditorObjectKind = EditorObject["kind"];

/**
 * Every kind the editor places, in toolbar order — the `offered-kinds` list
 * the tool page counts. `Record`s below are keyed by it, so a kind added to
 * the union without a label is a type error, and {@link KindsAgree} fails to
 * compile if the union and the list ever differ, in either direction.
 */
export const EDITOR_OBJECT_KINDS = EDITOR_KINDS;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type KindsAgree = Assert<Same<EditorObjectKind, EditorKind>>;

export const EDITOR_OBJECT_LABEL: Record<EditorObjectKind, string> = {
  text: "Text box",
  note: "Note",
  image: "Image",
  signature: "Signature",
  shape: "Shape",
  line: "Line",
  whiteout: "Whiteout",
  highlight: "Highlight",
  ink: "Drawing",
};

/** A rectangle in viewer points (top-left origin). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Laid-out height of a text box / note's words; supplied by whoever can measure. */
export type TextHeight = (obj: TextBoxObject | NoteObject) => number;

/** Inner padding of a note, points. Shared by the overlay and the export. */
export const NOTE_PADDING = 6;

export const MIN_SIZE = 4;

/** Arrow keys move a selection by this many points; with Shift, by the second. */
export const NUDGE_PT = 1;
export const NUDGE_BIG_PT = 10;

/** Barb length of an arrowhead for a stroke width — overlay and export both. */
export function arrowHeadSize(strokeWidth: number): number {
  return Math.max(8, strokeWidth * 4);
}

/** Bounding box of any object. Text and notes need their laid-out height. */
export function objectBounds(obj: EditorObject, textHeight: TextHeight): Rect {
  switch (obj.kind) {
    case "text":
      return { x: obj.x, y: obj.y, width: obj.width, height: textHeight(obj) };
    case "note":
      return {
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: textHeight(obj) + NOTE_PADDING * 2,
      };
    case "line": {
      const x = Math.min(obj.x1, obj.x2);
      const y = Math.min(obj.y1, obj.y2);
      return {
        x,
        y,
        width: Math.abs(obj.x2 - obj.x1),
        height: Math.abs(obj.y2 - obj.y1),
      };
    }
    case "ink": {
      if (obj.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of obj.points) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    default:
      return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
}

/** The same object, moved by (dx, dy) points. */
export function moveObject<T extends EditorObject>(
  obj: T,
  dx: number,
  dy: number,
): T {
  switch (obj.kind) {
    case "line":
      return {
        ...obj,
        x1: obj.x1 + dx,
        y1: obj.y1 + dy,
        x2: obj.x2 + dx,
        y2: obj.y2 + dy,
      };
    case "ink":
      return {
        ...obj,
        points: obj.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    default:
      return { ...obj, x: obj.x + dx, y: obj.y + dy };
  }
}

/**
 * The same object fitted to `next` bounds. Text and notes take only the new
 * x, y and width — their height is their words. Ink is scaled about its box.
 * Lines are resized by their endpoints instead ({@link setLineEndpoint}).
 */
export function resizeObject<T extends EditorObject>(
  obj: T,
  from: Rect,
  next: Rect,
): T {
  const width = Math.max(MIN_SIZE, next.width);
  const height = Math.max(MIN_SIZE, next.height);
  switch (obj.kind) {
    case "text":
    case "note":
      return { ...obj, x: next.x, y: next.y, width };
    case "line": {
      const sx = from.width === 0 ? 1 : next.width / from.width;
      const sy = from.height === 0 ? 1 : next.height / from.height;
      return {
        ...obj,
        x1: next.x + (obj.x1 - from.x) * sx,
        y1: next.y + (obj.y1 - from.y) * sy,
        x2: next.x + (obj.x2 - from.x) * sx,
        y2: next.y + (obj.y2 - from.y) * sy,
      };
    }
    case "ink": {
      const sx = from.width === 0 ? 1 : next.width / from.width;
      const sy = from.height === 0 ? 1 : next.height / from.height;
      return {
        ...obj,
        points: obj.points.map((p) => ({
          x: next.x + (p.x - from.x) * sx,
          y: next.y + (p.y - from.y) * sy,
        })),
      };
    }
    default:
      return { ...obj, x: next.x, y: next.y, width, height };
  }
}

export function setLineEndpoint(
  obj: LineObject,
  end: 1 | 2,
  point: { x: number; y: number },
): LineObject {
  return end === 1
    ? { ...obj, x1: point.x, y1: point.y }
    : { ...obj, x2: point.x, y2: point.y };
}

/** Handles a selection frame offers: 8 for boxes, east/west for text, ends for lines. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const ALL_HANDLES: readonly Handle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

export function handlesFor(obj: EditorObject): readonly Handle[] {
  if (obj.kind === "text" || obj.kind === "note") return ["w", "e"];
  if (obj.kind === "line") return [];
  return ALL_HANDLES;
}

/**
 * Drag a handle of `from` to (px, py). `keepAspect` locks the ratio (images
 * and signatures with Shift held, or always for corner drags on signatures).
 */
export function dragHandle(
  from: Rect,
  handle: Handle,
  px: number,
  py: number,
  keepAspect = false,
): Rect {
  let x0 = from.x;
  let y0 = from.y;
  let x1 = from.x + from.width;
  let y1 = from.y + from.height;
  if (handle.includes("w")) x0 = Math.min(px, x1 - MIN_SIZE);
  if (handle.includes("e")) x1 = Math.max(px, x0 + MIN_SIZE);
  if (handle.includes("n")) y0 = Math.min(py, y1 - MIN_SIZE);
  if (handle.includes("s")) y1 = Math.max(py, y0 + MIN_SIZE);
  let rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  if (keepAspect && from.width > 0 && from.height > 0 && handle.length === 2) {
    const ratio = from.width / from.height;
    const width = Math.max(rect.width, rect.height * ratio);
    const height = width / ratio;
    rect = {
      x: handle.includes("w") ? x1 - width : x0,
      y: handle.includes("n") ? y1 - height : y0,
      width,
      height,
    };
  }
  return rect;
}

/** Do two rects overlap (touching counts)? */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

/** Normalise a rect dragged in any direction. */
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

let counter = 0;
/** A fresh object id — unique within the tab. */
export function newObjectId(): string {
  counter += 1;
  return `o${Date.now().toString(36)}${counter.toString(36)}`;
}

/** A copy with a fresh id (and fresh nested arrays), for paste/duplicate. */
export function cloneObject<T extends EditorObject>(obj: T): T {
  const copy = { ...obj, id: newObjectId() };
  if (copy.kind === "ink") {
    return { ...copy, points: copy.points.map((p) => ({ ...p })) } as T;
  }
  return copy;
}

/** A short, human description for aria labels and announcements. */
export function describeObject(obj: EditorObject): string {
  const page = `page ${obj.page + 1}`;
  switch (obj.kind) {
    case "text":
    case "note": {
      const words = obj.text.trim().slice(0, 40) || "empty";
      return `${EDITOR_OBJECT_LABEL[obj.kind]} “${words}” on ${page}`;
    }
    case "shape":
      return `${obj.shape === "ellipse" ? "Ellipse" : "Rectangle"} on ${page}`;
    case "line":
      return `${obj.arrow ? "Arrow" : "Line"} on ${page}`;
    default:
      return `${EDITOR_OBJECT_LABEL[obj.kind]} on ${page}`;
  }
}

/** Letter size of a typed signature when it is placed, points. */
export const TYPED_SIGNATURE_SIZE = 28;
/** The signature ink colour Sign PDF has always used (slate-900). */
export const SIGNATURE_INK = "#0f172a";

/**
 * A typed signature as the editor places it: a one-line text box in the
 * style's face — Script is Times Italic, Print is Helvetica, the faces Sign
 * PDF's copy names (`sign-style-copy.test.ts` reads them back out of the
 * export). Text in another script takes the one upright Noto face, as every
 * text box does.
 */
export function typedSignatureObject(
  id: string,
  page: number,
  x: number,
  y: number,
  width: number,
  text: string,
  style: SignatureStyle,
): TextBoxObject {
  return {
    id,
    kind: "text",
    page,
    x,
    y,
    width,
    text,
    font: style === "signature" ? "times" : "helvetica",
    italic: style === "signature",
    bold: false,
    size: TYPED_SIGNATURE_SIZE,
    color: SIGNATURE_INK,
    align: "left",
    lineHeight: 1.2,
  };
}

/** Defaults a newly placed object starts from. */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: "helvetica",
  size: 16,
  color: "#111827",
  bold: false,
  italic: false,
  align: "left",
  lineHeight: 1.2,
};

export const DEFAULT_NOTE_FILL = "#fef08a";
export const DEFAULT_HIGHLIGHT = "#facc15";
export const DEFAULT_STROKE = "#dc2626";
