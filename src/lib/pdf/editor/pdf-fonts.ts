import type { PDFDict, PDFObject, PDFRef } from "pdf-lib";
import type { PdfLibModule } from "../pdf-lib";
import {
  isName,
  isNum,
  isStr,
  parseContent,
  type PdfValue,
} from "./content-stream";

/**
 * A page font as the content-stream interpreter needs it: how many bytes
 * each character code takes, how far each code advances, what text it
 * stands for, and — for Edit text's "draw it in its own font" — which
 * characters can be written back in that font.
 *
 * Widths come from the font's own `/Widths` (simple fonts) or `/W` + `/DW`
 * (CID fonts), the numbers every viewer positions glyphs with; a standard-14
 * font written without widths (pdf-lib writes Helvetica that way) takes its
 * AFM metrics. Text comes from `/ToUnicode` first, then the encoding's glyph
 * names.
 */

export interface FontInfo {
  /** `/BaseFont` without a subset tag (`ABCDEF+`). */
  baseFont: string;
  subset: boolean;
  embedded: boolean;
  type0: boolean;
  type3: boolean;
  vertical: boolean;
  /** `/FontDescriptor /Flags`. */
  flags: number;
  italicAngle: number;
  fontWeight: number;
  /** Ascender and descender per unit of font size. */
  ascent: number;
  descent: number;
  /** Bytes the code starting at `bytes[i]` takes. */
  codeLength(bytes: Uint8Array, i: number): number;
  /** Advance per unit of font size (glyph width ÷ 1000, or via `/FontMatrix`). */
  width(code: number): number;
  unicode(code: number): string | undefined;
  /** The code that draws `ch`, from the same table, or undefined. */
  encodeChar(ch: string): number | undefined;
  /** Bytes a code is written with. */
  codeBytes(code: number): number[];
  /** The indirect font object, when it is one. */
  ref: PDFRef | undefined;
}

/** pdf-lib's WinAnsi table, inverted: code → unicode + glyph name. */
interface CodeEntry {
  cp: number;
  name: string;
}
let winAnsi: Map<number, CodeEntry> | null = null;
let glyphNames: Map<string, number> | null = null;

function winAnsiTable(lib: PdfLibModule): Map<number, CodeEntry> {
  if (winAnsi) return winAnsi;
  const enc = lib.StandardFontEmbedder.for(
    "Helvetica" as Parameters<typeof lib.StandardFontEmbedder.for>[0],
  ).encoding;
  const table = new Map<number, CodeEntry>();
  const names = new Map<string, number>();
  for (const cp of enc.supportedCodePoints) {
    const { code, name } = enc.encodeUnicodeCodePoint(cp);
    if (!table.has(code)) table.set(code, { cp, name });
    if (!names.has(name)) names.set(name, cp);
  }
  winAnsi = table;
  glyphNames = names;
  return table;
}

function unicodeOfGlyphName(lib: PdfLibModule, name: string): number | null {
  winAnsiTable(lib);
  const known = glyphNames!.get(name);
  if (known !== undefined) return known;
  let m = /^uni([0-9A-Fa-f]{4})/.exec(name);
  if (m) return parseInt(m[1]!, 16);
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return parseInt(m[1]!, 16);
  if (name.length === 1) return name.charCodeAt(0);
  return null;
}

/** BaseFont → the standard-14 face whose AFM metrics stand in for missing widths. */
function standardName(base: string): string | null {
  const n = base.replace(/[\s_-]/g, "").toLowerCase();
  const bold = /bold|black|heavy/.test(n);
  const italic = /italic|oblique/.test(n);
  if (n.startsWith("helvetica") || n.startsWith("arial")) {
    return `Helvetica${bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : ""}`;
  }
  if (n.startsWith("times")) {
    return bold && italic
      ? "Times-BoldItalic"
      : bold
        ? "Times-Bold"
        : italic
          ? "Times-Italic"
          : "Times-Roman";
  }
  if (n.startsWith("courier")) {
    return `Courier${bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : ""}`;
  }
  if (n.startsWith("symbol")) return "Symbol";
  if (n.startsWith("zapfdingbats")) return "ZapfDingbats";
  return null;
}

/** Decode any stream pdf-lib holds to its bytes. */
export function streamBytes(lib: PdfLibModule, obj: PDFObject): Uint8Array {
  if (obj instanceof lib.PDFRawStream) {
    return lib.decodePDFRawStream(obj).decode();
  }
  const s = obj as unknown as { getUnencodedContents?: () => Uint8Array };
  if (typeof s.getUnencodedContents === "function") {
    return s.getUnencodedContents();
  }
  return new Uint8Array(0);
}

