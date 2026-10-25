import type { PDFPage } from "pdf-lib";
import { loadPdf } from "./engine";
import { loadPdfLib } from "./pdf-lib";
import { viewerFrame } from "./page-frame";
import { contentToViewer, type ExportFrame } from "./editor/geometry";
import {
  allGlyphs,
  analyzePage,
  insideRun,
  type Box,
  type Mat,
} from "./editor/page-content";
import type { RedactionRect } from "./redact-defaults";
import { extractPdfTextItems, type PdfTextReader } from "./text";
import { loadPdfjs } from "./pdfjs";
import { MAX_FOUND, type PiiCategory } from "./redact-categories";

/**
 * Redact PDF's "Find text" and "Detect personal data": the page's selectable
 * text as pdf.js reads it (the text a viewer searches and copies), matched,
 * and each match turned into redaction boxes over the characters it covers.
 *
 * A box is placed from the GLYPHS the page draws whenever they can be lined
 * up with pdf.js's string — the same content-stream reading Edit PDF's
 * Redact removes text with (`editor/page-content.ts`), so the box covers
 * exactly the matched glyphs and not their neighbours. Where they cannot be
 * lined up (a font whose characters pdf.js and the content stream count
 * differently), the box is the matched share of the run's width.
 *
 * Detection is pattern matching, not understanding: an e-mail address, a
 * phone number, a payment-card number that passes the Luhn check, an IBAN
 * that passes its mod-97 check, and a date that follows a "Date of birth" or
 * "DOB" label. `redact-find.test.ts` holds every category to fixture strings
 * and to decoys it must not match.
 */

export {
  MAX_FOUND,
  PII_CATEGORIES,
  PII_HINT,
  PII_LABEL,
  type PiiCategory,
} from "./redact-categories";

export type FoundKind = "search" | PiiCategory;

/** One match, ready to review and to become redaction boxes. */
export interface FoundText {
  /** Stable for a document: `<page>:<start>:<end>`. */
  key: string;
  kind: FoundKind;
  /** 1-based page. */
  page: number;
  text: string;
  /** A little of the page text either side, for the review list. */
  before: string;
  after: string;
  /** One box per text run the match covers (bottom-left origin, points). */
  rects: RedactionRect[];
}

interface IndexedRun {
  str: string;
  transform: Mat;
  width: number;
  /** Per character of `str`: the content-space box of its glyph, or null. */
  charBoxes: (Box | null)[] | null;
}

interface PageIndex {
  /** 1-based. */
  page: number;
  text: string;
  /** Per character of `text`: the run that drew it, or -1 (a gap, a line end). */
  owner: Int32Array;
  /** Per character of `text`: its offset inside its run's string. */
  offset: Int32Array;
  runs: IndexedRun[];
  frame: ExportFrame;
}

/** A document's text, indexed for search. */
export interface RedactTextIndex {
  pageCount: number;
  pages: PageIndex[];
  /** 1-based pages with no selectable text at all (scans, blank pages). */
  pagesWithoutText: number[];
  /** Runs whose boxes come from their glyphs / from a share of their width. */
  placement: { glyphs: number; estimated: number };
}

/** pdf.js's placement of a run's vertical extent, as Edit PDF uses it. */
const DESCENT = -0.22;
const ASCENT = 0.92;

const isSpace = (ch: string) => /\s/u.test(ch);

interface PageGlyph {
  cx: number;
  cy: number;
  box: Box;
  chars: string;
}

function pageGlyphs(
  lib: Awaited<ReturnType<typeof loadPdfLib>>,
  page: PDFPage,
): PageGlyph[] | null {
  try {
    const analysis = analyzePage(lib, page);
    const out: PageGlyph[] = [];
    for (const g of allGlyphs(analysis)) {
      const glyph = g.show.glyphs[g.index]!;
      out.push({
        cx: glyph.cx,
        cy: glyph.cy,
        box: glyph.box,
        chars: glyph.unicode ?? "",
      });
    }
    return out;
  } catch {
    // A content stream the reader cannot follow: boxes fall back to a share
    // of each run's width rather than failing the search.
    return null;
  }
}

/**
 * Line a run's characters up with the glyphs inside it, ignoring white
 * space on both sides (pdf.js writes a space where it sees a gap, which the
 * page may not draw as a glyph). Null when the two do not agree exactly.
 */
