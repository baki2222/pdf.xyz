import type { PDFDocument, PDFFont, PDFPage, PDFRef } from "pdf-lib";
import { arrowHeadSegments, clampOpacity, parseHexColor } from "../annotate";
import type { PdfLibModule } from "../pdf-lib";
import {
  viewerRectToContent,
  viewerToContent,
  type ExportFrame,
} from "./geometry";
import {
  NOTE_PADDING,
  arrowHeadSize,
  isCommentObject,
  type CommentObject,
  type EditorFont,
  type NoteObject,
  type Rect,
} from "./model";
import type { TextRun } from "./runs";
import { layoutText, lineBaseline, lineLeft } from "./text";

/**
 * "Save markups as comments": the editor's highlights, drawings, notes,
 * shapes and lines written as real PDF annotations (ISO 32000-1 §12.5) —
 * the objects another reader lists in its comment panel and lets a person
 * select, move, edit or delete — instead of being drawn into the page.
 *
 *   Highlight → /Highlight with /QuadPoints (snapped to the text lines under
 *               the box when there are any — {@link snapHighlightQuads})
 *   Draw      → /Ink with /InkList
 *   Note      → /FreeText: the editor's note is a visible box of words on
 *               coloured paper, which is a FreeText, not a /Text sticky icon
 *   Rectangle → /Square, Ellipse → /Circle
 *   Line      → /Line, an arrow with /LE [/None /OpenArrow]
 *
 * Each carries its own appearance stream (/AP /N), drawn here, so a viewer
 * that does not synthesise one still paints exactly what the editor showed;
 * a highlight's multiplies over the page, as the flattened one does. Each
 * has a unique /NM, a /M date and /F 4 (printed with the page), and no /T:
 * the editor never asks for a name, and inventing one would label every
 * comment with an author nobody typed.
 *
 * Whiteout and Redact are NEVER comments: a comment can be deleted by
 * whoever opens the file, so a cover written as one would hide nothing.
 *
 * COORDINATES. An annotation's /Rect, /QuadPoints, /InkList and /L are in
 * the page's default user space — CONTENT space, before `/Rotate` — and a
 * viewer turns them with the page. Every point goes through
 * `viewerToContent`, the one mapping every placing tool shares, and each
 * appearance is drawn in content space too, with its /BBox equal to the
 * /Rect and no /Matrix, so the form lands exactly on the rectangle. Only a
 * note's words are counter-turned (they must read upright), the way the
 * flattened export turns them.
 *
 * `editor-export-comments.test.ts` reads every kind back through pdf.js
 * (subtype, rect on a /Rotate 90 page, colour, contents) and renders it.
 */

export type MarkupMode = "flatten" | "comments";

export { isCommentObject, type CommentObject };

/** A run counts as under a highlight when the box covers this much of its height. */
const MIN_COVER = 0.5;
const ANGLE_TOLERANCE = 1;

/**
 * The quads a highlight covers, in viewer points: where the box lies over
 * text lines, one quad per line — the line's own height, clipped to the
 * box's left and right edges — as a viewer's text highlight is; elsewhere
 * (no run under it, or only turned text), the box itself.
 */
export function snapHighlightQuads(
  box: Rect,
  runs: readonly TextRun[],
): Rect[] {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const hits: Rect[] = [];
  for (const run of runs) {
    const a = ((run.angle % 360) + 360) % 360;
    if (Math.min(a, 360 - a) > ANGLE_TOLERANCE) continue;
    const r = run.rect;
    const cover = Math.min(bottom, r.y + r.height) - Math.max(box.y, r.y);
    if (!(r.height > 0) || cover < r.height * MIN_COVER) continue;
    const x0 = Math.max(box.x, r.x);
    const x1 = Math.min(right, r.x + r.width);
    if (x1 - x0 <= 0) continue;
    hits.push({ x: x0, y: r.y, width: x1 - x0, height: r.height });
  }
  if (hits.length === 0) return [box];
  // Runs on one line (centres within half a line of each other) merge.
  hits.sort((p, q) => p.y + p.height / 2 - (q.y + q.height / 2) || p.x - q.x);
  const lines: Rect[] = [];
  for (const h of hits) {
    const last = lines[lines.length - 1];
    if (
      last &&
      Math.abs(last.y + last.height / 2 - (h.y + h.height / 2)) <
        Math.min(last.height, h.height) / 2
    ) {
      const x0 = Math.min(last.x, h.x);
      const y0 = Math.min(last.y, h.y);
      const x1 = Math.max(last.x + last.width, h.x + h.width);
      const y1 = Math.max(last.y + last.height, h.y + h.height);
      lines[lines.length - 1] = {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
      };
    } else lines.push(h);
  }
  return lines;
}

