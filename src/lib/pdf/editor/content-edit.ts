import type {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFStream,
} from "pdf-lib";
import { PdfEngineError } from "../engine";
import type { PdfLibModule } from "../pdf-lib";
import { embedDrawingFont } from "../unicode-font";
import {
  asciiBytes,
  hexString,
  num,
  spliceOps,
  type OpReplacement,
} from "./content-stream";
import {
  allGlyphs,
  analyzePage,
  apply,
  boxOf,
  boxesOverlap,
  glyphsInRun,
  invert,
  isVisibleShow,
  type Box,
  type FormUse,
  type GlyphRef,
  type ImageUse,
  type Mat,
  type RunGeometry,
  type ShownGlyph,
  type StreamAnalysis,
  type TextShow,
} from "./page-content";
import { streamBytes, substituteFor, type FontInfo, type SubstituteStyle } from "./pdf-fonts";
import { needsUnicodeFace, standardFontKey } from "./text";

/**
 * Edit text and Redact, for real: the original glyphs are REMOVED from the
 * page's content stream, not covered.
 *
 * Each text-showing operator that painted a removed glyph is rewritten as a
 * `TJ` that keeps its other glyphs and replaces each removed span with the
 * number that advances the text position by exactly the span's width — so
 * the glyphs after it, in the same operator and in later ones on the line,
 * land where they always did. Every operator that painted nothing removed is
 * copied as the bytes it was (`spliceOps`).
 *
 * Redact also rewrites the pixels of every image under a box (a copy of the
 * image, so a picture used elsewhere is untouched there), removes the
 * annotations under it, and follows Form XObjects one level deep. What it
 * cannot do safely it REFUSES with a message, because a redaction that
 * silently leaves the text in the file is the defect this exists to prevent.
 */

export type RedactFill = "black" | "white";

export interface RetextRequest {
  id: string;
  run: RunGeometry;
  /** The replacement: drawn where the run began. Empty removes the run. */
  text: string;
}

export interface RedactRequest {
  id: string;
  /** User-space box. */
  box: Box;
  fill: RedactFill;
}

/** Decode a JPEG to RGBA pixels (the browser's codec; injected in tests). */
export type JpegDecoder = (
  bytes: Uint8Array,
) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;

export interface ContentEditOptions {
  decodeJpeg?: JpegDecoder | null;
}

/** What the replacement for one run was drawn with. */
export interface RetextOutcome {
  id: string;
  /** "own": the run's own font object; otherwise the face substituted. */
  font: "own" | string;
  removedGlyphs: number;
}

export interface PageEditOutcome {
  retext: RetextOutcome[];
  removedGlyphs: number;
  imagesRedacted: number;
  annotationsRemoved: number;
}

/* ------------------------------ fonts ------------------------------ */

/** Everything the editor needs to show and later write one run. */
export interface RunDescription {
  glyphCount: number;
  visible: boolean;
  font: FontInfo | null;
  /** The font's name, for the "font substituted" note. */
  fontName: string;
  /** Characters the run's own font can write back (its glyphs are known to exist). */
  ownChars: string;
  substitute: SubstituteStyle;
  /** `#rrggbb`, or null when the colour is not a device colour. */
  color: string | null;
  /** In a Form XObject rather than the page's own stream. */
  inForm: boolean;
  /** A reason this run cannot be edited, or null. */
  refusal: string | null;
}

/** Codes known to have a glyph in each font: every one drawn on the page. */
function observedCodes(page: StreamAnalysis): Map<FontInfo, Set<number>> {
  const seen = new Map<FontInfo, Set<number>>();
  for (const g of allGlyphs(page)) {
    const font = g.show.font;
    if (!font) continue;
    let set = seen.get(font);
    if (!set) seen.set(font, (set = new Set()));
    set.add(g.show.glyphs[g.index]!.code);
  }
  return seen;
}

/** Characters `font` can write: any it encodes (full font), or those drawn (subset). */
function writableChars(
  font: FontInfo,
  observed: Set<number> | undefined,
): string {
  const chars = new Set<string>();
  const codes = observed ?? new Set<number>();
  for (const code of codes) {
    const u = font.unicode(code);
    if (u && [...u].length === 1 && font.encodeChar(u) === code) chars.add(u);
  }
  if (!font.subset && !font.type3) {
    // A complete (or viewer-supplied) font draws every code its encoding
    // maps; probe the printable Latin range through the same table.
    for (let cp = 0x20; cp <= 0x24f; cp++) {
      const ch = String.fromCodePoint(cp);
      if (font.encodeChar(ch) !== undefined) chars.add(ch);
    }
  }
  return [...chars].join("");
}

