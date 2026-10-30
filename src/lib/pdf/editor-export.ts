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
  markStrokeWidth,
  markStrokes,
  objectBounds,
  rectsIntersect,
  type EditorObject,
  type EditorObjectKind,
  type FieldObject,
  type LinkObject,
  type NoteObject,
  type RedactObject,
  type TextBoxObject,
  type TextEditObject,
} from "./editor/model";
import {
  rectAnchor,
  viewerRectToContent,
  viewerToContent,
  type ExportFrame,
} from "./editor/geometry";
import {
  applyContentEdits,
  pruneUnreachable,
  type ContentEditOptions,
  type RetextOutcome,
} from "./editor/content-edit";
import { browserJpegDecoder } from "./editor/jpeg-pixels";
import { linkUntouched, readFileLinks, writeLinks } from "./editor/links";
import {
  fillFileFields,
  readFileFields,
  writeNewFields,
  type FieldFill,
  type FileField,
} from "./editor/fields";
import { isIdentity, sourcePages, type PageRef } from "./editor/pages";
import {
  isCommentObject,
  writeComments,
  type CommentObject,
  type MarkupMode,
} from "./editor/comments";
import { placeRuns, type PdfjsTextItem, type TextRun } from "./editor/runs";
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
 * Phase 3 adds what is NOT drawn: links are written as `/Link`
 * annotations, form fields as AcroForm fields, the file's own fields are
 * filled, and the page list (reordered, turned, inserted, deleted pages) is
 * replayed on the file FIRST — so every object lands in the frame of the
 * page it was displayed on, and moves with it.
 *
 * "Save markups as comments" (`edits.markups`) writes highlights, drawings,
 * notes, shapes and lines as real PDF annotations instead of drawing them
 * (`editor/comments.ts`); everything else is drawn as before. It is the
 * only way a restricted PDF whose author allows comments is marked up.
 *
 * `editor-export.test.ts` reads the output back through pdf.js (positions
 * ±1 pt on rotated and cropped pages, extractable text, Bengali glyphs);
 * `editor-export-phase3.test.ts` reads links, fields and pages back.
 */

export interface EditorExportResult {
  bytes: Uint8Array;
  pageCount: number;
  objectCount: number;
  counts: Record<EditorObjectKind, number>;
  /** Per edited run: drawn in its own font, or the face substituted. */
  retext: RetextOutcome[];
  /** The file's own form fields filled. */
  filled: number;
  /** Markups written as PDF annotations ("Save markups as comments"). */
  comments: number;
}

/** What changes besides the objects: the page list, deleted links, filled fields. */
export interface DocumentEdits {
  /** The page list as displayed (`editor/pages.ts`); absent = the file's own. */
  pages?: readonly PageRef[];
  /** File links (by `LinkOrigin.ref`) that were deleted. */
  removedLinks?: readonly string[];
  /** Values typed into the file's own fields, by field name. */
  fills?: Readonly<Record<string, FieldFill>>;
  /**
   * How highlights, drawings, notes, shapes and lines are saved: drawn into
   * the page (`"flatten"`, the default) or as PDF annotations another reader
   * can select, edit and delete (`"comments"`). Whiteout, Redact and
   * everything else are page content either way.
   */
  markups?: MarkupMode;
}

/**
 * pdf.js's text items for the given SOURCE pages of `bytes` — what a
 * highlight saved as a comment snaps its quads to. A file whose text cannot
 * be read gives none, and the highlight keeps the box that was drawn.
 */
async function sourceTextItems(
  bytes: Uint8Array,
  sources: ReadonlySet<number>,
): Promise<Map<number, PdfjsTextItem[]>> {
  const out = new Map<number, PdfjsTextItem[]>();
  if (sources.size === 0) return out;
  try {
    const { loadPdfjs, awaitPdfjsDocument } = await import("./pdfjs");
    const { PDFJS_DOCUMENT_DEFAULTS } = await import("./wasm-assets");
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      ...PDFJS_DOCUMENT_DEFAULTS,
    });
    const doc = await awaitPdfjsDocument(task);
    try {
      for (const source of sources) {
        if (source < 0 || source >= doc.numPages) continue;
        const page = await doc.getPage(source + 1);
        try {
          const content = await page.getTextContent();
          out.set(
            source,
            content.items.flatMap((item) =>
              "str" in item
                ? [
                    {
                      str: item.str,
                      transform: item.transform as number[],
                      width: item.width,
                    },
                  ]
                : [],
            ),
          );
        } finally {
          page.cleanup();
        }
      }
    } finally {
      await task.destroy().catch(() => {});
    }
  } catch {
    // Unreadable text: highlights keep their boxes.
  }
  return out;
}