function utf16be(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  }
  if (bytes.length % 2 === 1)
    s += String.fromCharCode(bytes[bytes.length - 1]!);
  return s;
}

const codeOf = (bytes: Uint8Array) => bytes.reduce((v, b) => v * 256 + b, 0);

interface CMapData {
  /** Code byte lengths, from the codespace ranges. */
  ranges: { len: number; lo: number; hi: number }[];
  uni: Map<number, string>;
  cid: Map<number, number>;
}

function parseCMap(bytes: Uint8Array): CMapData {
  const ranges: CMapData["ranges"] = [];
  const uni = new Map<number, string>();
  const cid = new Map<number, number>();
  for (const op of parseContent(bytes)) {
    const a = op.args;
    switch (op.op) {
      case "endcodespacerange":
        for (let i = 0; i + 1 < a.length; i += 2) {
          const lo = a[i];
          const hi = a[i + 1];
          if (isStr(lo) && isStr(hi)) {
            ranges.push({
              len: lo.bytes.length,
              lo: codeOf(lo.bytes),
              hi: codeOf(hi.bytes),
            });
          }
        }
        break;
      case "endbfchar":
        for (let i = 0; i + 1 < a.length; i += 2) {
          const src = a[i];
          const dst = a[i + 1];
          if (isStr(src) && isStr(dst))
            uni.set(codeOf(src.bytes), utf16be(dst.bytes));
          else if (isStr(src) && isName(dst)) uni.set(codeOf(src.bytes), dst.v);
        }
        break;
      case "endbfrange":
        for (let i = 0; i + 2 < a.length; i += 3) {
          const lo = a[i];
          const hi = a[i + 1];
          const dst = a[i + 2];
          if (!isStr(lo) || !isStr(hi)) continue;
          const from = codeOf(lo.bytes);
          const to = Math.min(codeOf(hi.bytes), from + 0xffff);
          if (isStr(dst)) {
            const base = utf16be(dst.bytes);
            const last = base.charCodeAt(base.length - 1);
            for (let c = from; c <= to; c++) {
              uni.set(
                c,
                base.slice(0, -1) + String.fromCharCode(last + (c - from)),
              );
            }
          } else if (Array.isArray(dst)) {
            dst.forEach((d, k) => {
              if (isStr(d)) uni.set(from + k, utf16be(d.bytes));
            });
          }
        }
        break;
      case "endcidchar":
        for (let i = 0; i + 1 < a.length; i += 2) {
          const src = a[i];
          const dst = a[i + 1];
          if (isStr(src) && isNum(dst)) cid.set(codeOf(src.bytes), dst);
        }
        break;
      case "endcidrange":
        for (let i = 0; i + 2 < a.length; i += 3) {
          const lo = a[i];
          const hi = a[i + 1];
          const dst = a[i + 2];
          if (!isStr(lo) || !isStr(hi) || !isNum(dst)) continue;
          const from = codeOf(lo.bytes);
          const to = Math.min(codeOf(hi.bytes), from + 0xffff);
          for (let c = from; c <= to; c++) cid.set(c, dst + (c - from));
        }
        break;
    }
  }
  return { ranges, uni, cid };
}

function toValue(lib: PdfLibModule, obj: PDFObject | undefined): PdfValue {
  if (!obj) return null;
  if (obj instanceof lib.PDFNumber) return obj.asNumber();
  if (obj instanceof lib.PDFName) return { t: "name", v: obj.decodeText() };
  if (obj instanceof lib.PDFArray)
    return obj.asArray().map((o) => toValue(lib, o));
  return null;
}

/** Cache of loaded fonts, per font object. */
const fontCache = new WeakMap<object, FontInfo>();