function charBoxesFor(
  run: Omit<IndexedRun, "charBoxes">,
  glyphs: readonly PageGlyph[] | null,
): (Box | null)[] | null {
  if (!glyphs) return null;
  const geometry = { transform: run.transform, width: run.width };
  const inside = glyphs.filter((g) => insideRun(geometry, g.cx, g.cy));
  const glyphChars: { ch: string; box: Box }[] = [];
  for (const g of inside) {
    for (const ch of g.chars) {
      if (!isSpace(ch)) glyphChars.push({ ch, box: g.box });
    }
  }
  const strChars: number[] = [];
  [...run.str].forEach((ch, i) => {
    if (!isSpace(ch)) strChars.push(i);
  });
  if (strChars.length !== glyphChars.length || strChars.length === 0) {
    return null;
  }
  const chars = [...run.str];
  const boxes: (Box | null)[] = chars.map(() => null);
  for (let k = 0; k < strChars.length; k++) {
    const i = strChars[k]!;
    if (chars[i]!.normalize("NFKC") !== glyphChars[k]!.ch.normalize("NFKC")) {
      return null;
    }
    boxes[i] = glyphChars[k]!.box;
  }
  return boxes;
}

function finiteTransform(t: unknown): Mat | null {
  if (!Array.isArray(t) || t.length < 6) return null;
  const m = t.slice(0, 6).map(Number);
  return m.every(Number.isFinite) ? (m as Mat) : null;
}

/**
 * Read every page's text and where each character sits. `loadReader` is the
 * pdf.js build (tests pass the legacy one, as `extractPdfText` allows).
 */
export async function readRedactText(
  bytes: Uint8Array,
  loadReader: PdfTextReader = loadPdfjs,
): Promise<RedactTextIndex> {
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const pdfPages = doc.getPages();
  const { pageCount, pages: items } = await extractPdfTextItems(
    bytes,
    loadReader,
  );
  const pages: PageIndex[] = [];
  const pagesWithoutText: number[] = [];
  const placement = { glyphs: 0, estimated: 0 };

  items.forEach((pageItems, i) => {
    const pdfPage = pdfPages[i];
    if (!pdfPage) return;
    const frame = viewerFrame(pdfPage);
    let glyphs: PageGlyph[] | null | undefined;
    const runs: IndexedRun[] = [];
    let text = "";
    const owner: number[] = [];
    const offset: number[] = [];
    const push = (chars: string, run: number) => {
      [...chars].forEach((ch, k) => {
        text += ch;
        // One entry per UTF-16 unit, so indexes match `text`.
        for (let u = 0; u < ch.length; u++) {
          owner.push(run);
          offset.push(run < 0 ? -1 : k);
        }
      });
    };
    for (const item of pageItems) {
      const str = typeof item.str === "string" ? item.str : "";
      const transform = finiteTransform(item.transform);
      const width = Number(item.width);
      if (
        str.trim().length > 0 &&
        transform &&
        Number.isFinite(width) &&
        width > 0 &&
        Math.hypot(transform[0], transform[1]) > 0
      ) {
        if (glyphs === undefined) glyphs = pageGlyphs(lib, pdfPage);
        const base = { str, transform, width };
        const charBoxes = charBoxesFor(base, glyphs);
        if (charBoxes) placement.glyphs++;
        else placement.estimated++;
        runs.push({ ...base, charBoxes });
        push(str, runs.length - 1);
      } else if (str.length > 0) {
        push(str, -1);
      }
      if (item.hasEOL === true) push("\n", -1);
    }
    if (text.trim().length === 0) pagesWithoutText.push(i + 1);
    pages.push({
      page: i + 1,
      text,
      owner: Int32Array.from(owner),
      offset: Int32Array.from(offset),
      runs,
      frame,
    });
  });
  return { pageCount, pages, pagesWithoutText, placement };
}

/* ----------------------------- boxes ----------------------------- */

function unionBox(boxes: readonly Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** The content-space box of characters [from, to) of a run. */
function runSliceBox(run: IndexedRun, from: number, to: number): Box | null {
  const chars = [...run.str];
  if (run.charBoxes) {
    const boxes: Box[] = [];
    for (let i = from; i < to; i++) {
      const b = run.charBoxes[i];
      if (b) boxes.push(b);
    }
    if (boxes.length > 0) return unionBox(boxes);
    if (chars.slice(from, to).every(isSpace)) return null;
  }
  if (chars.slice(from, to).every(isSpace)) return null;
  // Estimated: the matched share of the run's advance.
  const [a, b, c, d, e, f] = run.transform;
  const along = run.width / Math.hypot(a, b);
  const u0 = (from / chars.length) * along;
  const u1 = (to / chars.length) * along;
  const at = (u: number, v: number) => ({
    x: e + u * a + v * c,
    y: f + u * b + v * d,
  });
  const pts = [
    at(u0, DESCENT),
    at(u1, DESCENT),
    at(u0, ASCENT),
    at(u1, ASCENT),
  ];
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  };
}

