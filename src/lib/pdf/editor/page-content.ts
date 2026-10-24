import type { PDFContext, PDFDict, PDFObject, PDFPage, PDFRef } from "pdf-lib";
import type { PdfLibModule } from "../pdf-lib";
import {
  isName,
  isNum,
  isStr,
  latin1,
  parseContent,
  type ContentOp,
  type PdfValue,
} from "./content-stream";
import { loadFontFrom, streamBytes, type FontInfo } from "./pdf-fonts";

/**
 * A content-stream interpreter: walks a page's operators the way a viewer
 * does — graphics state, text state, the text matrix advancing glyph by
 * glyph — and records WHERE every glyph and every image lands, in the page's
 * user space (pdf-lib's content space: MediaBox bottom-left origin, y up,
 * before `/Rotate`).
 *
 * It paints nothing. What it records is what Edit text and Redact need to
 * decide which operators to rewrite (`content-edit.ts`): for each
 * text-showing operator (`Tj`, `TJ`, `'`, `"`), its glyphs with their codes,
 * advances and boxes; for each `Do`, the image's placement or the Form
 * XObject's own analysis, one level deep.
 */

export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `m` then `n` (row-vector convention: p × m × n). */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}

/** An axis-aligned box in user space. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxOf(points: { x: number; y: number }[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

/** Do two boxes overlap by more than a hair (touching does not count)? */
export function boxesOverlap(a: Box, b: Box, eps = 0.01): boolean {
  return (
    a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps
  );
}

/** The fill colour in force, as a viewer would paint text with it. */
export interface FillState {
  /** `#rrggbb` when it is a device colour, else null. */
  hex: string | null;
  /** The source operators that set it, to write the same colour again. */
  ops: string;
}

const BLACK: FillState = { hex: "#000000", ops: "0 g" };

export interface ShownGlyph {
  code: number;
  bytes: number[];
  unicode: string;
  /** Horizontal advance in text space (unscaled by Tm/CTM), Tc/Tw/Tz included. */
  tx: number;
  /** User-space box of the glyph cell (advance × ascent..descent). */
  box: Box;
  /** User-space centre of the glyph cell. */
  cx: number;
  cy: number;
  /** The text matrix before this glyph was painted. */
  tm: Mat;
}

export type ShowItem =
  | { kind: "num"; value: number }
  | { kind: "glyphs"; from: number; to: number };

export interface TextShow {
  opIndex: number;
  op: string;
  glyphs: ShownGlyph[];
  /** The operator's elements in order (TJ numbers and strings). */
  items: ShowItem[];
  font: FontInfo | null;
  /** Font size (Tf), char spacing, word spacing, horizontal scale (÷100), rise, render mode. */
  fs: number;
  tc: number;
  tw: number;
  th: number;
  ts: number;
  tr: number;
  ctm: Mat;
  fill: FillState;
  /** `"`'s two numbers, as written. */
  quoteArgs?: [number, number];
}

export interface ImageUse {
  opIndex: number;
  name: string;
  ref: PDFRef | undefined;
  /** Maps the image's unit square to user space. */
  ctm: Mat;
}

export interface FormUse {
  opIndex: number;
  name: string;
  ref: PDFRef | undefined;
  /** Maps the form's space (after its /Matrix) to user space. */
  ctm: Mat;
  /** The form's own analysis (its space mapped to user space), or null past the depth limit. */
  analysis: StreamAnalysis | null;
}

export interface InlineImageUse {
  opIndex: number;
  ctm: Mat;
}

export interface StreamAnalysis {
  /** The decoded stream (several content streams joined by newlines). */
  bytes: Uint8Array;
  ops: ContentOp[];
  shows: TextShow[];
  images: ImageUse[];
  forms: FormUse[];
  inlineImages: InlineImageUse[];
  /** The resources the stream names things in. */
  resources: PDFDict | undefined;
  depth: number;
}

