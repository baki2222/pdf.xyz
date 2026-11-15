/**
 * The INDEPENDENT readers Translate PDF's language proof judges a printed PDF
 * with — poppler's `pdffonts`, `pdftotext` (UTF-8, and `-bbox`) and
 * `pdftoppm` — run as child processes over a temp file, always cleaned up.
 *
 * Independent of the renderer on purpose: Chromium printing a page says
 * nothing about whether the page carries the script. These are the tools
 * the worker image already ships (`poppler-utils`, Dockerfile:196).
 *
 * Two readers are not poppler (2026-11-15, CJK in Type 3):
 *  - {@link type3Glyphs} walks the Type 3 fonts' OBJECTS with pdf-lib — the
 *    page content, the encoding, the CharProcs and the ToUnicode map — with
 *    its own content-stream and CMap parsers. It reads structure, not pixels:
 *    it is how the probe sees a .notdef box, a bitmap glyph or a ToUnicode
 *    entry that names the wrong code point, none of which poppler reports.
 *  - {@link viewerText} is pdf.js `getTextContent`, the text an
 *    ActualText-ignoring viewer extracts, through the worker's own pdf.js
 *    loader (`pdf-office-export/pdfjs-node`), imported LAZILY: the daemon
 *    loads this module at start-up (`daemon/proved-capabilities` →
 *    `pdf-capability` → here), and must not load pdf.js with it.
 *
 * Every parser here is pure and exported, so the unit tests run them over
 * captured output without a binary.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFObject,
} from "pdf-lib";
import {
  defaultPdfTextExec,
  resolveOnPath,
  type PdfTextExec,
} from "../pdf-text/native";

/** One row of `pdffonts`. */
export interface PdfFontRow {
  name: string;
  type: string;
  embedded: boolean;
  /** The `uni` column: the font has a ToUnicode map. */
  unicode: boolean;
}

/** A word and its left edge, from `pdftotext -bbox`. */
export interface PdfWordBox {
  text: string;
  xMin: number;
}

/** A grey raster of one page, 0 = black. */
export interface GreyRaster {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface PdfProbeReaders {
  fonts(bytes: Uint8Array): Promise<PdfFontRow[]>;
  text(bytes: Uint8Array): Promise<string>;
  words(bytes: Uint8Array): Promise<PdfWordBox[]>;
  /** Absent when this host has no `pdftoppm`: the raster check is skipped. */
  raster?(bytes: Uint8Array, dpi: number): Promise<GreyRaster>;
  /** Every Type 3 font's glyphs, as the pages use them ({@link type3Glyphs}). */
  type3(bytes: Uint8Array): Promise<Type3Font[]>;
  /**
   * The text an ActualText-ignoring viewer extracts (pdf.js `getTextContent`,
   * {@link viewerText}). Absent where pdf.js does not load: the CJK languages
   * then FAIL `viewer_text` — absence never certifies.
   */
  viewerText?(bytes: Uint8Array): Promise<string>;
}

export class PdfFontsLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfFontsLayoutError";
  }
}

/**
 * `pdffonts` prints fixed-width columns under a row of dashes; the dashes are
 * the only reliable delimiter (a font name has no spaces, a type does).
 *
 * Columns are found by the HEADER's labels above each dash span, never by
 * position (2026-11-15): poppler 22.12 (the worker image) prints
 * `name type encoding emb sub uni object ID`, while xpdf's `pdffonts` prints
 * no `encoding` column, so a positional `uni` would read `object ID` there.
 * A missing `name`, `type`, `emb` or `uni` label THROWS: a layout this parser
 * does not know must not read as "no font is embedded".
 */