/** A content-space box as a redaction rectangle on the displayed page. */
export function contentBoxToRect(
  box: Box,
  frame: ExportFrame,
  page: number,
): RedactionRect {
  const corners = [
    contentToViewer(box.x0, box.y0, frame),
    contentToViewer(box.x1, box.y0, frame),
    contentToViewer(box.x0, box.y1, frame),
    contentToViewer(box.x1, box.y1, frame),
  ];
  const clampX = (v: number) => Math.max(0, Math.min(frame.width, v));
  const clampY = (v: number) => Math.max(0, Math.min(frame.height, v));
  const vx0 = clampX(Math.min(...corners.map((p) => p.x)));
  const vx1 = clampX(Math.max(...corners.map((p) => p.x)));
  const vy0 = clampY(Math.min(...corners.map((p) => p.y)));
  const vy1 = clampY(Math.max(...corners.map((p) => p.y)));
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    page,
    x: round(vx0),
    // Viewer y grows down from the top; a RedactionRect's y is its bottom edge.
    y: round(frame.height - vy1),
    width: round(vx1 - vx0),
    height: round(vy1 - vy0),
  };
}

/** The boxes covering characters [start, end) of a page's text. */
function rectsFor(
  page: PageIndex,
  start: number,
  end: number,
): RedactionRect[] {
  const out: RedactionRect[] = [];
  let i = start;
  while (i < end) {
    const run = page.owner[i]!;
    if (run < 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < end && page.owner[j] === run) j++;
    // `offset` counts code points within the run; [from, to) in those units.
    const from = page.offset[i]!;
    const to = page.offset[j - 1]! + 1;
    const box = runSliceBox(page.runs[run]!, from, to);
    if (box) {
      const rect = contentBoxToRect(box, page.frame, page.page);
      if (rect.width > 0 && rect.height > 0) out.push(rect);
    }
    i = j;
  }
  return out;
}

const CONTEXT = 28;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ");
}

function found(
  page: PageIndex,
  kind: FoundKind,
  start: number,
  end: number,
): FoundText | null {
  const rects = rectsFor(page, start, end);
  if (rects.length === 0) return null;
  return {
    key: `${page.page}:${start}:${end}`,
    kind,
    page: page.page,
    text: oneLine(page.text.slice(start, end)),
    before: oneLine(page.text.slice(Math.max(0, start - CONTEXT), start)),
    after: oneLine(page.text.slice(end, end + CONTEXT)),
    rects,
  };
}

/* ----------------------------- search ----------------------------- */

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The pattern a search runs: literal, white space matching any run of it. */
export function searchPattern(
  query: string,
  { matchCase, wholeWord }: SearchOptions,
): RegExp | null {
  const words = query.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return null;
  const body = words.map(escapeRegExp).join("\\s+");
  const source = wholeWord
    ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`
    : body;
  return new RegExp(source, matchCase ? "gu" : "giu");
}

export function findTextMatches(
  index: RedactTextIndex,
  query: string,
  options: SearchOptions,
): { matches: FoundText[]; capped: boolean } {
  const pattern = searchPattern(query, options);
  if (!pattern) return { matches: [], capped: false };
  const matches: FoundText[] = [];
  for (const page of index.pages) {
    for (const m of page.text.matchAll(pattern)) {
      if (m[0].length === 0) continue;
      const hit = found(page, "search", m.index, m.index + m[0].length);
      if (!hit) continue;
      if (matches.length >= MAX_FOUND) return { matches, capped: true };
      matches.push(hit);
    }
  }
  return { matches, capped: false };
}

/* ---------------------------- detection ---------------------------- */

/** The Luhn checksum every payment-card number carries. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** ISO 13616's mod-97 check: an IBAN, moved and lettered, leaves 1. */
export function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of v) rem = (rem * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

const digitCount = (s: string) => s.replace(/\D/g, "").length;

/*
 * Digit runs are fenced on both sides so a pattern cannot match the middle
 * of a longer number: not preceded by a word character, a "+" or a digit
 * followed by a separator, and likewise after. That fence is what keeps a
 * phone pattern out of a 16-digit card number and an order reference.
 */
const FENCE_BEFORE = String.raw`(?<![\p{L}\p{N}_+\-/.]|\d[ .\-])`;
const FENCE_AFTER = String.raw`(?![\p{L}\p{N}_]|[ .\-/]\d)`;

const EMAIL = new RegExp(
  String.raw`(?<![\p{L}\p{N}._%+'\-])[\p{L}\p{N}._%+'\-]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}(?![\p{L}\p{N}\-])`,
  "gu",
);
const CARD = new RegExp(
  String.raw`${FENCE_BEFORE}\d(?:[ \-]?\d){12,18}${FENCE_AFTER}`,
  "gu",
);
const IBAN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![\p{L}\p{N}])`,
  "gu",
);
/** International: "+", a country code, then groups — 8 to 15 digits in all (E.164). */
const PHONE_INTL = new RegExp(
  String.raw`(?<![\p{L}\p{N}_+])\+\d{1,3}(?:[ .\-]?(?:\(\d{1,4}\)|\d{1,4})){2,6}${FENCE_AFTER}`,
  "gu",
);
/**
 * National: two to five digit groups, the first set off by a separator or
 * parentheses, 10 or 11 digits in all — "(415) 555-0132", "020 7946 0958",
 * "07700 900123". A bare run of digits is never a phone number here: an
 * order number, an account reference and a year all look like one.
 */