/** What writing a note's words needs from the export: its font, and how it lays out. */
export interface NoteText {
  font: PDFFont;
  measure: (text: string, size: number) => number;
  /** The note's box, viewer points (its laid-out height included). */
  box: Rect;
}

export interface CommentContext {
  lib: PdfLibModule;
  doc: PDFDocument;
  pages: readonly PDFPage[];
  frames: readonly ExportFrame[];
  /** Text runs per displayed page, for highlights to snap to. */
  runs: Readonly<Record<number, readonly TextRun[]>>;
  note: (obj: NoteObject) => NoteText;
  /** A fresh /NM; tests may pin it. */
  name?: () => string;
  now?: Date;
}

const num = (n: number) => {
  const s = (Math.round(n * 1000) / 1000).toFixed(3);
  return s.replace(/\.?0+$/, "") || "0";
};
const nums = (...values: number[]) => values.map(num).join(" ");

function rgbOf(hex: string): [number, number, number] {
  const c = parseHexColor(hex) ?? { r: 0, g: 0, b: 0 };
  return [c.r, c.g, c.b];
}

/** The standard font a viewer regenerating a FreeText would use (/DA). */
const DA_FONT: Record<EditorFont, string> = {
  helvetica: "Helv",
  times: "TiRo",
  courier: "Cour",
};