export function parsePdfFonts(stdout: string): PdfFontRow[] {
  const lines = stdout.split(/\r?\n/);
  const rule = lines.findIndex((l) => /^-+( -+)+\s*$/.test(l));
  if (rule < 0) return [];
  const spans: [number, number][] = [];
  for (const m of lines[rule]!.matchAll(/-+/g))
    spans.push([m.index!, m.index! + m[0].length]);
  const header = lines[rule - 1] ?? "";
  const labels = spans.map(([a, b]) => header.slice(a, b + 1).trim());
  const at = (label: string) => {
    const i = labels.indexOf(label);
    if (i < 0)
      throw new PdfFontsLayoutError(
        `pdffonts printed no "${label}" column (labels: ${labels.join(", ")})`,
      );
    return i;
  };
  const [name, type, emb, uni] = ["name", "type", "emb", "uni"].map(at) as [
    number,
    number,
    number,
    number,
  ];
  const col = (line: string, i: number) =>
    line.slice(spans[i]![0], spans[i]![1]).trim();
  return lines
    .slice(rule + 1)
    .filter((l) => l.trim().length > 0)
    .map((l) => ({
      name: col(l, name),
      type: col(l, type),
      embedded: col(l, emb) === "yes",
      unicode: col(l, uni) === "yes",
    }));
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/** The `<word xMin=…>text</word>` elements of `pdftotext -bbox`, page 1 onward. */
export function parseBboxWords(html: string): PdfWordBox[] {
  const out: PdfWordBox[] = [];
  for (const m of html.matchAll(
    /<word\b[^>]*\bxMin="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g,
  )) {
    out.push({
      xMin: Number(m[1]),
      text: m[2]!.replace(
        /&(?:amp|lt|gt|quot|apos);/g,
        (e) => XML_ENTITIES[e]!,
      ),
    });
  }
  return out;
}

/** A binary PGM (`P5`, 8-bit) as written by `pdftoppm -gray`. */
export function parsePgm(bytes: Uint8Array): GreyRaster {
  let at = 0;
  const token = (): string => {
    while (at < bytes.length) {
      const c = bytes[at]!;
      if (c === 0x23) {
        while (at < bytes.length && bytes[at] !== 0x0a) at++;
      } else if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) at++;
      else break;
    }
    let s = "";
    while (at < bytes.length && !/\s/.test(String.fromCharCode(bytes[at]!)))
      s += String.fromCharCode(bytes[at++]!);
    return s;
  };
  if (token() !== "P5") throw new Error("not a binary PGM");
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  if (!(width > 0 && height > 0 && max > 0 && max < 256))
    throw new Error("unsupported PGM");
  at += 1; // the single whitespace after maxval
  return { width, height, pixels: bytes.subarray(at, at + width * height) };
}

/** One code a page draws with a Type 3 font. */
export interface Type3Glyph {
  code: number;
  /** The ToUnicode destination for this code, or null when it has none. */
  unicode: string | null;
  /** The glyph's CharProc, decoded (latin1); "" when no CharProc resolves. */
  content: string;
  /** `d0`/`d1`, and no inline image (`BI`/`ID`/`EI`) and no XObject (`Do`). */
  vectorOnly: boolean;
}

/** One Type 3 font, with the codes the pages draw with it. */
export interface Type3Font {
  /** The FontDescriptor's /FontName, without its subset tag; null when none. */
  descriptorName: string | null;
  hasToUnicode: boolean;
  /** The .notdef CharProc (`/.notdef`, or Skia's `/g0`), or null when none. */
  notdef: string | null;
  used: Type3Glyph[];
}

type Token =
  | { kind: "op"; value: string }
  | { kind: "name"; value: string }
  | { kind: "string"; bytes: number[] }
  | { kind: "array"; items: Token[] }
  | { kind: "other" };

const WS = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%]/;

/**
 * A content stream's tokens (latin1), with arrays nested and an inline
 * image's binary data skipped. Dictionaries (`<< >>`, marked-content
 * properties) are skipped whole: no operator reads one here.
 */