const PHONE_LOCAL = new RegExp(
  String.raw`${FENCE_BEFORE}(?:\(\d{2,5}\)[ .\-]?|\d{2,5}[ .\-])(?:\d{2,6}[ .\-]){0,3}\d{2,6}${FENCE_AFTER}`,
  "gu",
);
const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DATE = [
  String.raw`\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2})`,
  String.raw`\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}`,
  String.raw`\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\s*,?\s+\d{4}`,
  String.raw`${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s+\d{4}`,
].join("|");
/** Only a date that follows a date-of-birth label; the date is what is boxed. */
const DOB = new RegExp(
  String.raw`(?<![\p{L}])(?:date\s+of\s+birth|birth\s*date|d\.?\s?o\.?\s?b\.?)(?![\p{L}])\s*[:\-–]?\s*(${DATE})(?![\p{N}])`,
  "giu",
);

export interface Detection {
  kind: PiiCategory;
  start: number;
  end: number;
}

/**
 * Every detection in `text`, for the categories asked for. Overlaps keep the
 * stronger evidence — a checksum beats a shape — in the order card, IBAN,
 * e-mail, date of birth, phone.
 */
export function detectInText(
  text: string,
  categories: readonly PiiCategory[],
): Detection[] {
  const want = new Set(categories);
  const out: Detection[] = [];
  const add = (kind: PiiCategory, start: number, end: number) => {
    if (out.some((d) => start < d.end && d.start < end)) return;
    out.push({ kind, start, end });
  };
  if (want.has("card")) {
    for (const m of text.matchAll(CARD)) {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
        add("card", m.index, m.index + m[0].length);
      }
    }
  }
  if (want.has("iban")) {
    for (const m of text.matchAll(IBAN)) {
      if (ibanValid(m[0])) add("iban", m.index, m.index + m[0].length);
    }
  }
  if (want.has("email")) {
    for (const m of text.matchAll(EMAIL)) {
      add("email", m.index, m.index + m[0].length);
    }
  }
  if (want.has("dob")) {
    for (const m of text.matchAll(DOB)) {
      const date = m[1]!;
      const at = m.index + m[0].length - date.length;
      add("dob", at, at + date.length);
    }
  }
  if (want.has("phone")) {
    for (const m of text.matchAll(PHONE_INTL)) {
      const n = digitCount(m[0]);
      if (n >= 8 && n <= 15) add("phone", m.index, m.index + m[0].length);
    }
    for (const m of text.matchAll(PHONE_LOCAL)) {
      const n = digitCount(m[0]);
      if (n >= 10 && n <= 11) add("phone", m.index, m.index + m[0].length);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function detectPersonalData(
  index: RedactTextIndex,
  categories: readonly PiiCategory[],
): FoundText[] {
  const out: FoundText[] = [];
  for (const page of index.pages) {
    for (const d of detectInText(page.text, categories)) {
      const hit = found(page, d.kind, d.start, d.end);
      if (hit) out.push(hit);
      if (out.length >= MAX_FOUND) return out;
    }
  }
  return out;
}