interface GState {
  ctm: Mat;
  fill: FillState;
  font: FontInfo | null;
  fs: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  ts: number;
  tr: number;
}

const nums = (args: PdfValue[], n: number): number[] | null => {
  if (args.length < n) return null;
  const tail = args.slice(args.length - n);
  return tail.every(isNum) ? (tail as number[]) : null;
};

const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");

function deviceHex(space: string, values: number[]): string | null {
  if (space === "DeviceGray" && values.length >= 1) {
    const g = hex2(values[0]!);
    return `#${g}${g}${g}`;
  }
  if (space === "DeviceRGB" && values.length >= 3) {
    return `#${hex2(values[0]!)}${hex2(values[1]!)}${hex2(values[2]!)}`;
  }
  if (space === "DeviceCMYK" && values.length >= 4) {
    const [c, m, y, k] = values as [number, number, number, number];
    return `#${hex2((1 - c) * (1 - k))}${hex2((1 - m) * (1 - k))}${hex2((1 - y) * (1 - k))}`;
  }
  return null;
}

/** Deepest Form XObject nesting the interpreter follows. */
export const MAX_FORM_DEPTH = 1;

/**
 * Interpret `bytes` with `resources`, starting from `baseCtm`. Forms are
 * followed to {@link MAX_FORM_DEPTH}.
 */