function fontLabel(font: FontInfo | null): string {
  return font?.baseFont.replace(/[,_-]+/g, " ").trim() || "an unnamed font";
}

/** Describe the run at `run` on an analysed page. */
export function describeRun(
  page: StreamAnalysis,
  run: RunGeometry,
  observed: Map<FontInfo, Set<number>> = observedCodes(page),
): RunDescription {
  const glyphs = glyphsInRun(page, run).filter((g) => isVisibleShow(g.show));
  const first = glyphs[0];
  const font = first?.show.font ?? null;
  const inForm = glyphs.some((g) => g.form !== null);
  let refusal: string | null = null;
  if (glyphs.length === 0) {
    refusal =
      "This text is inside an embedded object this editor can't rewrite, so it can't be edited here.";
  } else if (glyphs.some((g) => g.show.font?.vertical)) {
    refusal = "Vertical text can't be edited here yet.";
  }
  return {
    glyphCount: glyphs.length,
    visible: glyphs.length > 0,
    font,
    fontName: fontLabel(font),
    ownChars:
      font && font.ref && !font.vertical
        ? writableChars(font, observed.get(font))
        : "",
    substitute: substituteFor(font),
    color: first ? first.show.fill.hex : null,
    inForm,
    refusal,
  };
}

/** Does the run's own font have every character of `text`? */
export function ownFontCovers(ownChars: string, text: string): boolean {
  if (ownChars.length === 0) return false;
  const have = new Set([...ownChars]);
  return [...text].every((ch) => have.has(ch));
}

/** The face a substituted run is drawn in, by name (for the note). */
export function substituteLabel(style: SubstituteStyle, text: string): string {
  if (needsUnicodeFace(text)) return "Noto Sans";
  const base =
    style.font === "times" ? "Times" : style.font === "courier" ? "Courier" : "Helvetica";
  const variant = [style.bold ? "Bold" : "", style.italic ? "Italic" : ""]
    .filter(Boolean)
    .join(" ");
  return variant ? `${base} ${variant}` : base;
}

/* ------------------------------ rewriting ------------------------------ */

/** A show rewritten as a TJ without the removed glyphs. */
function rewriteShow(show: TextShow, removed: Set<number>, source: string): string {
  const parts: string[] = [];
  const scale = show.fs * show.th;
  let pending = 0;
  const flushNum = () => {
    if (pending !== 0) parts.push(num(pending));
    pending = 0;
  };
  for (const item of show.items) {
    if (item.kind === "num") {
      pending += item.value;
      continue;
    }
    let kept: number[] = [];
    const flushKept = () => {
      if (kept.length) {
        flushNum();
        parts.push(hexString(kept));
      }
      kept = [];
    };
    for (let i = item.from; i < item.to; i++) {
      const g = show.glyphs[i]!;
      if (removed.has(i)) {
        flushKept();
        pending += scale === 0 ? 0 : (-g.tx * 1000) / scale;
      } else kept.push(...g.bytes);
    }
    flushKept();
  }
  flushNum();
  const array = `[${parts.join(" ")}] TJ`;
  if (show.op === "'") return `T* ${array}`;
  if (show.op === '"' && show.quoteArgs) {
    return `${num(show.quoteArgs[0])} Tw ${num(show.quoteArgs[1])} Tc T* ${array}`;
  }
  void source;
  return array;
}

interface StreamEdit {
  removed: Map<TextShow, Set<number>>;
  /** Do operators to point at a new XObject name. */
  renames: Map<number, string>;
}

const emptyEdit = (): StreamEdit => ({ removed: new Map(), renames: new Map() });

function markRemoved(edits: Map<StreamAnalysis, StreamEdit>, g: GlyphRef) {
  let e = edits.get(g.stream);
  if (!e) edits.set(g.stream, (e = emptyEdit()));
  let set = e.removed.get(g.show);
  if (!set) e.removed.set(g.show, (set = new Set()));
  set.add(g.index);
}

function rewriteBytes(stream: StreamAnalysis, edit: StreamEdit): Uint8Array {
  const replacements: OpReplacement[] = [];
  for (const [show, removed] of edit.removed) {
    if (removed.size === 0) continue;
    const op = stream.ops[show.opIndex]!;
    const src = String.fromCharCode(...stream.bytes.subarray(op.start, op.end));
    replacements.push({
      index: show.opIndex,
      bytes: asciiBytes(rewriteShow(show, removed, src)),
    });
  }
  for (const [opIndex, name] of edit.renames) {
    replacements.push({ index: opIndex, bytes: asciiBytes(`${name} Do`) });
  }
  return spliceOps(stream.bytes, stream.ops, replacements);
}