/** Everything the editor reads from the file before it opens. */
export interface EditorDocument {
  frames: ExportFrame[];
  links: LinkObject[];
  fields: FileField[];
}

/** The page frames, links and form fields of a file, for the editor to open on. */
export async function readEditorDocument(
  bytes: Uint8Array,
): Promise<EditorDocument> {
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const frames = doc.getPages().map((page) => viewerFrame(page));
  let links: LinkObject[] = [];
  let fields: FileField[] = [];
  try {
    links = readFileLinks(lib, doc, frames);
  } catch {
    links = [];
  }
  try {
    fields = readFileFields(lib, doc);
  } catch {
    fields = [];
  }
  return { frames, links, fields };
}

/**
 * Replay the page list on the file: turn pages, add blank ones, and put
 * every kept page in its new place; a page left out is deleted. Returns
 * whether any page was deleted (its content is then pruned from the file).
 */
function applyPageList(
  lib: Awaited<ReturnType<typeof loadPdfLib>>,
  doc: Awaited<ReturnType<typeof loadPdf>>,
  list: readonly PageRef[],
): boolean {
  const original = doc.getPages();
  if (isIdentity(list, original.length)) return false;
  const used = new Set<number>();
  const final = list.map((ref) => {
    if (ref.source === null) {
      const size = ref.size ?? { width: 612, height: 792 };
      return doc.addPage([size.width, size.height]);
    }
    const page = original[ref.source];
    if (!page || used.has(ref.source)) {
      throw new PdfEngineError("The page list doesn't match this PDF.");
    }
    used.add(ref.source);
    if (ref.rotate) {
      const own = viewerFrame(page).rotation;
      page.setRotation(lib.degrees((own + ref.rotate) % 360));
    }
    return page;
  });
  if (final.length === 0) {
    throw new PdfEngineError("A PDF needs at least one page.");
  }
  for (let i = doc.getPageCount() - 1; i >= 0; i -= 1) doc.removePage(i);
  final.forEach((page, i) => doc.insertPage(i, page));
  return used.size < original.length;
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

/**
 * Remove every edited run's glyphs and everything under every redaction box
 * from the page content, and draw each run's replacement
 * (`editor/content-edit.ts`). Then drop the objects nothing refers to any
 * more, so the old content stream and replaced images are not still in the
 * saved file.
 */
async function applyTextAndRedactions(
  lib: Awaited<ReturnType<typeof loadPdfLib>>,
  doc: Awaited<ReturnType<typeof loadPdf>>,
  pages: PDFPage[],
  frames: ExportFrame[],
  list: readonly EditorObject[],
  options: ContentEditOptions,
): Promise<RetextOutcome[]> {
  const edits = list.filter((o): o is TextEditObject => o.kind === "textedit");
  const boxes = list.filter((o): o is RedactObject => o.kind === "redact");
  if (edits.length === 0 && boxes.length === 0) return [];
  for (const e of edits) {
    if (boxes.some((b) => b.page === e.page && rectsIntersect(b, e))) {
      throw new PdfEngineError(
        `Text you edited on page ${e.page + 1} sits under a redaction box. Remove the edit or the box first.`,
      );
    }
  }
  const outcomes: RetextOutcome[] = [];
  for (let i = 0; i < pages.length; i++) {
    const retext = edits
      .filter((e) => e.page === i)
      .map((e) => ({
        id: e.id,
        run: { transform: e.run.transform, width: e.run.width },
        text: e.text,
      }));
    const redact = boxes
      .filter((b) => b.page === i)
      .map((b) => ({
        id: b.id,
        box: viewerRectToContent(b, frames[i]!),
        fill: b.fill,
      }));
    if (retext.length === 0 && redact.length === 0) continue;
    const done = await applyContentEdits(
      lib,
      doc,
      pages[i]!,
      i,
      retext,
      redact,
      {
        ...options,
        embedFont: options.embedFont ?? embedDrawingFont,
      },
    );
    outcomes.push(...done.retext);
  }
  pruneUnreachable(lib, doc);
  return outcomes;
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
  options: ContentEditOptions = { decodeJpeg: browserJpegDecoder() },
  edits: DocumentEdits = {},
): Promise<EditorExportResult> {
  const lib = await loadPdfLib();
  const { rgb, degrees, BlendMode, LineCapStyle } = lib;
  const list = objects.filter(
    (obj) =>
      (!(obj.kind === "text" || obj.kind === "note") || hasWords(obj)) &&
      !(obj.kind === "link" && linkUntouched(obj)),
  );
  const removedLinks = edits.removedLinks ?? [];
  const fills = edits.fills ?? {};
  const asComments = edits.markups === "comments";
  const comments: CommentObject[] = asComments
    ? list.filter(isCommentObject)
    : [];

  const doc = await loadPdf(bytes);
  const pageList = edits.pages ?? sourcePages(doc.getPageCount());
  const pagesChanged = !isIdentity(pageList, doc.getPageCount());
  if (
    list.length === 0 &&
    !pagesChanged &&
    removedLinks.length === 0 &&
    Object.keys(fills).length === 0
  ) {
    throw new PdfEngineError("Add at least one item before applying.");
  }
  // Pages first: reordered, turned, inserted and deleted as displayed, so
  // every object below is drawn in the frame of the page it was placed on.
  if (applyPageList(lib, doc, pageList)) pruneUnreachable(lib, doc);
  const pageIds = pageList.map((p) => p.id);
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

  // Edit text and Redact rewrite the page content itself — before anything
  // is drawn on top of it, so what is drawn lands over the rewritten page.
  const retextOutcomes = await applyTextAndRedactions(
    lib,
    doc,
    pages,
    frames,
    list,
    options,
  );

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
    if (asComments && isCommentObject(obj)) {
      // Not drawn: written as an annotation below.
      counts[obj.kind] += 1;
      continue;
    }
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
      case "textedit":
        // Removed and redrawn by applyTextAndRedactions.
        break;
      case "link":
      case "field":
        // Not drawn: written as annotations and fields below.
        break;
      case "mark": {
        // Viewer-frame strokes as an SVG path (y down), anchored and turned
        // like ink.
        const origin = viewerToContent(0, 0, frame);
        const path = markStrokes(obj)
          .map((stroke) =>
            stroke
              .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
              .join(" "),
          )
          .join(" ");
        page.drawSvgPath(path, {
          x: origin.x,
          y: origin.y,
          rotate,
          borderColor: color(rgb, obj.color),
          borderWidth: markStrokeWidth(obj),
          borderLineCap: LineCapStyle.Round,
        });
        break;
      }
      case "redact": {
        const at = rectAnchor(obj, frame);
        page.drawRectangle({
          x: at.x,
          y: at.y,
          width: obj.width,
          height: obj.height,
          rotate,
          color: obj.fill === "white" ? rgb(1, 1, 1) : rgb(0, 0, 0),
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

  // Markups as comments: annotations with their own appearances, in list
  // order. Highlights snap to the text under them, read from the file as it
  // was opened (a page keeps its content when it is moved or turned).
  let commentCount = 0;
  if (comments.length > 0) {
    const highlighted = new Set<number>();
    for (const o of comments) {
      const source = pageList[o.page]?.source;
      if (o.kind === "highlight" && typeof source === "number")
        highlighted.add(source);
    }
    const items = await sourceTextItems(bytes, highlighted);
    const runs: Record<number, TextRun[]> = {};
    pageList.forEach((ref, i) => {
      const read = ref.source === null ? undefined : items.get(ref.source);
      if (read) runs[i] = placeRuns(i, read, frames[i]!);
    });
    commentCount = writeComments(
      {
        lib,
        doc,
        pages,
        frames,
        runs,
        note: (obj) => ({
          font: fontOf.get(obj.id)!,
          measure: measureFor(obj),
          box: objectBounds(obj, textHeight),
        }),
      },
      comments,
    );
  }

  // Links: real annotations with a target, not drawn.
  writeLinks(
    lib,
    doc,
    frames,
    list.filter((o): o is LinkObject => o.kind === "link"),
    removedLinks,
    pageIds,
  );

  // Form fields: the file's own filled, the new ones created — both with
  // their appearances drawn here, in Helvetica (the AcroForm alphabet).
  const newFields = list.filter((o): o is FieldObject => o.kind === "field");
  let filled = 0;
  if (newFields.length > 0 || Object.keys(fills).length > 0) {
    // Through the one chooser: field text is WinAnsi (checked in
    // `editor/fields.ts`), so this is the standard sans face.
    const helvetica = await embedDrawingFont(doc, [""], "sans");
    filled = fillFileFields(lib, doc, fills, helvetica);
    writeNewFields(lib, doc, pages, frames, newFields, helvetica);
  }

  stampProducer(doc);
  return {
    // `updateFieldAppearances: false`: every field written or filled above
    // has drawn its own appearance; pdf-lib's default would also redraw the
    // file's OTHER fields that lack one (`editor/fields.ts`).
    bytes: await doc.save({ updateFieldAppearances: false }),
    pageCount: pages.length,
    objectCount: list.length,
    counts,
    retext: retextOutcomes,
    filled,
    comments: commentCount,
  };
}