export function contentTokens(src: string): Token[] {
  let i = 0;
  const stack: Token[][] = [[]];
  const push = (t: Token) => stack[stack.length - 1]!.push(t);
  while (i < src.length) {
    const c = src[i]!;
    if (WS.test(c)) {
      i++;
    } else if (c === "%") {
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
    } else if (c === "(") {
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < src.length && depth > 0) {
        const d = src[i]!;
        if (d === "\\") {
          const e = src[i + 1] ?? "";
          i += 2;
          const simple: Record<string, number> = {
            n: 10,
            r: 13,
            t: 9,
            b: 8,
            f: 12,
            "(": 40,
            ")": 41,
            "\\": 92,
          };
          if (e in simple) bytes.push(simple[e]!);
          else if (/[0-7]/.test(e)) {
            let oct = e;
            while (oct.length < 3 && /[0-7]/.test(src[i] ?? ""))
              oct += src[i++];
            bytes.push(parseInt(oct, 8) & 0xff);
          } else if (e === "\r") {
            if (src[i] === "\n") i++;
          } else if (e !== "\n") bytes.push(e.charCodeAt(0));
          continue;
        }
        if (d === "(") depth++;
        else if (d === ")" && --depth === 0) {
          i++;
          break;
        }
        bytes.push(d.charCodeAt(0) & 0xff);
        i++;
      }
      push({ kind: "string", bytes });
    } else if (c === "<" && src[i + 1] === "<") {
      let depth = 0;
      while (i < src.length) {
        if (src.startsWith("<<", i)) {
          depth++;
          i += 2;
        } else if (src.startsWith(">>", i)) {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else if (src[i] === "(") {
          // A string inside a dictionary may hold ">>": skip it balanced.
          let d = 0;
          for (; i < src.length; i++) {
            if (src[i] === "\\") {
              i++;
              continue;
            }
            if (src[i] === "(") d++;
            else if (src[i] === ")" && --d === 0) {
              i++;
              break;
            }
          }
        } else i++;
      }
      push({ kind: "other" });
    } else if (c === "<") {
      const end = src.indexOf(">", i);
      const hex = src
        .slice(i + 1, end < 0 ? src.length : end)
        .replace(/\s/g, "");
      const padded = hex.length % 2 ? `${hex}0` : hex;
      const bytes: number[] = [];
      for (let k = 0; k < padded.length; k += 2)
        bytes.push(parseInt(padded.slice(k, k + 2), 16));
      push({ kind: "string", bytes });
      i = end < 0 ? src.length : end + 1;
    } else if (c === "[") {
      stack.push([]);
      i++;
    } else if (c === "]") {
      const items = stack.length > 1 ? stack.pop()! : [];
      push({ kind: "array", items });
      i++;
    } else if (c === "/") {
      let j = i + 1;
      while (j < src.length && !WS.test(src[j]!) && !DELIM.test(src[j]!)) j++;
      const raw = src.slice(i + 1, j);
      push({
        kind: "name",
        value: raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) =>
          String.fromCharCode(parseInt(h, 16)),
        ),
      });
      i = j;
    } else {
      let j = i;
      while (j < src.length && !WS.test(src[j]!) && !DELIM.test(src[j]!)) j++;
      if (j === i) j = i + 1;
      const word = src.slice(i, j);
      i = j;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) push({ kind: "other" });
      else if (word === "true" || word === "false" || word === "null")
        push({ kind: "other" });
      else {
        push({ kind: "op", value: word });
        if (word === "ID") {
          // Inline image data runs to the first EI delimited by whitespace.
          const m = /[\0\t\n\f\r ]EI(?=[\0\t\n\f\r ]|$)/.exec(src.slice(i));
          i = m ? i + m.index + 3 : src.length;
          push({ kind: "op", value: "EI" });
        }
      }
    }
  }
  while (stack.length > 1) {
    const items = stack.pop()!;
    stack[stack.length - 1]!.push({ kind: "array", items });
  }
  return stack[0]!;
}

const PATH_OPS = new Set(["m", "l", "c", "v", "y", "re", "h"]);

/** True when a CharProc draws with vector paths only. */
export function charProcIsVectorOnly(content: string): boolean {
  const ops = contentTokens(content)
    .filter((t): t is Extract<Token, { kind: "op" }> => t.kind === "op")
    .map((t) => t.value);
  return (
    (ops.includes("d0") || ops.includes("d1")) &&
    !ops.some((o) => o === "BI" || o === "ID" || o === "EI" || o === "Do")
  );
}

/** True when a CharProc constructs at least one path. */
export function charProcDraws(content: string): boolean {
  return contentTokens(content).some(
    (t) => t.kind === "op" && PATH_OPS.has(t.value),
  );
}

const hexBytes = (hex: string) => parseInt(hex, 16);

function utf16Hex(hex: string): string {
  let s = "";
  for (let k = 0; k + 4 <= hex.length; k += 4)
    s += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16));
  return s;
}

/**
 * A ToUnicode CMap's code → text map (bfchar and bfrange, both forms). Its
 * own parser, not the renderer's: the probe must read what a viewer reads.
 */
export function parseToUnicode(cmap: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbf(char|range)([\s\S]*?)endbf\1/g)) {
    const body = block[2]!;
    if (block[1] === "char") {
      for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g))
        out.set(hexBytes(m[1]!), utf16Hex(m[2]!));
      continue;
    }
    for (const m of body.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([^\]]*)\])/g,
    )) {
      const lo = hexBytes(m[1]!);
      const hi = hexBytes(m[2]!);
      if (!(hi >= lo) || hi - lo > 0xffff) continue;
      if (m[4] !== undefined) {
        const items = [...m[4].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) =>
          utf16Hex(x[1]!),
        );
        items.forEach((t, k) => {
          if (lo + k <= hi) out.set(lo + k, t);
        });
        continue;
      }
      const dst = m[3]!;
      const head = dst.slice(0, -4);
      const last = parseInt(dst.slice(-4), 16);
      for (let code = lo; code <= hi; code++)
        out.set(code, utf16Hex(head) + String.fromCharCode(last + (code - lo)));
    }
  }
  return out;
}