/** Read a font, given the context to resolve references in. */
export function loadFontFrom(
  lib: PdfLibModule,
  context: { lookup(o: PDFObject | undefined): PDFObject | undefined },
  fontObj: PDFObject | undefined,
): FontInfo | null {
  if (!fontObj) return null;
  const { PDFDict, PDFRef, PDFArray, PDFNumber, PDFName, PDFStream } = lib;
  const ref = fontObj instanceof PDFRef ? fontObj : undefined;
  const resolved = ref ? context.lookup(ref) : fontObj;
  if (!(resolved instanceof PDFDict)) return null;
  const cached = fontCache.get(resolved);
  if (cached) return cached;
  const dict = resolved;
  const get = (d: PDFDict, key: string) =>
    context.lookup(d.get(PDFName.of(key)));
  const nameOf = (o: PDFObject | undefined) =>
    o instanceof PDFName ? o.decodeText() : undefined;
  const numOf = (o: PDFObject | undefined, fallback: number) =>
    o instanceof PDFNumber ? o.asNumber() : fallback;

  const subtype = nameOf(get(dict, "Subtype")) ?? "Type1";
  const rawBase =
    nameOf(get(dict, "BaseFont")) ?? nameOf(get(dict, "Name")) ?? "";
  const subset = /^[A-Z]{6}\+/.test(rawBase);
  const baseFont = rawBase.replace(/^[A-Z]{6}\+/, "");
  const type0 = subtype === "Type0";
  const type3 = subtype === "Type3";

  const descendant = type0
    ? (() => {
        const arr = get(dict, "DescendantFonts");
        const first =
          arr instanceof PDFArray ? context.lookup(arr.get(0)) : undefined;
        return first instanceof PDFDict ? first : undefined;
      })()
    : undefined;
  const descriptorOwner = descendant ?? dict;
  const fd = get(descriptorOwner, "FontDescriptor");
  const descriptor = fd instanceof PDFDict ? fd : undefined;
  const embedded =
    type3 ||
    (!!descriptor &&
      ["FontFile", "FontFile2", "FontFile3"].some(
        (k) => get(descriptor, k) !== undefined,
      ));
  const flags = descriptor ? numOf(get(descriptor, "Flags"), 0) : 0;
  const italicAngle = descriptor ? numOf(get(descriptor, "ItalicAngle"), 0) : 0;
  const fontWeight = descriptor
    ? numOf(get(descriptor, "FontWeight"), 400)
    : 400;
  let ascent = descriptor ? numOf(get(descriptor, "Ascent"), 0) / 1000 : 0;
  let descent = descriptor ? numOf(get(descriptor, "Descent"), 0) / 1000 : 0;
  if (!(ascent > 0.2 && ascent < 2)) ascent = 0.8;
  if (!(descent < 0 && descent > -1)) descent = -0.2;

  // ToUnicode
  const tu = get(dict, "ToUnicode");
  const toUni =
    tu instanceof PDFStream ? parseCMap(streamBytes(lib, tu)) : undefined;

  const unicodeMap = new Map<number, string>(toUni?.uni ?? []);
  let codeLength: FontInfo["codeLength"] = () => 1;
  let width: FontInfo["width"];
  let codeBytes: FontInfo["codeBytes"] = (code) => [code & 0xff];
  let vertical = false;

  if (type0) {
    const enc = get(dict, "Encoding");
    const encName = nameOf(enc);
    let ranges: CMapData["ranges"] = [];
    let cidOf: (code: number) => number = (c) => c;
    if (encName === "Identity-H" || encName === "Identity-V") {
      ranges = [{ len: 2, lo: 0, hi: 0xffff }];
      vertical = encName === "Identity-V";
    } else if (enc instanceof PDFStream) {
      const cm = parseCMap(streamBytes(lib, enc));
      ranges = cm.ranges;
      if (cm.cid.size > 0) cidOf = (c) => cm.cid.get(c) ?? c;
      const wm = get(enc.dict, "WMode");
      vertical = wm instanceof PDFNumber && wm.asNumber() === 1;
    } else {
      ranges = toUni?.ranges.length ? toUni.ranges : [];
      vertical = !!encName && /-V$/.test(encName);
    }
    if (ranges.length === 0) ranges = [{ len: 2, lo: 0, hi: 0xffff }];
    const byLen = [...new Set(ranges.map((r) => r.len))].sort((a, b) => a - b);
    codeLength = (bytes, i) => {
      for (const len of byLen) {
        if (i + len > bytes.length) break;
        let v = 0;
        for (let k = 0; k < len; k++) v = v * 256 + bytes[i + k]!;
        if (ranges.some((r) => r.len === len && v >= r.lo && v <= r.hi))
          return len;
      }
      return Math.min(byLen[byLen.length - 1] ?? 2, bytes.length - i) || 1;
    };
    const lenOfCode = byLen[byLen.length - 1] ?? 2;
    codeBytes = (code) => {
      const out: number[] = [];
      for (let k = lenOfCode - 1; k >= 0; k--)
        out.push((code >> (8 * k)) & 0xff);
      return out;
    };
    const dw = descendant ? numOf(get(descendant, "DW"), 1000) : 1000;
    const widths = new Map<number, number>();
    const w = descendant ? get(descendant, "W") : undefined;
    if (w instanceof PDFArray) {
      const items = w.asArray().map((o) => toValue(lib, context.lookup(o)));
      for (let i = 0; i < items.length;) {
        const first = items[i];
        const second = items[i + 1];
        if (!isNum(first)) break;
        if (Array.isArray(second)) {
          second.forEach((v, k) => {
            if (isNum(v)) widths.set(first + k, v);
          });
          i += 2;
        } else if (isNum(second) && isNum(items[i + 2])) {
          const last = Math.min(second, first + 0xffff);
          for (let c = first; c <= last; c++)
            widths.set(c, items[i + 2] as number);
          i += 3;
        } else break;
      }
    }
    width = (code) => (widths.get(cidOf(code)) ?? dw) / 1000;
  } else {
    const firstChar = numOf(get(dict, "FirstChar"), 0);
    const widthsObj = get(dict, "Widths");
    const widths =
      widthsObj instanceof PDFArray
        ? widthsObj.asArray().map((o) => numOf(context.lookup(o), 0))
        : null;
    const missing = descriptor ? numOf(get(descriptor, "MissingWidth"), 0) : 0;
    let fontMatrixX = 0.001;
    if (type3) {
      const fm = get(dict, "FontMatrix");
      if (fm instanceof PDFArray)
        fontMatrixX = numOf(context.lookup(fm.get(0)), 0.001);
    }
    // Glyph names: base encoding, then /Differences.
    const names = new Map<number, string>();
    const table = winAnsiTable(lib);
    const enc = get(dict, "Encoding");
    const baseName =
      nameOf(enc) ??
      (enc instanceof PDFDict ? nameOf(get(enc, "BaseEncoding")) : undefined);
    const symbolic = (flags & 4) !== 0 && !(flags & 32);
    if (baseName || !symbolic) {
      for (const [code, e] of table) names.set(code, e.name);
    }
    if (enc instanceof PDFDict) {
      const diff = get(enc, "Differences");
      if (diff instanceof PDFArray) {
        let code = 0;
        for (const o of diff.asArray()) {
          const v = context.lookup(o);
          if (v instanceof PDFNumber) code = v.asNumber();
          else if (v instanceof PDFName) names.set(code++, v.decodeText());
        }
      }
    }
    for (const [code, name] of names) {
      if (unicodeMap.has(code)) continue;
      const cp = unicodeOfGlyphName(lib, name);
      if (cp !== null) unicodeMap.set(code, String.fromCodePoint(cp));
    }
    const std = !widths ? standardName(baseFont) : null;
    const afm = std
      ? lib.StandardFontEmbedder.for(
          std as Parameters<typeof lib.StandardFontEmbedder.for>[0],
        ).font
      : null;
    width = (code) => {
      if (widths) {
        const w = widths[code - firstChar];
        return (w !== undefined ? w : missing) * fontMatrixX;
      }
      if (afm) {
        const name = names.get(code);
        const w = name ? afm.getWidthOfGlyph(name) : undefined;
        return (typeof w === "number" ? w : 0) / 1000;
      }
      return (missing || 500) / 1000;
    };
  }

  const reverse = new Map<string, number>();
  for (const [code, text] of unicodeMap) {
    if (text.length > 0 && !reverse.has(text)) reverse.set(text, code);
  }

  const info: FontInfo = {
    baseFont,
    subset,
    embedded,
    type0,
    type3,
    vertical,
    flags,
    italicAngle,
    fontWeight,
    ascent,
    descent,
    codeLength,
    width,
    unicode: (code) => unicodeMap.get(code),
    encodeChar: (ch) => reverse.get(ch),
    codeBytes,
    ref,
  };
  fontCache.set(resolved, info);
  return info;
}

/** The standard face that stands in for a font Edit text cannot write in. */
export interface SubstituteStyle {
  font: "helvetica" | "times" | "courier";
  bold: boolean;
  italic: boolean;
}

/** Closest standard face by the font's name and descriptor flags. */
export function substituteFor(font: FontInfo | null): SubstituteStyle {
  if (!font) return { font: "helvetica", bold: false, italic: false };
  const n = font.baseFont.toLowerCase();
  const mono =
    (font.flags & 1) !== 0 || /courier|mono|consol|menlo|typewriter/.test(n);
  const serif =
    !mono &&
    ((font.flags & 2) !== 0 ||
      /times|serif|roman|georgia|garamond|cambria|book|minion|palatino|baskerville/.test(
        n.replace(/sans-?serif/g, ""),
      ));
  const bold =
    /bold|black|heavy|semibold|demi/.test(n) ||
    font.fontWeight >= 600 ||
    (font.flags & 0x40000) !== 0;
  const italic =
    /italic|oblique/.test(n) ||
    Math.abs(font.italicAngle) > 0.5 ||
    (font.flags & 64) !== 0;
  return {
    font: mono ? "courier" : serif ? "times" : "helvetica",
    bold,
    italic,
  };
}