/* ------------------------------ images ------------------------------ */

interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function imagePixelRects(ctm: Mat, width: number, height: number, boxes: Box[]): PixelRect[] {
  const inv = invert(ctm);
  if (!inv) return [];
  const out: PixelRect[] = [];
  for (const box of boxes) {
    const corners = [
      apply(inv, box.x0, box.y0),
      apply(inv, box.x1, box.y0),
      apply(inv, box.x0, box.y1),
      apply(inv, box.x1, box.y1),
    ].map((p) => ({ x: p.x * width, y: (1 - p.y) * height }));
    const b = boxOf(corners);
    const r = {
      x0: Math.max(0, Math.floor(b.x0)),
      y0: Math.max(0, Math.floor(b.y0)),
      x1: Math.min(width, Math.ceil(b.x1)),
      y1: Math.min(height, Math.ceil(b.y1)),
    };
    if (r.x1 > r.x0 && r.y1 > r.y0) out.push(r);
  }
  return out;
}

function imageBox(ctm: Mat): Box {
  return boxOf([apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)]);
}

const RAW_FILTERS = new Set([
  "FlateDecode",
  "Fl",
  "LZWDecode",
  "LZW",
  "ASCIIHexDecode",
  "AHx",
  "ASCII85Decode",
  "A85",
  "RunLengthDecode",
  "RL",
]);

function unpredictPng(data: Uint8Array, rowBytes: number, bpp: number): Uint8Array {
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let y = 0; y < rows; y++) {
    const type = data[y * (rowBytes + 1)]!;
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = data[src + x]!;
      const left = x >= bpp ? out[dst + x - bpp]! : 0;
      const up = y > 0 ? out[dst - rowBytes + x]! : 0;
      const ul = y > 0 && x >= bpp ? out[dst - rowBytes + x - bpp]! : 0;
      let v = raw;
      if (type === 1) v = raw + left;
      else if (type === 2) v = raw + up;
      else if (type === 3) v = raw + ((left + up) >> 1);
      else if (type === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul);
      }
      out[dst + x] = v & 0xff;
    }
  }
  return out;
}

function setSample(
  data: Uint8Array,
  rowStart: number,
  bitOffset: number,
  bpc: number,
  value: number,
) {
  if (bpc === 8) {
    data[rowStart + bitOffset / 8] = value;
    return;
  }
  if (bpc === 16) {
    const i = rowStart + bitOffset / 8;
    data[i] = value >> 8;
    data[i + 1] = value & 0xff;
    return;
  }
  for (let b = 0; b < bpc; b++) {
    const bit = bitOffset + b;
    const byte = rowStart + (bit >> 3);
    const mask = 0x80 >> (bit & 7);
    const on = (value >> (bpc - 1 - b)) & 1;
    data[byte] = on ? data[byte]! | mask : data[byte]! & ~mask;
  }
}

interface ImageLayout {
  width: number;
  height: number;
  comps: number;
  bpc: number;
  mask: boolean;
  space: string;
}

function componentsOf(
  lib: PdfLibModule,
  doc: PDFDocument,
  cs: PDFObject | undefined,
): { comps: number; space: string } | null {
  const { PDFName, PDFArray, PDFStream, PDFNumber } = lib;
  const o = doc.context.lookup(cs);
  if (o instanceof PDFName) {
    const n = o.decodeText();
    if (n === "DeviceGray" || n === "CalGray" || n === "G") return { comps: 1, space: "gray" };
    if (n === "DeviceRGB" || n === "CalRGB" || n === "RGB") return { comps: 3, space: "rgb" };
    if (n === "DeviceCMYK" || n === "CMYK") return { comps: 4, space: "cmyk" };
    return null;
  }
  if (o instanceof PDFArray) {
    const kind = doc.context.lookup(o.get(0));
    const k = kind instanceof PDFName ? kind.decodeText() : "";
    if (k === "ICCBased") {
      const s = doc.context.lookup(o.get(1));
      const n = s instanceof PDFStream ? doc.context.lookup(s.dict.get(PDFName.of("N"))) : undefined;
      const comps = n instanceof PDFNumber ? n.asNumber() : 0;
      if (comps === 1) return { comps, space: "gray" };
      if (comps === 3) return { comps, space: "rgb" };
      if (comps === 4) return { comps, space: "cmyk" };
      return null;
    }
    if (k === "CalGray") return { comps: 1, space: "gray" };
    if (k === "CalRGB" || k === "Lab") return { comps: 3, space: k === "Lab" ? "lab" : "rgb" };
    if (k === "Indexed" || k === "I") return { comps: 1, space: "indexed" };
    if (k === "Separation") return { comps: 1, space: "ink" };
    if (k === "DeviceN") {
      const names = doc.context.lookup(o.get(1));
      return names instanceof PDFArray ? { comps: names.size(), space: "ink" } : null;
    }
  }
  return null;
}