const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let k = 0; k < bytes.length; k += 0x8000)
    s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return s;
};

function streamText(obj: PDFObject | undefined): string | null {
  if (!(obj instanceof PDFRawStream)) return null;
  return latin1(decodePDFRawStream(obj).decode());
}

/**
 * Every Type 3 font the pages draw with, and every code each one draws: its
 * ToUnicode destination, its CharProc and whether that CharProc is vector
 * only, plus the font's .notdef CharProc and its descriptor's face name.
 * Pure over bytes. Form XObjects are followed (bounded depth); a font used
 * on several pages is one entry.
 */
export async function type3Glyphs(bytes: Uint8Array): Promise<Type3Font[]> {
  const doc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: true,
  });
  const ctx = doc.context;
  const look = (o: PDFObject | undefined) =>
    o instanceof PDFRef ? ctx.lookup(o) : o;
  const dictOf = (o: PDFObject | undefined) => {
    const v = look(o);
    return v instanceof PDFDict ? v : undefined;
  };
  interface Entry {
    font: Type3Font;
    codes: Set<number>;
    glyph(code: number): Type3Glyph;
  }
  const fonts = new Map<PDFObject, Entry>();
  const fontEntry = (fontObj: PDFObject): Entry | null => {
    const key = fontObj;
    const known = fonts.get(key);
    if (known) return known;
    const dict = dictOf(fontObj);
    if (!dict || dict.get(PDFName.of("Subtype")) !== PDFName.of("Type3"))
      return null;
    const procs = dictOf(dict.get(PDFName.of("CharProcs")));
    const procText = (glyph: string) =>
      procs ? streamText(look(procs.get(PDFName.of(glyph)))) : null;
    const descriptor = dictOf(dict.get(PDFName.of("FontDescriptor")));
    const fontName = descriptor?.get(PDFName.of("FontName"));
    const toUnicodeText = streamText(look(dict.get(PDFName.of("ToUnicode"))));
    const toUnicode = toUnicodeText ? parseToUnicode(toUnicodeText) : null;
    const differences = new Map<number, string>();
    const encoding = dictOf(dict.get(PDFName.of("Encoding")));
    const diffs = look(encoding?.get(PDFName.of("Differences")));
    if (diffs instanceof PDFArray) {
      let code = 0;
      for (const item of diffs.asArray()) {
        const v = look(item);
        if (v instanceof PDFNumber) code = v.asNumber();
        else if (v instanceof PDFName) differences.set(code++, v.decodeText());
      }
    }
    const entry: Entry = {
      font: {
        descriptorName:
          fontName instanceof PDFName
            ? fontName.decodeText().replace(/^[A-Z]{6}\+/, "")
            : null,
        hasToUnicode: toUnicode !== null,
        notdef: procText(".notdef") ?? procText("g0"),
        used: [],
      },
      codes: new Set<number>(),
      glyph(code: number) {
        const name = differences.get(code);
        const content = (name ? procText(name) : null) ?? "";
        return {
          code,
          unicode: toUnicode?.get(code) ?? null,
          content,
          vectorOnly: content !== "" && charProcIsVectorOnly(content),
        };
      },
    };
    fonts.set(key, entry);
    return entry;
  };
  const walk = (
    content: string,
    resources: PDFDict | undefined,
    depth: number,
  ) => {
    const fontRes = dictOf(resources?.get(PDFName.of("Font")));
    const xobjects = dictOf(resources?.get(PDFName.of("XObject")));
    let current: Entry | null = null;
    const saved: (Entry | null)[] = [];
    let operands: Token[] = [];
    const draw = (t: Token | undefined) => {
      if (!current || !t) return;
      const strings =
        t.kind === "string"
          ? [t]
          : t.kind === "array"
            ? t.items.filter((x) => x.kind === "string")
            : [];
      for (const s of strings)
        if (s.kind === "string") for (const b of s.bytes) current.codes.add(b);
    };
    for (const t of contentTokens(content)) {
      if (t.kind !== "op") {
        operands.push(t);
        continue;
      }
      const op = t.value;
      if (op === "q") saved.push(current);
      else if (op === "Q") current = saved.pop() ?? current;
      else if (op === "Tf") {
        const name = operands.find((o) => o.kind === "name");
        const ref =
          name && name.kind === "name"
            ? fontRes?.get(PDFName.of(name.value))
            : undefined;
        current = ref ? fontEntry(ref) : null;
      } else if (op === "Tj" || op === "'" || op === '"' || op === "TJ")
        draw(operands[operands.length - 1]);
      else if (op === "Do" && depth < 8) {
        const name = operands.find((o) => o.kind === "name");
        const xo =
          name && name.kind === "name"
            ? look(xobjects?.get(PDFName.of(name.value)))
            : undefined;
        if (
          xo instanceof PDFRawStream &&
          xo.dict.get(PDFName.of("Subtype")) === PDFName.of("Form")
        ) {
          const inner = streamText(xo);
          if (inner !== null)
            walk(
              inner,
              dictOf(xo.dict.get(PDFName.of("Resources"))) ?? resources,
              depth + 1,
            );
        }
      }
      operands = [];
    }
  };
  for (const page of doc.getPages()) {
    const node = page.node;
    const contents = look(node.get(PDFName.of("Contents")));
    const parts =
      contents instanceof PDFArray
        ? contents.asArray().map((c) => look(c))
        : [contents];
    const text = parts.map((p) => streamText(p) ?? "").join("\n");
    walk(text, node.Resources(), 0);
  }
  return [...fonts.values()].map((e) => ({
    ...e.font,
    used: [...e.codes].sort((a, b) => a - b).map((c) => e.glyph(c)),
  }));
}