export function analyzeStream(
  lib: PdfLibModule,
  context: PDFContext,
  bytes: Uint8Array,
  resources: PDFDict | undefined,
  baseCtm: Mat = IDENTITY,
  depth = 0,
): StreamAnalysis {
  const { PDFDict, PDFName, PDFStream, PDFArray, PDFNumber, PDFRef } = lib;
  const ops = parseContent(bytes);
  const out: StreamAnalysis = {
    bytes,
    ops,
    shows: [],
    images: [],
    forms: [],
    inlineImages: [],
    resources,
    depth,
  };
  const lookup = (o: PDFObject | undefined) => context.lookup(o);
  const sub = (key: string): PDFDict | undefined => {
    if (!resources) return undefined;
    const d = lookup(resources.get(PDFName.of(key)));
    return d instanceof PDFDict ? d : undefined;
  };
  const fonts = sub("Font");
  const xobjects = sub("XObject");
  const colorSpaces = sub("ColorSpace");

  let gs: GState = {
    ctm: baseCtm,
    fill: BLACK,
    font: null,
    fs: 0,
    tc: 0,
    tw: 0,
    th: 1,
    tl: 0,
    ts: 0,
    tr: 0,
  };
  const stack: GState[] = [];
  let tm: Mat = IDENTITY;
  let tlm: Mat = IDENTITY;
  let fillSpace = "DeviceGray";
  let fillSpaceOps = "";

  const csName = (name: string): string => {
    if (["DeviceGray", "DeviceRGB", "DeviceCMYK"].includes(name)) return name;
    if (name === "G") return "DeviceGray";
    if (name === "RGB") return "DeviceRGB";
    if (name === "CMYK") return "DeviceCMYK";
    const cs = colorSpaces ? lookup(colorSpaces.get(PDFName.of(name))) : undefined;
    if (cs instanceof PDFName) return csName(cs.decodeText());
    if (cs instanceof PDFArray) {
      const kind = lookup(cs.get(0));
      if (kind instanceof PDFName && kind.decodeText() === "ICCBased") {
        const s = lookup(cs.get(1));
        const n = s instanceof PDFStream ? lookup(s.dict.get(PDFName.of("N"))) : undefined;
        const comps = n instanceof PDFNumber ? n.asNumber() : 0;
        return comps === 1 ? "DeviceGray" : comps === 3 ? "DeviceRGB" : comps === 4 ? "DeviceCMYK" : name;
      }
    }
    return name;
  };

  const td = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  const show = (opIndex: number, op: string, elements: PdfValue[], quoteArgs?: [number, number]) => {
    const font = gs.font;
    const glyphs: ShownGlyph[] = [];
    const items: ShowItem[] = [];
    const { fs, tc, tw, th, ts } = gs;
    const asc = font?.ascent ?? 0.8;
    const desc = font?.descent ?? -0.2;
    for (const el of elements) {
      if (isNum(el)) {
        items.push({ kind: "num", value: el });
        const tx = (-el / 1000) * fs * th;
        tm = mul([1, 0, 0, 1, tx, 0], tm);
        continue;
      }
      if (!isStr(el)) continue;
      const from = glyphs.length;
      const b = el.bytes;
      for (let i = 0; i < b.length; ) {
        const len = font ? Math.max(1, font.codeLength(b, i)) : 1;
        const codeBytes = Array.from(b.subarray(i, i + len));
        const code = codeBytes.reduce((v, x) => v * 256 + x, 0);
        i += len;
        const w0 = font ? font.width(code) : 0.5;
        const trm = mul([fs * th, 0, 0, fs, 0, ts], mul(tm, gs.ctm));
        const corners = [
          apply(trm, 0, desc),
          apply(trm, w0, desc),
          apply(trm, 0, asc),
          apply(trm, w0, asc),
        ];
        const c = apply(trm, w0 / 2, (asc + desc) / 2);
        const tx = (w0 * fs + tc + (len === 1 && code === 32 ? tw : 0)) * th;
        glyphs.push({
          code,
          bytes: codeBytes,
          unicode: font?.unicode(code) ?? "",
          tx,
          box: boxOf(corners),
          cx: c.x,
          cy: c.y,
          tm,
        });
        tm = mul([1, 0, 0, 1, tx, 0], tm);
      }
      items.push({ kind: "glyphs", from, to: glyphs.length });
    }
    out.shows.push({
      opIndex,
      op,
      glyphs,
      items,
      font,
      fs,
      tc,
      tw,
      th,
      ts,
      tr: gs.tr,
      ctm: gs.ctm,
      fill: gs.fill,
      ...(quoteArgs ? { quoteArgs } : {}),
    });
  };

  ops.forEach((o, i) => {
    const a = o.args;
    switch (o.op) {
      case "q":
        stack.push(gs);
        gs = { ...gs };
        break;
      case "Q":
        gs = stack.pop() ?? gs;
        break;
      case "cm": {
        const m = nums(a, 6);
        if (m) gs = { ...gs, ctm: mul(m as Mat, gs.ctm) };
        break;
      }
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tf": {
        const name = a[a.length - 2];
        const size = a[a.length - 1];
        if (isName(name) && fonts) {
          const raw = fonts.get(PDFName.of(name.v));
          gs = { ...gs, font: loadFontFrom(lib, context, raw) };
          if (gs.font && raw instanceof PDFRef) gs.font.ref ??= raw;
        }
        if (isNum(size)) gs = { ...gs, fs: size };
        break;
      }
      case "Tc":
        if (isNum(a[0])) gs = { ...gs, tc: a[0] };
        break;
      case "Tw":
        if (isNum(a[0])) gs = { ...gs, tw: a[0] };
        break;
      case "Tz":
        if (isNum(a[0])) gs = { ...gs, th: a[0] / 100 };
        break;
      case "TL":
        if (isNum(a[0])) gs = { ...gs, tl: a[0] };
        break;
      case "Ts":
        if (isNum(a[0])) gs = { ...gs, ts: a[0] };
        break;
      case "Tr":
        if (isNum(a[0])) gs = { ...gs, tr: a[0] };
        break;
      case "Td": {
        const m = nums(a, 2);
        if (m) td(m[0]!, m[1]!);
        break;
      }
      case "TD": {
        const m = nums(a, 2);
        if (m) {
          gs = { ...gs, tl: -m[1]! };
          td(m[0]!, m[1]!);
        }
        break;
      }
      case "Tm": {
        const m = nums(a, 6);
        if (m) {
          tlm = m as Mat;
          tm = tlm;
        }
        break;
      }
      case "T*":
        td(0, -gs.tl);
        break;
      case "Tj":
        show(i, "Tj", a.slice(-1));
        break;
      case "TJ": {
        const arr = a[a.length - 1];
        show(i, "TJ", Array.isArray(arr) ? arr : []);
        break;
      }
      case "'":
        td(0, -gs.tl);
        show(i, "'", a.slice(-1));
        break;
      case '"': {
        const aw = a[a.length - 3];
        const ac = a[a.length - 2];
        if (isNum(aw) && isNum(ac)) {
          gs = { ...gs, tw: aw, tc: ac };
          td(0, -gs.tl);
          show(i, '"', a.slice(-1), [aw, ac]);
        }
        break;
      }
      case "g":
        if (isNum(a[0])) {
          fillSpace = "DeviceGray";
          fillSpaceOps = "";
          gs = { ...gs, fill: { hex: deviceHex("DeviceGray", [a[0]]), ops: latin1(bytes, o.start, o.end) } };
        }
        break;
      case "rg": {
        const m = nums(a, 3);
        if (m) {
          fillSpace = "DeviceRGB";
          fillSpaceOps = "";
          gs = { ...gs, fill: { hex: deviceHex("DeviceRGB", m), ops: latin1(bytes, o.start, o.end) } };
        }
        break;
      }
      case "k": {
        const m = nums(a, 4);
        if (m) {
          fillSpace = "DeviceCMYK";
          fillSpaceOps = "";
          gs = { ...gs, fill: { hex: deviceHex("DeviceCMYK", m), ops: latin1(bytes, o.start, o.end) } };
        }
        break;
      }
      case "cs": {
        const n = a[a.length - 1];
        if (isName(n)) {
          fillSpace = csName(n.v);
          fillSpaceOps = latin1(bytes, o.start, o.end);
          const initial = fillSpace === "DeviceCMYK" ? [0, 0, 0, 1] : [0, 0, 0];
          gs = { ...gs, fill: { hex: deviceHex(fillSpace, initial), ops: fillSpaceOps } };
        }
        break;
      }
      case "sc":
      case "scn": {
        const values = a.filter(isNum);
        gs = {
          ...gs,
          fill: {
            hex: deviceHex(fillSpace, values),
            ops: `${fillSpaceOps} ${latin1(bytes, o.start, o.end)}`.trim(),
          },
        };
        break;
      }
      case "Do": {
        const n = a[a.length - 1];
        if (!isName(n) || !xobjects) break;
        const raw = xobjects.get(PDFName.of(n.v));
        const ref = raw instanceof PDFRef ? raw : undefined;
        const x = lookup(raw);
        if (!(x instanceof PDFStream)) break;
        const subtype = lookup(x.dict.get(PDFName.of("Subtype")));
        const kind = subtype instanceof PDFName ? subtype.decodeText() : "";
        if (kind === "Image") {
          out.images.push({ opIndex: i, name: n.v, ref, ctm: gs.ctm });
        } else if (kind === "Form") {
          let matrix: Mat = IDENTITY;
          const mArr = lookup(x.dict.get(PDFName.of("Matrix")));
          if (mArr instanceof PDFArray && mArr.size() === 6) {
            const vals = mArr.asArray().map((v) => {
              const r = lookup(v);
              return r instanceof PDFNumber ? r.asNumber() : 0;
            });
            matrix = vals as Mat;
          }
          const formCtm = mul(matrix, gs.ctm);
          let analysis: StreamAnalysis | null = null;
          if (depth < MAX_FORM_DEPTH) {
            const res = lookup(x.dict.get(PDFName.of("Resources")));
            analysis = analyzeStream(
              lib,
              context,
              streamBytes(lib, x),
              res instanceof PDFDict ? res : resources,
              formCtm,
              depth + 1,
            );
          }
          out.forms.push({ opIndex: i, name: n.v, ref, ctm: formCtm, analysis });
        }
        break;
      }
      case "BI":
        out.inlineImages.push({ opIndex: i, ctm: gs.ctm });
        break;
    }
  });
  return out;
}

