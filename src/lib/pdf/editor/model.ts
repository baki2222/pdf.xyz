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
  COMMENT_KINDS,
  EDITOR_KINDS,
  type CommentKind,
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
  /** Wrap width, points. */
  width: number;
  /**
   * The box's height when it was resized taller than its words, points.
   * The box is never shorter than its laid-out lines; absent, it is exactly
   * as tall as they are.
   */
  height?: number;
  text: string;
}

export interface NoteObject extends Base, TextStyle {
  kind: "note";
  x: number;
  y: number;
  width: number;
  /** As {@link TextBoxObject.height}: a minimum, never shorter than the words. */
  height?: number;
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

export type RedactFill = "black" | "white";

/**
 * A redaction: on export the text, image pixels and annotations under the
 * box are REMOVED from the file (`content-edit.ts`), then the box is filled.
 */
export interface RedactObject extends Base, Boxed {
  kind: "redact";
  fill: RedactFill;
}

/** A text run as pdf.js read it, in CONTENT space (pdf-lib's user space). */
export interface RunGeometryData {
  /** Text space → user space, font size included. */
  transform: [number, number, number, number, number, number];
  /** Advance along the baseline, user units. */
  width: number;
}

/**
 * An edit to text already on the page. `x/y/width/height` are the original
 * run's box in viewer points (what the overlay covers while editing); on
 * export the run's glyphs are REMOVED from the content stream and `text` is
 * drawn where the run began — in the run's own font when it has every
 * character (`ownChars`), else in the closest standard face (`font`, `bold`,
 * `italic`). Empty `text` deletes the run.
 */
export interface TextEditObject extends Base, Boxed {
  kind: "textedit";
  run: RunGeometryData;
  original: string;
  text: string;
  /** Font size as displayed, viewer points. */
  size: number;
  color: string;
  font: EditorFont;
  bold: boolean;
  italic: boolean;
  /** Characters the run's own font can write back. */
  ownChars: string;
  /** The run's own font, by name. */
  fontName: string;
  /** Baseline start, viewer points. */
  baseX: number;
  baseY: number;
  /** Reading direction on screen, degrees clockwise from +x. */
  angle: number;
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

/** Where a link goes. `page` names a page by its id, so it follows a reorder. */
export type LinkTarget =
  | { type: "uri"; uri: string }
  | { type: "page"; pageId: string }
  /** A target read from the file that the editor does not rewrite (a named destination, a script). */
  | { type: "other"; label: string };

/** A link that was already in the file: which annotation, and how it read. */
export interface LinkOrigin {
  /** The annotation's object number and generation, `"12 0"`. */
  ref: string;
  /** Its box and target as read, so an untouched link is left exactly as it was. */
  rect: Rect;
  target: LinkTarget;
}

/**
 * A clickable area. Exported as a real `/Link` annotation (not drawn on the
 * page): `/URI` for a web address, email or phone number, `/GoTo` to a page.
 */
export interface LinkObject extends Base, Boxed {
  kind: "link";
  target: LinkTarget;
  /** Present for a link read from the file. */
  origin?: LinkOrigin;
}

export type MarkGlyph = "check" | "cross";

/** A check mark or a cross, drawn as two or three strokes in its box. */
export interface MarkObject extends Base, Boxed {
  kind: "mark";
  glyph: MarkGlyph;
  color: string;
}

/** The form fields the editor creates, in toolbar order. */
export const EDITOR_FIELD_TYPES = [
  "text",
  "checkbox",
  "dropdown",
  "radio",
  "signature",
] as const;
export type EditorFieldType = (typeof EDITOR_FIELD_TYPES)[number];
export const EDITOR_FIELD_LABEL: Record<EditorFieldType, string> = {
  text: "Text field",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  radio: "Radio group",
  signature: "Signature field",
};

/**
 * A new fillable form field, exported as a real AcroForm field (pdf-lib's
 * form API; a signature field as an unsigned `/Sig` widget). A radio group's
 * box holds its buttons stacked one per option ({@link radioRows}).
 */
export interface FieldObject extends Base, Boxed {
  kind: "field";
  fieldType: EditorFieldType;
  /** The field's name in the form — what a filled form is read back by. */
  name: string;
  /** Dropdown and radio choices. */
  options: string[];
  /** Starting text (text field) or the chosen option (dropdown, radio); "" for none. */
  value: string;
  /** Checkbox only: starts ticked. */
  checked: boolean;
  /** Text field only: more than one line. */
  multiline: boolean;
}

export type EditorObject =
  | TextBoxObject
  | NoteObject
  | ImageObject
  | SignatureObject
  | ShapeObject
  | LineObject
  | WhiteoutObject
  | RedactObject
  | TextEditObject
  | HighlightObject
  | InkObject
  | LinkObject
  | MarkObject
  | FieldObject;

export type EditorObjectKind = EditorObject["kind"];

/** The objects "Save markups as comments" writes as annotations (`comments.ts`). */
export type CommentObject =
  HighlightObject | InkObject | NoteObject | ShapeObject | LineObject;

export type CommentsAgree = Assert<Same<CommentObject["kind"], CommentKind>>;
const COMMENT_SET: ReadonlySet<string> = new Set<CommentKind>(COMMENT_KINDS);

/** Can this object be saved as a comment (and so, on a restricted PDF that allows comments, be placed)? */
export function isCommentObject(obj: EditorObject): obj is CommentObject {
  return COMMENT_SET.has(obj.kind);
}

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
  textedit: "Edited text",
  redact: "Redaction",
  note: "Note",
  image: "Image",
  signature: "Signature",
  shape: "Shape",
  line: "Line",
  whiteout: "Whiteout",
  highlight: "Highlight",
  ink: "Drawing",
  mark: "Check mark",
  link: "Link",
  field: "Form field",
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
      return {
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: Math.max(textHeight(obj), obj.height ?? 0),
      };
    case "note":
      return {
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: Math.max(textHeight(obj) + NOTE_PADDING * 2, obj.height ?? 0),
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
 * The same object fitted to `next` bounds. Text and notes take the new box
 * too, but are never drawn shorter than their words (`objectBounds`). Ink is
 * scaled about its box.
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
      return { ...obj, x: next.x, y: next.y, width, height };
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

/**
 * Handles a selection frame offers: 8 for boxes and text, ends for lines.
 *
 * HISTORY. Until 2026-10-24 (Phase 3) text boxes and notes offered only the
 * east and west handles — their height was their words. They resize in
 * height too now, never below their words.
 */
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
  if (obj.kind === "textedit") return [];
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
  if (copy.kind === "link") {
    // A copy is a new link: it no longer stands for the one in the file.
    const rest: LinkObject = { ...copy };
    delete rest.origin;
    return rest as T;
  }
  if (copy.kind === "field") {
    return { ...copy, options: [...copy.options] } as T;
  }
  return copy;
}

export function sameTarget(a: LinkTarget, b: LinkTarget): boolean {
  if (a.type === "uri") return b.type === "uri" && a.uri === b.uri;
  if (a.type === "page") return b.type === "page" && a.pageId === b.pageId;
  return b.type === "other" && a.label === b.label;
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.width - b.width) < 0.01 &&
    Math.abs(a.height - b.height) < 0.01
  );
}