/**
 * The text pdf.js extracts (`getTextContent`, every page, items joined with
 * a newline): what an ActualText-ignoring viewer — pdf.js embeds, Firefox's
 * text layer — builds from the PDF. pdf.js is imported LAZILY, here.
 */
export async function viewerText(bytes: Uint8Array): Promise<string> {
  const { openNodePdf, MAX_DECODED_IMAGE_PIXELS } =
    await import("../pdf-office-export/pdfjs-node");
  const { doc, close } = await openNodePdf(bytes, {
    maxImageSize: MAX_DECODED_IMAGE_PIXELS,
  });
  try {
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      for (const item of content.items) if ("str" in item) out.push(item.str);
    }
    return out.join("\n");
  } finally {
    await close();
  }
}

/**
 * Through the pdftotext runner's own subprocess seam (`defaultPdfTextExec`):
 * argv, never a shell, with a timeout and an output ceiling. Not a second
 * `execFile` site, so the worker's spawn guards (`spawn-sites.guard.test.ts`,
 * `engines-honour-abort.test.ts`) see one runner, already driven there.
 */
function run(
  exec: PdfTextExec,
  binary: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  return exec(binary, args, {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

async function withPdf<T>(
  bytes: Uint8Array,
  work: (file: string, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-tpdf-"));
  try {
    const file = path.join(dir, "in.pdf");
    await writeFile(file, bytes);
    return await work(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The poppler readers on this host's PATH, or null when `pdffonts` or
 * `pdftotext` is missing — the font and text checks are not optional.
 */
export function nativePdfProbeReaders(
  onPath: (binary: string) => boolean = resolveOnPath,
  timeoutMs = 30_000,
  exec: PdfTextExec = defaultPdfTextExec,
): PdfProbeReaders | null {
  if (!onPath("pdffonts") || !onPath("pdftotext")) return null;
  const readers: PdfProbeReaders = {
    fonts: (bytes) =>
      withPdf(bytes, async (file) =>
        parsePdfFonts(await run(exec, "pdffonts", ["--", file], timeoutMs)),
      ),
    text: (bytes) =>
      withPdf(bytes, (file) =>
        run(
          exec,
          "pdftotext",
          ["-enc", "UTF-8", "-q", "--", file, "-"],
          timeoutMs,
        ),
      ),
    words: (bytes) =>
      withPdf(bytes, async (file) =>
        parseBboxWords(
          await run(
            exec,
            "pdftotext",
            ["-bbox", "-enc", "UTF-8", "-q", "--", file, "-"],
            timeoutMs,
          ),
        ),
      ),
    type3: type3Glyphs,
    viewerText,
  };
  if (onPath("pdftoppm")) {
    readers.raster = (bytes, dpi) =>
      withPdf(bytes, async (file, dir) => {
        await run(
          exec,
          "pdftoppm",
          [
            "-gray",
            "-r",
            String(dpi),
            "-f",
            "1",
            "-l",
            "1",
            "--",
            file,
            path.join(dir, "page"),
          ],
          timeoutMs,
        );
        const name = (await readdir(dir)).find((f) => f.endsWith(".pgm"));
        if (!name) throw new Error("pdftoppm wrote no page");
        return parsePgm(new Uint8Array(await readFile(path.join(dir, name))));
      });
  }
  return readers;
}