function fillValues(layout: ImageLayout, fill: RedactFill): number[] {
  const max = (1 << layout.bpc) - 1;
  if (layout.mask) return [max]; // a stencil sample of 1 paints nothing
  const black = fill === "black";
  switch (layout.space) {
    case "gray":
    case "rgb":
      return new Array(layout.comps).fill(black ? 0 : max);
    case "cmyk":
      return black ? [0, 0, 0, max] : [0, 0, 0, 0];
    case "ink":
      return new Array(layout.comps).fill(black ? max : 0);
    default:
      return new Array(layout.comps).fill(0);
  }
}

function filterNames(lib: PdfLibModule, doc: PDFDocument, stream: PDFStream): string[] {
  const { PDFName, PDFArray } = lib;
  const f = doc.context.lookup(stream.dict.get(PDFName.of("Filter")));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray)
    return f.asArray().map((x) => {
      const v = doc.context.lookup(x);
      return v instanceof PDFName ? v.decodeText() : "?";
    });
  return [];
}

const UNEDITABLE =
  "An image under a redaction box is stored in a format this editor can't rewrite";

/**
 * A redacted COPY of an image stream: the covered pixels filled, the rest
 * kept. Returns the copy's ref.
 */
async function redactImageStream(
  lib: PdfLibModule,
  doc: PDFDocument,
  stream: PDFStream,
  rectsFor: (w: number, h: number) => PixelRect[],
  fill: RedactFill,
  page: number,
  options: ContentEditOptions,
  isSoftMask = false,
): Promise<PDFRef> {
  const { PDFName, PDFNumber, PDFBool, PDFStream, PDFDict } = lib;
  const ctx = doc.context;
  const dict = stream.dict;
  const get = (k: string) => ctx.lookup(dict.get(PDFName.of(k)));
  const numOf = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : 0);
  const width = numOf(get("Width"));
  const height = numOf(get("Height"));
  const filters = filterNames(lib, doc, stream);
  const imageMask = get("ImageMask");
  const mask = imageMask instanceof PDFBool && imageMask.asBoolean();
  let pixels: Uint8Array;
  let layout: ImageLayout;
  const extra: Record<string, PDFObject> = {};
  const dropped = new Set(["Filter", "DecodeParms", "Length", "DL", "SMask"]);

  if (filters.every((f) => RAW_FILTERS.has(f))) {
    const cs = mask ? { comps: 1, space: "gray" } : componentsOf(lib, doc, get("ColorSpace"));
    const bpc = mask ? 1 : numOf(get("BitsPerComponent"));
    if (!cs || ![1, 2, 4, 8, 16].includes(bpc) || !(width > 0) || !(height > 0)) {
      throw new PdfEngineError(`${UNEDITABLE} (page ${page + 1}).`);
    }
    layout = { width, height, comps: cs.comps, bpc, mask, space: cs.space };
    let data =
      filters.length === 0
        ? (stream as unknown as { getContents(): Uint8Array }).getContents()
        : streamBytes(lib, stream);
    const parms = ctx.lookup(dict.get(PDFName.of("DecodeParms")));
    const pred = parms instanceof PDFDict ? numOf(ctx.lookup(parms.get(PDFName.of("Predictor")))) : 0;
    const rowBytes = Math.ceil((width * cs.comps * bpc) / 8);
    if (pred >= 10) {
      data = unpredictPng(data, rowBytes, Math.max(1, Math.ceil((cs.comps * bpc) / 8)));
    } else if (pred > 1) {
      throw new PdfEngineError(`${UNEDITABLE} (page ${page + 1}).`);
    }
    if (data.length < rowBytes * height) {
      throw new PdfEngineError(`${UNEDITABLE} (page ${page + 1}).`);
    }
    pixels = new Uint8Array(data.subarray(0, rowBytes * height));
    const values = isSoftMask ? [(1 << bpc) - 1] : fillValues(layout, fill);
    for (const r of rectsFor(width, height)) {
      for (let y = r.y0; y < r.y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          for (let c = 0; c < cs.comps; c++) {
            setSample(pixels, y * rowBytes, (x * cs.comps + c) * bpc, bpc, values[c] ?? 0);
          }
        }
      }
    }
  } else if (
    filters.length >= 1 &&
    filters[filters.length - 1] === "DCTDecode" &&
    filters.slice(0, -1).every((f) => RAW_FILTERS.has(f))
  ) {
    const decode = options.decodeJpeg;
    if (!decode) throw new PdfEngineError(`${UNEDITABLE} (page ${page + 1}).`);
    let jpeg: Uint8Array;
    if (filters.length === 1) {
      jpeg = (stream as unknown as { getContents(): Uint8Array }).getContents();
    } else {
      // Undo the outer filters only: pdf-lib's decoder stops at DCT.
      throw new PdfEngineError(`${UNEDITABLE} (page ${page + 1}).`);
    }
    const img = await decode(jpeg);
    layout = { width: img.width, height: img.height, comps: 3, bpc: 8, mask: false, space: "rgb" };
    pixels = new Uint8Array(img.width * img.height * 3);
    for (let i = 0, j = 0; i < img.width * img.height; i++) {
      pixels[j++] = img.data[i * 4]!;
      pixels[j++] = img.data[i * 4 + 1]!;
      pixels[j++] = img.data[i * 4 + 2]!;
    }
    const v = fill === "black" ? 0 : 255;
    for (const r of rectsFor(img.width, img.height)) {
      for (let y = r.y0; y < r.y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const o = (y * img.width + x) * 3;
          pixels[o] = v;
          pixels[o + 1] = v;
          pixels[o + 2] = v;
        }
      }
    }
    extra.ColorSpace = PDFName.of("DeviceRGB");
    extra.BitsPerComponent = PDFNumber.of(8);
    extra.Width = PDFNumber.of(img.width);
    extra.Height = PDFNumber.of(img.height);
    dropped.add("Decode");
  } else {
    throw new PdfEngineError(`${UNEDITABLE} (page ${page + 1}).`);
  }

  const copy = ctx.flateStream(pixels);
  for (const [key, value] of dict.entries()) {
    if (dropped.has(key.decodeText())) continue;
    copy.dict.set(key, value);
  }
  for (const [k, v] of Object.entries(extra)) copy.dict.set(PDFName.of(k), v);
  const smask = get("SMask");
  if (smask instanceof PDFStream) {
    const smRef = await redactImageStream(lib, doc, smask, rectsFor, fill, page, options, true);
    copy.dict.set(PDFName.of("SMask"), smRef);
  }
  void layout;
  return ctx.register(copy);
}

