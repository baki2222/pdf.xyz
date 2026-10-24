import type { PDFFont, PDFImage, PDFPage, RGB as PdfLibRGB } from "pdf-lib";
import { arrowHeadSegments, clampOpacity, parseHexColor } from "./annotate";
import { PdfEngineError } from "./engine";
import { viewerFrame } from "./page-frame";
import { drawRasterImage, embedRasterImage, loadPdfLib } from "./pdf-lib";
import { loadPdf, stampProducer } from "./stamp";
import { embedDrawingFont } from "./unicode-font";
import {
  EDITOR_OBJECT_KINDS,
  NOTE_PADDING,
  arrowHeadSize,
  objectBounds,
  type EditorObject,
  type EditorObjectKind,
  type NoteObject,
  type TextBoxObject,
} from "./editor/model";
import {
  rectAnchor,
  viewerToContent,
  type ExportFrame,
} from "./editor/geometry";
import {
  layoutText,
  lineBaseline,
  lineLeft,
  needsUnicodeFace,
  faceFor,
} from "./editor/text";

/**
 * Write the WYSIWYG editor's objects into a PDF, in the browser, with pdf-lib.
 *
 * Every object is stored in its page's VIEWER frame (top-left origin, y down;
 * `editor/model.ts`) and mapped here — y flipped, then `viewToContent`, the
 * mapping every placing tool shares — into the content space pdf-lib draws
 * in, with text, boxes and images turned by the page's `/Rotate` so they read
 * upright. The original page content is untouched: objects are APPENDED to
 * each page's content, nothing is rasterised, and pages, sizes, existing
 * text, form fields and metadata are kept.
 *
 * Order matters twice. Objects are drawn in list order, which is the
 * overlay's z-order, so what sits on top on screen sits on top in the file.
 * And every font is embedded BEFORE anything is drawn, so a script no shipped
 * face can draw is refused with nothing half-written.
 *
 * `editor-export.test.ts` reads the output back through pdf.js (positions
 * ±1 pt on rotated and cropped pages, extractable text, Bengali glyphs).
 */

export interface EditorExportResult {
  bytes: Uint8Array;
  pageCount: number;
  objectCount: number;
  counts: Record<EditorObjectKind, number>;
}

/** One problem with the object list, before anything is drawn. */
export interface EditorExportIssue {
  id: string;
  message: string;
}

const EDGE = 0.5;

/** Page frames as the export reads them — and as the UI should size pages. */
export async function readExportFrames(
  bytes: Uint8Array,
): Promise<ExportFrame[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((page) => viewerFrame(page));
}

/** Is `obj` a text-bearing object with something to draw? */
function hasWords(obj: EditorObject): obj is TextBoxObject | NoteObject {
  return (
    (obj.kind === "text" || obj.kind === "note") && obj.text.trim().length > 0
  );
}

/**
 * Check the list against the page frames: page in range, finite numbers, and
 * at least part of the object on its page (a viewer would show nothing of one
 * that is wholly off it, and the export would still report it as placed).
 */
export function validateEditorObjects(
  objects: readonly EditorObject[],
  frames: readonly Pick<ExportFrame, "width" | "height">[],
  textHeight: (obj: TextBoxObject | NoteObject) => number,
): EditorExportIssue[] {
  const issues: EditorExportIssue[] = [];
  for (const obj of objects) {
    const frame = frames[obj.page];
    if (!Number.isInteger(obj.page) || !frame) {
      issues.push({
        id: obj.id,
        message: `An item is on page ${obj.page + 1}, which this PDF does not have.`,
      });
      continue;
    }
    const b = objectBounds(obj, textHeight);
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) {
      issues.push({ id: obj.id, message: "An item has an invalid position." });
      continue;
    }
    if (
      b.x > frame.width - EDGE ||
      b.y > frame.height - EDGE ||
      b.x + b.width < EDGE ||
      b.y + b.height < EDGE
    ) {
      issues.push({
        id: obj.id,
        message: `An item on page ${obj.page + 1} sits entirely off the page.`,
      });
    }
  }
  return issues;
}

function color(
  rgb: (r: number, g: number, b: number) => PdfLibRGB,
  hex: string,
): PdfLibRGB {
  const parsed = parseHexColor(hex) ?? { r: 0, g: 0, b: 0 };
  return rgb(parsed.r, parsed.g, parsed.b);
}