function randomName(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

type Box4 = [number, number, number, number];

function grow(b: Box4, by: number): Box4 {
  return [b[0] - by, b[1] - by, b[2] + by, b[3] + by];
}

function boxOf(points: readonly { x: number; y: number }[]): Box4 {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Write each comment object as an annotation on its page, in list order
 * (a later one sits on top in the viewer, as in the overlay). Returns how
 * many were written.
 */
export function writeComments(
  ctx: CommentContext,
  objects: readonly CommentObject[],
): number {
  const { lib, doc } = ctx;
  const { PDFName, PDFString, PDFHexString } = lib;
  const context = doc.context;
  const now = ctx.now ?? new Date();
  const nameOf = ctx.name ?? (() => `pdfxyz-${randomName()}`);

  const gs = (opacity: number, multiply = false) =>
    context.obj({
      ExtGState: {
        GS0: {
          Type: "ExtGState",
          CA: clampOpacity(opacity),
          ca: clampOpacity(opacity),
          ...(multiply ? { BM: "Multiply" } : {}),
        },
      },
    });

  const appearance = (
    bbox: Box4,
    content: string,
    resources: ReturnType<typeof gs>,
  ): PDFRef =>
    context.register(
      context.flateStream(content, {
        Type: "XObject",
        Subtype: "Form",
        FormType: 1,
        BBox: bbox.map((n) => Number(num(n))),
        Resources: resources,
      }),
    );

  const add = (
    page: PDFPage,
    subtype: string,
    rect: Box4,
    ap: PDFRef,
    entries: Record<string, unknown>,
  ) => {
    const dict = context.obj({
      Type: "Annot",
      Subtype: subtype,
      Rect: rect.map((n) => Number(num(n))),
      P: page.ref,
      F: 4,
      NM: PDFString.of(nameOf()),
      M: PDFString.fromDate(now),
      AP: { N: ap },
    });
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) continue;
      dict.set(
        PDFName.of(key),
        value instanceof lib.PDFObject
          ? value
          : context.obj(value as Parameters<typeof context.obj>[0]),
      );
    }
    // Not `page.node.addAnnot`: that normalises the page first, which wraps
    // its content streams in q/Q — a change to what the page draws, which
    // a restricted file's author withheld (`../security/incremental`).
    const ref = context.register(dict);
    const annots = page.node.Annots();
    if (annots) annots.push(ref);
    else page.node.set(PDFName.of("Annots"), context.obj([ref]));
  };

  let written = 0;
  for (const obj of objects) {
    const page = ctx.pages[obj.page]!;
    const frame = ctx.frames[obj.page]!;
    const toContent = (x: number, y: number) => viewerToContent(x, y, frame);
    switch (obj.kind) {
      case "highlight": {
        const quads = snapHighlightQuads(obj, ctx.runs[obj.page] ?? []);
        // Corner order as viewers read /QuadPoints: upper-left, upper-right,
        // lower-left, lower-right — of the quad AS DISPLAYED, so the "top"
        // follows the text on a turned page.
        const corners = quads.map((q) => [
          toContent(q.x, q.y),
          toContent(q.x + q.width, q.y),
          toContent(q.x, q.y + q.height),
          toContent(q.x + q.width, q.y + q.height),
        ]);
        const rect = boxOf(corners.flat());
        const [r, g, b] = rgbOf(obj.color);
        const paths = corners
          .map(
            ([ul, ur, ll, lr]) =>
              `${nums(ul!.x, ul!.y)} m ${nums(ur!.x, ur!.y)} l ${nums(lr!.x, lr!.y)} l ${nums(ll!.x, ll!.y)} l h`,
          )
          .join("\n");
        const ap = appearance(
          rect,
          `q /GS0 gs ${nums(r, g, b)} rg\n${paths}\nf Q`,
          gs(obj.opacity, true),
        );
        add(page, "Highlight", rect, ap, {
          C: [r, g, b],
          CA: clampOpacity(obj.opacity),
          QuadPoints: corners.flatMap((c) => c.flatMap((p) => [p.x, p.y])),
        });
        break;
      }
      case "ink": {
        if (obj.points.length === 0) continue;
        const pts = obj.points.map((p) => toContent(p.x, p.y));
        const rect = grow(boxOf(pts), obj.strokeWidth / 2 + 1);
        const [r, g, b] = rgbOf(obj.stroke);
        const [first, ...rest] = pts;
        const path =
          `${nums(first!.x, first!.y)} m` +
          (rest.length === 0
            ? ` ${nums(first!.x, first!.y)} l`
            : rest.map((p) => ` ${nums(p.x, p.y)} l`).join(""));
        const ap = appearance(
          rect,
          `q /GS0 gs ${nums(r, g, b)} RG ${num(obj.strokeWidth)} w 1 J 1 j\n${path}\nS Q`,
          gs(obj.opacity),
        );
        add(page, "Ink", rect, ap, {
          C: [r, g, b],
          CA: clampOpacity(obj.opacity),
          BS: { W: obj.strokeWidth, S: "S" },
          InkList: [pts.flatMap((p) => [p.x, p.y])],
        });
        break;
      }
      case "shape": {
        if (!obj.fill && !obj.stroke) continue;
        const c = viewerRectToContent(obj, frame);
        const sw = obj.stroke ? obj.strokeWidth : 0;
        // The flattened shape strokes ON the box's edge, so half the stroke
        // lies outside it: the annotation's rectangle holds all of it.
        const rect = grow([c.x0, c.y0, c.x1, c.y1], sw / 2);
        const stroke = obj.stroke ? rgbOf(obj.stroke) : null;
        const fill = obj.fill ? rgbOf(obj.fill) : null;
        const paint = stroke && fill ? "B" : fill ? "f" : "S";
        let path: string;
        if (obj.shape === "rect") {
          path = `${nums(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0)} re`;
        } else {
          const cx = (c.x0 + c.x1) / 2;
          const cy = (c.y0 + c.y1) / 2;
          const rx = (c.x1 - c.x0) / 2;
          const ry = (c.y1 - c.y0) / 2;
          const k = 0.5522847498;
          path = [
            `${nums(cx + rx, cy)} m`,
            `${nums(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry)} c`,
            `${nums(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy)} c`,
            `${nums(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry)} c`,
            `${nums(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy)} c`,
            "h",
          ].join(" ");
        }
        const ap = appearance(
          rect,
          [
            "q /GS0 gs",
            stroke ? `${nums(...stroke)} RG ${num(sw)} w` : "",
            fill ? `${nums(...fill)} rg` : "",
            `${path} ${paint} Q`,
          ]
            .filter(Boolean)
            .join("\n"),
          gs(obj.opacity),
        );
        add(page, obj.shape === "rect" ? "Square" : "Circle", rect, ap, {
          C: stroke ?? undefined,
          IC: fill ?? undefined,
          CA: clampOpacity(obj.opacity),
          BS: { W: sw, S: "S" },
        });
        break;
      }
      case "line": {
        const start = toContent(obj.x1, obj.y1);
        const end = toContent(obj.x2, obj.y2);
        const head = obj.arrow
          ? arrowHeadSegments(
              start.x,
              start.y,
              end.x,
              end.y,
              arrowHeadSize(obj.strokeWidth),
            )
          : [];
        const rect = grow(
          boxOf([start, end, ...head.map((s) => s.end)]),
          obj.strokeWidth / 2 + 1,
        );
        const [r, g, b] = rgbOf(obj.stroke);
        const segs = [{ start, end }, ...head]
          .map(
            (s) =>
              `${nums(s.start.x, s.start.y)} m ${nums(s.end.x, s.end.y)} l`,
          )
          .join(" ");
        const ap = appearance(
          rect,
          `q /GS0 gs ${nums(r, g, b)} RG ${num(obj.strokeWidth)} w 1 J 1 j\n${segs}\nS Q`,
          gs(obj.opacity),
        );
        add(page, "Line", rect, ap, {
          C: [r, g, b],
          CA: clampOpacity(obj.opacity),
          BS: { W: obj.strokeWidth, S: "S" },
          L: [start.x, start.y, end.x, end.y],
          ...(obj.arrow ? { LE: ["None", "OpenArrow"] } : {}),
        });
        break;
      }
      case "note": {
        const { font, measure, box } = ctx.note(obj);
        const c = viewerRectToContent(box, frame);
        const border = 0.75;
        const rect = grow([c.x0, c.y0, c.x1, c.y1], border / 2);
        const fill = rgbOf(obj.fill);
        const ink = rgbOf(obj.color);
        const width = obj.width - NOTE_PADDING * 2;
        const layout = layoutText(obj.text, width, obj, measure);
        const theta = (frame.rotation * Math.PI) / 180;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const lines = layout.lines
          .map((line, i) => {
            if (line.text.trim().length === 0) return "";
            const at = toContent(
              obj.x + NOTE_PADDING + lineLeft(line.width, width, obj.align),
              obj.y + NOTE_PADDING + lineBaseline(i, obj),
            );
            return `${nums(cos, sin, -sin, cos, at.x, at.y)} Tm ${font.encodeText(line.text).toString()} Tj`;
          })
          .filter(Boolean)
          .join("\n");
        const resources = context.obj({ Font: { F1: font.ref } });
        const ap = appearance(
          rect,
          [
            "q",
            `${nums(...fill)} rg 0.62 0.52 0.1 RG ${num(border)} w`,
            `${nums(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0)} re B`,
            `BT /F1 ${num(obj.size)} Tf ${nums(...ink)} rg`,
            lines,
            "ET Q",
          ].join("\n"),
          resources,
        );
        add(page, "FreeText", rect, ap, {
          Contents: PDFHexString.fromText(obj.text),
          DA: PDFString.of(
            `/${DA_FONT[obj.font]} ${num(obj.size)} Tf ${nums(...ink)} rg`,
          ),
          C: fill,
          BS: { W: border, S: "S" },
          // Acrobat's key for a FreeText's turn, so a viewer that rewrites
          // the box after an edit keeps the words upright.
          ...(frame.rotation ? { Rotate: frame.rotation } : {}),
        });
        break;
      }
    }
    written += 1;
  }
  return written;
}