/* ------------------------------ resources ------------------------------ */

/** A shallow copy of a resources dict with its own XObject (and Font) subdict. */
function ownResources(
  lib: PdfLibModule,
  doc: PDFDocument,
  res: PDFDict | undefined,
): PDFDict {
  const { PDFDict, PDFName } = lib;
  const ctx = doc.context;
  const copy = res ? (res.clone(ctx) as PDFDict) : ctx.obj({});
  for (const key of ["XObject", "Font"]) {
    const sub = ctx.lookup(copy.get(PDFName.of(key)));
    copy.set(PDFName.of(key), sub instanceof PDFDict ? sub.clone(ctx) : ctx.obj({}));
  }
  return copy;
}

function uniqueXObjectName(lib: PdfLibModule, doc: PDFDocument, res: PDFDict, tag: string): PDFName {
  const { PDFDict, PDFName } = lib;
  const xo = doc.context.lookup(res.get(PDFName.of("XObject")));
  const dict = xo instanceof PDFDict ? xo : undefined;
  for (let i = 1; ; i++) {
    const name = PDFName.of(`${tag}${i}`);
    if (!dict || !dict.has(name)) return name;
  }
}

/* ------------------------------ the page ------------------------------ */

/**
 * Apply every Edit-text removal and every redaction on one page: rewrite the
 * page's content (and any Form XObject touched), then draw each run's
 * replacement. Throws a {@link PdfEngineError} — with nothing written to
 * this page — for anything it cannot do safely.
 */