/** The page's content streams, decoded and joined, and its resources. */
export function pageContent(
  lib: PdfLibModule,
  page: PDFPage,
): { bytes: Uint8Array; resources: PDFDict | undefined; refs: PDFRef[] } {
  const { PDFArray, PDFRef, PDFName, PDFDict } = lib;
  const context = page.doc.context;
  const node = page.node;
  const raw = node.get(PDFName.of("Contents"));
  const refs: PDFRef[] = [];
  const parts: Uint8Array[] = [];
  const addStream = (o: PDFObject | undefined) => {
    if (o instanceof PDFRef) refs.push(o);
    const s = context.lookup(o);
    if (s) parts.push(streamBytes(lib, s));
  };
  const contents = context.lookup(raw);
  if (contents instanceof PDFArray) {
    for (const item of contents.asArray()) addStream(item);
  } else if (raw) addStream(raw);
  let total = 0;
  for (const p of parts) total += p.length + 1;
  const bytes = new Uint8Array(Math.max(0, total));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
    bytes[at++] = 10;
  }
  const res = node.Resources();
  return {
    bytes,
    resources: res instanceof PDFDict ? res : undefined,
    refs,
  };
}

/** Analyse a whole page from its content streams. */
export function analyzePage(lib: PdfLibModule, page: PDFPage): StreamAnalysis {
  const { bytes, resources } = pageContent(lib, page);
  return analyzeStream(lib, page.doc.context, bytes, resources);
}