/** A link read from the file that nobody has moved, resized or re-aimed. */
export function linkUntouched(obj: LinkObject): boolean {
  return (
    !!obj.origin &&
    sameRect(obj, obj.origin.rect) &&
    sameTarget(obj.target, obj.origin.target)
  );
}

/** A short label for where a link goes. */
export function describeLinkTarget(
  target: LinkTarget,
  pageNumber: (pageId: string) => number | null,
): string {
  switch (target.type) {
    case "uri":
      return target.uri.replace(/^(https?:[/][/]|mailto:|tel:)/i, "");
    case "page": {
      const n = pageNumber(target.pageId);
      return n === null ? "a deleted page" : `page ${n}`;
    }
    default:
      return target.label;
  }
}

/** One radio button's square and its label's baseline, per option. */
export function radioRows(
  obj: Pick<FieldObject, "x" | "y" | "width" | "height" | "options">,
): { box: Rect; labelX: number; baseline: number; size: number }[] {
  const n = Math.max(1, obj.options.length);
  const row = obj.height / n;
  const side = Math.max(4, Math.min(row * 0.8, obj.width, 18));
  return obj.options.map((_, i) => {
    const top = obj.y + i * row + (row - side) / 2;
    return {
      box: { x: obj.x, y: top, width: side, height: side },
      labelX: obj.x + side * 1.4,
      baseline: top + side * 0.8,
      size: side * 0.8,
    };
  });
}

/** The strokes of a check mark or cross in its box, as polylines (viewer points). */
export function markStrokes(
  obj: Pick<MarkObject, "x" | "y" | "width" | "height" | "glyph">,
): { x: number; y: number }[][] {
  const { x, y, width: w, height: h } = obj;
  if (obj.glyph === "check") {
    return [
      [
        { x: x + w * 0.12, y: y + h * 0.55 },
        { x: x + w * 0.4, y: y + h * 0.82 },
        { x: x + w * 0.88, y: y + h * 0.18 },
      ],
    ];
  }
  return [
    [
      { x: x + w * 0.18, y: y + h * 0.18 },
      { x: x + w * 0.82, y: y + h * 0.82 },
    ],
    [
      { x: x + w * 0.82, y: y + h * 0.18 },
      { x: x + w * 0.18, y: y + h * 0.82 },
    ],
  ];
}

/** Stroke width of a mark: scales with its box. */
export function markStrokeWidth(
  obj: Pick<MarkObject, "width" | "height">,
): number {
  return Math.max(1, Math.min(obj.width, obj.height) * 0.12);
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
    case "textedit": {
      const words = obj.text.trim().slice(0, 40);
      return words
        ? `${EDITOR_OBJECT_LABEL.textedit} “${words}” on ${page}`
        : `Deleted text “${obj.original.trim().slice(0, 40)}” on ${page}`;
    }
    case "shape":
      return `${obj.shape === "ellipse" ? "Ellipse" : "Rectangle"} on ${page}`;
    case "line":
      return `${obj.arrow ? "Arrow" : "Line"} on ${page}`;
    case "mark":
      return `${obj.glyph === "check" ? "Check mark" : "Cross"} on ${page}`;
    case "link":
      return obj.target.type === "uri"
        ? `Link to ${describeLinkTarget(obj.target, () => null)} on ${page}`
        : `Link on ${page}`;
    case "field":
      return obj.name
        ? `${EDITOR_FIELD_LABEL[obj.fieldType]} “${obj.name}” on ${page}`
        : `${EDITOR_FIELD_LABEL[obj.fieldType]} on ${page}`;
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