export async function applyContentEdits(
  lib: PdfLibModule,
  doc: PDFDocument,
  page: PDFPage,
  pageIndex: number,
  retext: readonly RetextRequest[],
  redact: readonly RedactRequest[],
  options: ContentEditOptions = {},
): Promise<PageEditOutcome> {
  const { PDFName, PDFArray, PDFDict, PDFStream, PDFNumber, PDFRef } = lib;
  const ctx = doc.context;
  const analysis = analyzePage(lib, page);
  const observed = observedCodes(analysis);
  const edits = new Map<StreamAnalysis, StreamEdit>();
  const where = `page ${pageIndex + 1}`;
  let removedGlyphs = 0;

  // 1. Edit text: the glyphs each run painted.
  const anchors = new Map<string, { g: GlyphRef; glyph: ShownGlyph; desc: RunDescription }>();
  for (const r of retext) {
    const desc = describeRun(analysis, r.run, observed);
    if (desc.refusal) throw new PdfEngineError(`Text on ${where}: ${desc.refusal}`);
    const glyphs = glyphsInRun(analysis, r.run).filter((g) => isVisibleShow(g.show));
    for (const g of glyphs) markRemoved(edits, g);
    removedGlyphs += glyphs.length;
    const first = glyphs[0]!;
    anchors.set(r.id, { g: first, glyph: first.show.glyphs[first.index]!, desc });
  }

  // 2. Redact: glyphs, images and annotations under each box.
  const boxes = redact.map((r) => r.box);
  const fillOf = redact[0]?.fill ?? "black";
  if (boxes.length > 0) {
    for (const g of allGlyphs(analysis)) {
      const glyph = g.show.glyphs[g.index]!;
      if (!boxes.some((b) => boxesOverlap(b, glyph.box))) continue;
      if (g.show.font?.vertical) {
        throw new PdfEngineError(`Vertical text under a redaction box on ${where} can't be removed yet.`);
      }
      markRemoved(edits, g);
      removedGlyphs++;
    }
    const streams: StreamAnalysis[] = [analysis, ...analysis.forms.flatMap((f) => (f.analysis ? [f.analysis] : []))];
    for (const s of streams) {
      for (const inline of s.inlineImages) {
        if (boxes.some((b) => boxesOverlap(b, imageBox(inline.ctm)))) {
          throw new PdfEngineError(
            `An inline image under a redaction box on ${where} can't be rewritten. Use Redact PDF, which flattens the page.`,
          );
        }
      }
      for (const f of s.forms) {
        if (f.analysis) continue;
        // Nested past the depth limit: refuse when it may be under a box.
        const x = ctx.lookup(f.ref ?? undefined);
        const bbox =
          x instanceof PDFStream ? ctx.lookup(x.dict.get(PDFName.of("BBox"))) : undefined;
        let extent: Box | null = null;
        if (bbox instanceof PDFArray && bbox.size() === 4) {
          const v = bbox.asArray().map((n) => {
            const r = ctx.lookup(n);
            return r instanceof PDFNumber ? r.asNumber() : 0;
          });
          extent = boxOf([
            apply(f.ctm, v[0]!, v[1]!),
            apply(f.ctm, v[2]!, v[1]!),
            apply(f.ctm, v[0]!, v[3]!),
            apply(f.ctm, v[2]!, v[3]!),
          ]);
        }
        if (!extent || boxes.some((b) => boxesOverlap(b, extent!))) {
          throw new PdfEngineError(
            `Content nested inside an embedded object on ${where} can't be redacted here. Use Redact PDF, which flattens the page.`,
          );
        }
      }
    }
  }

  // Images to redact: per stream, per Do.
  const imageJobs: { stream: StreamAnalysis; use: ImageUse; boxes: Box[] }[] = [];
  if (boxes.length > 0) {
    const streams: StreamAnalysis[] = [analysis, ...analysis.forms.flatMap((f) => (f.analysis ? [f.analysis] : []))];
    for (const s of streams) {
      for (const use of s.images) {
        const under = boxes.filter((b) => boxesOverlap(b, imageBox(use.ctm)));
        if (under.length) imageJobs.push({ stream: s, use, boxes: under });
      }
    }
  }

  // Annotations under a redaction box: removed; a form field refuses.
  const annotsRaw = page.node.get(PDFName.of("Annots"));
  const annots = ctx.lookup(annotsRaw);
  const doomedAnnots = new Set<PDFObject>();
  if (boxes.length > 0 && annots instanceof PDFArray) {
    for (const item of annots.asArray()) {
      const a = ctx.lookup(item);
      if (!(a instanceof PDFDict)) continue;
      const rect = ctx.lookup(a.get(PDFName.of("Rect")));
      if (!(rect instanceof PDFArray) || rect.size() < 4) continue;
      const v = rect.asArray().map((x) => {
        const n = ctx.lookup(x);
        return n instanceof PDFNumber ? n.asNumber() : 0;
      });
      const box = { x0: Math.min(v[0]!, v[2]!), y0: Math.min(v[1]!, v[3]!), x1: Math.max(v[0]!, v[2]!), y1: Math.max(v[1]!, v[3]!) };
      if (!boxes.some((b) => boxesOverlap(b, box))) continue;
      const sub = ctx.lookup(a.get(PDFName.of("Subtype")));
      if (sub instanceof PDFName && sub.decodeText() === "Widget") {
        throw new PdfEngineError(
          `A form field sits under a redaction box on ${where}. Flatten the form first (Flatten PDF), then redact.`,
        );
      }
      doomedAnnots.add(item);
    }
  }

  // 3. Write: images first (they add names), then streams.
  const pageEdit = edits.get(analysis) ?? emptyEdit();
  edits.set(analysis, pageEdit);
  let pageRes: PDFDict | undefined;
  const formRes = new Map<StreamAnalysis, PDFDict>();
  const resFor = (s: StreamAnalysis): PDFDict => {
    if (s === analysis) return (pageRes ??= ownResources(lib, doc, analysis.resources));
    let r = formRes.get(s);
    if (!r) formRes.set(s, (r = ownResources(lib, doc, s.resources)));
    return r;
  };
  for (const job of imageJobs) {
    const src = ctx.lookup(job.use.ref ?? undefined);
    const stream = src instanceof PDFStream ? src : undefined;
    if (!stream) continue;
    const copyRef = await redactImageStream(
      lib,
      doc,
      stream,
      (w, h) => imagePixelRects(job.use.ctm, w, h, job.boxes),
      fillOf,
      pageIndex,
      options,
    );
    const res = resFor(job.stream);
    const name = uniqueXObjectName(lib, doc, res, "Redacted");
    (ctx.lookup(res.get(PDFName.of("XObject"))) as PDFDict).set(name, copyRef);
    let e = edits.get(job.stream);
    if (!e) edits.set(job.stream, (e = emptyEdit()));
    e.renames.set(job.use.opIndex, name.toString());
  }

  // A renamed image's old name, if no other Do in that stream still paints
  // it, leaves the stream's (copied) resources — so the original pixels are
  // unreferenced and pruned, unless another page or form still uses them.
  const dropStaleNames = (s: StreamAnalysis, renamed: Map<number, string>) => {
    const res = s === analysis ? pageRes : formRes.get(s);
    if (!res || renamed.size === 0) return;
    const xo = ctx.lookup(res.get(PDFName.of("XObject")));
    if (!(xo instanceof PDFDict)) return;
    const used = new Set<string>();
    const old = new Set<string>();
    for (const use of [...s.images, ...s.forms]) {
      if (renamed.has(use.opIndex)) old.add(use.name);
      else used.add(use.name);
    }
    for (const name of old) if (!used.has(name)) xo.delete(PDFName.of(name));
  };
  for (const [s, e] of edits) dropStaleNames(s, e.renames);

  // Forms whose content changed: a rewritten copy, renamed at its Do.
  for (const form of analysis.forms as FormUse[]) {
    const s = form.analysis;
    if (!s) continue;
    const e = edits.get(s);
    if (!e || (e.removed.size === 0 && e.renames.size === 0)) continue;
    const src = ctx.lookup(form.ref ?? undefined);
    if (!(src instanceof PDFStream)) continue;
    const copy = ctx.flateStream(rewriteBytes(s, e));
    for (const [key, value] of src.dict.entries()) {
      const k = key.decodeText();
      if (k === "Filter" || k === "DecodeParms" || k === "Length") continue;
      copy.dict.set(key, value);
    }
    const ownRes = formRes.get(s);
    if (ownRes) copy.dict.set(PDFName.of("Resources"), ownRes);
    const copyRef = ctx.register(copy);
    const res = resFor(analysis);
    const name = uniqueXObjectName(lib, doc, res, "Edited");
    (ctx.lookup(res.get(PDFName.of("XObject"))) as PDFDict).set(name, copyRef);
    pageEdit.renames.set(form.opIndex, name.toString());
  }

  dropStaleNames(analysis, pageEdit.renames);

  const pageChanged = pageEdit.removed.size > 0 || pageEdit.renames.size > 0;
  if (pageChanged) {
    // Wrapped in q … Q so whatever state the original leaves open cannot
    // reach the replacements and objects drawn after it.
    const body = rewriteBytes(analysis, pageEdit);
    const bytes = new Uint8Array(body.length + 4);
    bytes.set(asciiBytes("q\n"), 0);
    bytes.set(body, 2);
    bytes.set(asciiBytes("\nQ"), body.length + 2);
    const ref = ctx.register(ctx.flateStream(bytes));
    page.node.set(PDFName.of("Contents"), ctx.obj([ref]));
  }
  if (pageRes) page.node.set(PDFName.of("Resources"), pageRes);
  if (doomedAnnots.size > 0 && annots instanceof PDFArray) {
    const keep = annots.asArray().filter((a) => {
      if (doomedAnnots.has(a)) return false;
      const d = ctx.lookup(a);
      const parent = d instanceof PDFDict ? d.get(PDFName.of("Parent")) : undefined;
      return !(parent instanceof PDFRef && [...doomedAnnots].some((x) => x === parent));
    });
    page.node.set(PDFName.of("Annots"), ctx.obj(keep));
  }

  // 4. Replacements, drawn where each run began, in its own font if it can.
  const outcomes: RetextOutcome[] = [];
  const lines: string[] = [];
  for (const r of retext) {
    const anchor = anchors.get(r.id)!;
    const text = r.text.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f]/g, "");
    if (text.trim().length === 0) {
      outcomes.push({ id: r.id, font: "own", removedGlyphs: anchor.desc.glyphCount });
      continue;
    }
    const show = anchor.g.show;
    let key: PDFName;
    let hex: string;
    let used: string;
    const font = show.font;
    if (font && font.ref && ownFontCovers(anchor.desc.ownChars, text)) {
      key = page.node.newFontDictionary("EditF", font.ref);
      const codes: number[] = [];
      for (const ch of text) codes.push(...font.codeBytes(font.encodeChar(ch)!));
      hex = hexString(codes);
      used = "own";
    } else {
      const sub = anchor.desc.substitute;
      const face = needsUnicodeFace(text) ? "sans" : standardFontKey(sub.font, sub.bold, sub.italic);
      const embedded = await embedDrawingFont(doc, [text], face);
      key = page.node.newFontDictionary(embedded.name, embedded.ref);
      hex = embedded.encodeText(text).toString();
      used = substituteLabel(sub, text);
    }
    const fill =
      anchor.g.form === null && show.fill.ops
        ? show.fill.ops
        : show.fill.hex
          ? (() => {
              const h = show.fill.hex!;
              const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
              return `${num(c[0]!)} ${num(c[1]!)} ${num(c[2]!)} rg`;
            })()
          : "0 g";
    const m = (x: Mat) => x.map(num).join(" ");
    const tr = show.tr >= 4 ? show.tr - 4 : show.tr;
    lines.push(
      `q ${m(show.ctm)} cm ${fill} BT ${key.toString()} ${num(show.fs)} Tf ${num(show.th * 100)} Tz ${num(show.tc)} Tc ${num(show.tw)} Tw ${num(show.ts)} Ts ${tr} Tr ${m(anchor.glyph.tm)} Tm ${hex} Tj ET Q`,
    );
    outcomes.push({ id: r.id, font: used, removedGlyphs: anchor.desc.glyphCount });
  }
  if (lines.length > 0) {
    const ref = ctx.register(ctx.flateStream(asciiBytes(`${lines.join("\n")}\n`)));
    page.node.addContentStream(ref);
  }

  return {
    retext: outcomes,
    removedGlyphs,
    imagesRedacted: imageJobs.length,
    annotationsRemoved: doomedAnnots.size,
  };
}

/**
 * Drop every object nothing reachable from the trailer refers to — the
 * page's old content stream, a replaced image — so the removed text and
 * pixels are not still in the saved file as orphans.
 */
export function pruneUnreachable(lib: PdfLibModule, doc: PDFDocument): number {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = lib;
  const ctx = doc.context;
  const seen = new Set<string>();
  const queue: PDFObject[] = [];
  const t = ctx.trailerInfo;
  for (const o of [t.Root, t.Info, t.Encrypt, t.ID]) if (o) queue.push(o);
  while (queue.length) {
    const o = queue.pop()!;
    if (o instanceof PDFRef) {
      const k = o.toString();
      if (seen.has(k)) continue;
      seen.add(k);
      const v = ctx.lookup(o);
      if (v) queue.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) queue.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) queue.push(v);
    } else if (o instanceof PDFStream) {
      queue.push(o.dict);
    }
  }
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      ctx.delete(ref);
      dropped++;
    }
  }
  return dropped;
}