/** Where a glyph lives: the stream (page or form) and its show. */
export interface GlyphRef {
  stream: StreamAnalysis;
  show: TextShow;
  index: number;
  /** The page-level form use the stream belongs to, if any. */
  form: FormUse | null;
}

/** Every glyph on the page, forms included. */
export function* allGlyphs(page: StreamAnalysis): Generator<GlyphRef> {
  for (const show of page.shows) {
    for (let index = 0; index < show.glyphs.length; index++) {
      yield { stream: page, show, index, form: null };
    }
  }
  for (const form of page.forms) {
    if (!form.analysis) continue;
    for (const show of form.analysis.shows) {
      for (let index = 0; index < show.glyphs.length; index++) {
        yield { stream: form.analysis, show, index, form };
      }
    }
  }
}

/** A text run as pdf.js reports it: text-space → user matrix (size included) and advance. */
export interface RunGeometry {
  transform: Mat;
  /** Advance along the baseline, user units. */
  width: number;
}

/**
 * Is a glyph's centre inside a run's box? The run's frame is its own matrix:
 * along the baseline from 0 to `width`, across from a little below the
 * baseline to a little above the cap height.
 */
export function insideRun(run: RunGeometry, x: number, y: number): boolean {
  const [a, b, c, d, e, f] = run.transform;
  const inv = invert([a, b, c, d, 0, 0]);
  if (!inv) return false;
  const p = apply(inv, x - e, y - f);
  const along = Math.hypot(a, b) || 1;
  const s = run.width / along;
  return p.x >= -0.1 && p.x <= s + 0.1 && p.y >= -0.35 && p.y <= 0.95;
}

/** The glyphs a run painted. */
export function glyphsInRun(
  page: StreamAnalysis,
  run: RunGeometry,
): GlyphRef[] {
  const out: GlyphRef[] = [];
  for (const g of allGlyphs(page)) {
    const glyph = g.show.glyphs[g.index]!;
    if (insideRun(run, glyph.cx, glyph.cy)) out.push(g);
  }
  return out;
}

/** Visible text: render modes 3 (invisible) and 7 (clip only) paint nothing. */
export function isVisibleShow(show: TextShow): boolean {
  return show.tr !== 3 && show.tr !== 7;
}