/**
 * Export `objects` onto `bytes`. Throws a user-facing {@link PdfEngineError}
 * when there is nothing to apply, the file cannot be read, an object is off
 * its page, an image cannot be decoded, or text needs a script no shipped
 * face draws.
 */
export async function exportEditedPdf(
  bytes: Uint8Array,
  objects: readonly EditorObject[],
): Promise<EditorExportResult> {
  const lib = await loadPdfLib();
  const { rgb, degrees, BlendMode, LineCapStyle } = lib;
  const list = objects.filter(
    (obj) => !(obj.kind === "text" || obj.kind === "note") || hasWords(obj),
  );
  if (list.length === 0) {
    throw new PdfEngineError("Add at least one item before applying.");
  }

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const frames: ExportFrame[] = pages.map((page) => viewerFrame(page));

  // Fonts first — every one, before anything is drawn.
  const standard = new Map<string, PDFFont>();
  const fontOf = new Map<string, PDFFont>();
  for (const obj of list) {
    if (!hasWords(obj)) continue;
    const face = faceFor(obj.text, obj);
    if (face === "sans" && needsUnicodeFace(obj.text)) {
      // One call per object, so a Bengali box and a Chinese box on the same
      // page each get their face; the per-document memo in embedDrawingFont
      // embeds each face once.
      fontOf.set(obj.id, await embedDrawingFont(doc, [obj.text], face));
      continue;
    }
    // Western text: the chooser hands back the standard face itself. Memoised
    // here, because the chooser embeds a standard face afresh per call.
    let font = standard.get(face);
    if (!font) {
      font = await embedDrawingFont(doc, [obj.text], face);
      standard.set(face, font);
    }
    fontOf.set(obj.id, font);
  }

  const measureFor = (obj: TextBoxObject | NoteObject) => {
    const font = fontOf.get(obj.id);
    return (text: string, size: number) =>
      font ? font.widthOfTextAtSize(text, size) : 0;
  };
  const textHeight = (obj: TextBoxObject | NoteObject) =>
    layoutText(
      obj.text,
      obj.kind === "note" ? obj.width - NOTE_PADDING * 2 : obj.width,
      obj,
      measureFor(obj),
    ).height;

  const issues = validateEditorObjects(list, frames, textHeight);
  if (issues.length > 0) {
    const rest = issues.length - 1;
    throw new PdfEngineError(
      rest > 0
        ? `${issues[0]!.message} (${rest} more issue${rest === 1 ? "" : "s"}.)`
        : issues[0]!.message,
    );
  }

  const images = new Map<Uint8Array, PDFImage>();
  const embedImage = async (
    data: Uint8Array,
    format: "png" | "jpg",
    page: number,
  ): Promise<PDFImage> => {
    const cached = images.get(data);
    if (cached) return cached;
    try {
      const image = await embedRasterImage(doc, data, format);
      images.set(data, image);
      return image;
    } catch {
      throw new PdfEngineError(
        `An image on page ${page + 1} couldn't be decoded as a ${format === "png" ? "PNG" : "JPG"}.`,
      );
    }
  };

  const counts = Object.fromEntries(
    EDITOR_OBJECT_KINDS.map((kind) => [kind, 0]),
  ) as Record<EditorObjectKind, number>;

  const drawWords = (
    page: PDFPage,
    frame: ExportFrame,
    obj: TextBoxObject | NoteObject,
    inset: number,
  ) => {
    const font = fontOf.get(obj.id)!;
    const width = obj.width - inset * 2;
    const layout = layoutText(obj.text, width, obj, measureFor(obj));
    layout.lines.forEach((line, i) => {
      if (line.text.trim().length === 0) return;
      const at = viewerToContent(
        obj.x + inset + lineLeft(line.width, width, obj.align),
        obj.y + inset + lineBaseline(i, obj),
        frame,
      );
      page.drawText(line.text, {
        x: at.x,
        y: at.y,
        rotate: degrees(frame.rotation),
        size: obj.size,
        font,
        color: color(rgb, obj.color),
      });
    });
  };

  for (const obj of list) {
    const page = pages[obj.page]!;
    const frame = frames[obj.page]!;
    const rotate = degrees(frame.rotation);
    switch (obj.kind) {
      case "text":
        drawWords(page, frame, obj, 0);
        break;
      case "note": {
        const box = objectBounds(obj, textHeight);
        const at = rectAnchor(box, frame);
        page.drawRectangle({
          x: at.x,
          y: at.y,
          width: box.width,
          height: box.height,
          rotate,
          color: color(rgb, obj.fill),
          borderColor: rgb(0.62, 0.52, 0.1),
          borderWidth: 0.75,
        });
        drawWords(page, frame, obj, NOTE_PADDING);
        break;
      }
      case "image":
      case "signature": {
        const image = await embedImage(obj.bytes, obj.format, obj.page);
        const at = rectAnchor(obj, frame);
        await drawRasterImage(page, image, {
          x: at.x,
          y: at.y,
          width: obj.width,
          height: obj.height,
          rotate,
          ...(obj.kind === "image" && obj.opacity < 1
            ? { opacity: clampOpacity(obj.opacity) }
            : {}),
        });
        break;
      }
      case "whiteout": {
        const at = rectAnchor(obj, frame);
        page.drawRectangle({
          x: at.x,
          y: at.y,
          width: obj.width,
          height: obj.height,
          rotate,
          color: rgb(1, 1, 1),
        });
        break;
      }
      case "highlight": {
        const at = rectAnchor(obj, frame);
        page.drawRectangle({
          x: at.x,
          y: at.y,
          width: obj.width,
          height: obj.height,
          rotate,
          color: color(rgb, obj.color),
          opacity: clampOpacity(obj.opacity),
          blendMode: BlendMode.Multiply,
        });
        break;
      }
      case "shape": {
        if (!obj.fill && !obj.stroke) break;
        const opacity = clampOpacity(obj.opacity);
        const paint = {
          ...(obj.fill ? { color: color(rgb, obj.fill), opacity } : {}),
          ...(obj.stroke
            ? {
                borderColor: color(rgb, obj.stroke),
                borderWidth: obj.strokeWidth,
                borderOpacity: opacity,
              }
            : {}),
        };
        if (obj.shape === "rect") {
          const at = rectAnchor(obj, frame);
          page.drawRectangle({
            x: at.x,
            y: at.y,
            width: obj.width,
            height: obj.height,
            rotate,
            ...paint,
          });
        } else {
          const centre = viewerToContent(
            obj.x + obj.width / 2,
            obj.y + obj.height / 2,
            frame,
          );
          const quarter = frame.rotation === 90 || frame.rotation === 270;
          page.drawEllipse({
            x: centre.x,
            y: centre.y,
            xScale: (quarter ? obj.height : obj.width) / 2,
            yScale: (quarter ? obj.width : obj.height) / 2,
            ...paint,
          });
        }
        break;
      }
      case "line": {
        const start = viewerToContent(obj.x1, obj.y1, frame);
        const end = viewerToContent(obj.x2, obj.y2, frame);
        const stroke = {
          thickness: obj.strokeWidth,
          color: color(rgb, obj.stroke),
          opacity: clampOpacity(obj.opacity),
          lineCap: LineCapStyle.Round,
        };
        page.drawLine({ start, end, ...stroke });
        if (obj.arrow) {
          // The mapping is rigid, so a head computed from the mapped ends is
          // the head the overlay drew.
          for (const seg of arrowHeadSegments(
            start.x,
            start.y,
            end.x,
            end.y,
            arrowHeadSize(obj.strokeWidth),
          )) {
            page.drawLine({ start: seg.start, end: seg.end, ...stroke });
          }
        }
        break;
      }
      case "ink": {
        if (obj.points.length === 0) break;
        // An SVG path is y-down from its origin — the viewer frame — so the
        // points go in as stored, anchored at the viewer's top-left corner and
        // turned like text.
        const origin = viewerToContent(0, 0, frame);
        const [first, ...rest] = obj.points;
        const path =
          `M ${first!.x} ${first!.y}` +
          (rest.length === 0
            ? ` L ${first!.x} ${first!.y}`
            : rest.map((p) => ` L ${p.x} ${p.y}`).join(""));
        page.drawSvgPath(path, {
          x: origin.x,
          y: origin.y,
          rotate,
          borderColor: color(rgb, obj.stroke),
          borderWidth: obj.strokeWidth,
          borderOpacity: clampOpacity(obj.opacity),
          borderLineCap: LineCapStyle.Round,
        });
        break;
      }
    }
    counts[obj.kind] += 1;
  }

  stampProducer(doc);
  return {
    bytes: await doc.save(),
    pageCount: pages.length,
    objectCount: list.length,
    counts,
  };
}
