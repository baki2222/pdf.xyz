import type { PDFDocument, PDFFont, PDFPage, RGB as PdfLibRGB } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { outputName } from "./files";
import { PdfEngineError } from "./engine";
import { embedDrawingFont } from "./unicode-font";
import { TEXT_PAGE_MARGIN_PT, US_LETTER_PT } from "./page-geometry";
import { MARKDOWN_BLOCK_KINDS } from "./markdown-blocks";
import { wrapTextLine } from "./text-to-pdf";
import {
  BOLD,
  CODE,
  ITALIC,
  clickableHref,
  drawSegments,
  hasStyledRuns,
  wrapRuns,
  type InlineRun,
} from "./markdown-runs";

export { MARKDOWN_BLOCK_KINDS };

const PRODUCER = "pdf.xyz";
// The page geometry the tool page states — one value, see ./page-geometry.
/** US Letter, points. Exported so tests bind their page-edge check to it. */
export const PAGE_WIDTH = US_LETTER_PT.width;
const PAGE_HEIGHT = US_LETTER_PT.height;
/** Exported so tests bind their page-edge check to it. */
export const MARGIN = TEXT_PAGE_MARGIN_PT;
const BODY_SIZE = 11;
const BODY_LINE_HEIGHT = 16;
const LIST_INDENT = 18;
/** How far each level of a nested quote moves right. */
const QUOTE_STEP = 10;
/** Deeper nesting still renders, it just stops moving right. */
const MAX_LIST_DEPTH = 6;
const TABLE_SIZE = 10;
const TABLE_LINE_HEIGHT = 14;
const TABLE_PAD_X = 5;
const TABLE_PAD_Y = 4;
/**
 * Drawn after a running-header title that had to be shortened. ASCII on
 * purpose, and in the font corpus (see {@link drawnStrings}): every face we
 * ship covers U+002E, so it can never be the character that forces a face.
 */
const ELLIPSIS = "...";
// The cap the tool page advertises, so the gate and the promise are one value.
import {
  MAX_SOURCE_BYTES as MAX_MARKDOWN_BYTES,
  MAX_SOURCE_MB,
} from "@/lib/tools/limits";

export type TableAlign = "left" | "center" | "right";

export type MarkdownBlock =
  | { kind: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | {
      kind: "list-item";
      ordered: boolean;
      index?: number;
      /** 0 for a top-level item, 1 for its children, and so on. */
      depth: number;
      /** A later paragraph of the item above: drawn under its text, no marker. */
      continued?: true;
      text: string;
    }
  | {
      kind: "quote";
      text: string;
      /** 2 for a quote inside a quote, and so on; absent at the first level. */
      depth?: number;
    }
  | { kind: "code"; language?: string; text: string }
  | { kind: "rule" }
  | {
      kind: "table";
      align: TableAlign[];
      header: string[];
      rows: string[][];
    };

// Both directions, at compile time: no kind the renderer draws is missing from
// the list, and the list names nothing the renderer lacks.
type UnlistedBlockKind = Exclude<
  MarkdownBlock["kind"],
  (typeof MARKDOWN_BLOCK_KINDS)[number]
>;
type PhantomBlockKind = Exclude<
  (typeof MARKDOWN_BLOCK_KINDS)[number],
  MarkdownBlock["kind"]
>;
const blockKindsAgree: [UnlistedBlockKind, PhantomBlockKind] extends [
  never,
  never,
]
  ? true
  : never = true;
void blockKindsAgree;

export interface MarkdownToPdfOptions {
  title?: string;
}

interface PdfFonts {
  body: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  italic: PDFFont;
}

interface Cursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  fonts: PdfFonts;
  /** pdf-lib's color factory, threaded so the sync draw helpers stay sync. */
  rgb: (r: number, g: number, b: number) => PdfLibRGB;
  /** What drawing a link needs from pdf-lib (its /URI string), likewise. */
  lib: Pick<PdfLibModule, "PDFString" | "rgb">;
}

export function validateMarkdownInput(markdown: string): void {
  if (markdown.trim().length === 0) {
    throw new PdfEngineError(
      "Add some Markdown or choose a non-empty .md file.",
    );
  }
  const bytes = new TextEncoder().encode(markdown).byteLength;
  if (bytes > MAX_MARKDOWN_BYTES) {
    throw new PdfEngineError(
      `This Markdown file is too large for in-browser conversion (max ${MAX_SOURCE_MB} MB).`,
    );
  }
}

export function markdownPdfOutputName(sourceName: string): string {
  return outputName(sourceName || "markdown", "pdf", "pdf");
}

/* ------------------------------------------------------------------ *
 *  Inline markup
 *
 *  The markup characters are REMOVED; since 2026-11-08 (audit
 *  markdown-to-pdf#6) what they asked for is drawn too, from the styled runs
 *  `renderInline` returns beside the text (bold, italic, code, and the
 *  clickable address of a link — `markdown-runs.ts`). Removal is still where
 *  the one unforgivable outcome lives, a character the user typed going
 *  missing: the previous regex chain unwrapped
 *  code spans first and then ran `_x_` / `*x*` over what they exposed, so
 *  `MAX_UPLOAD_SIZE` printed as MAXUPLOADSIZE, `__init__.py` as init.py and
 *  "2 * 3 * 4" as "2  3  4" — silently, in a tool whose keyword is "readme to
 *  pdf". So this is a small tokenizer that follows CommonMark where it
 *  decides whether a character is markup at all:
 *
 *    1. code spans first (N backticks close on exactly N), contents verbatim;
 *    2. backslash escapes, which make a punctuation mark literal;
 *    3. links and images, printed as "label (url)" — the URL is literal;
 *       so is a bare `https://…` or `www.…` address (GFM autolinks), and so
 *       are reference links (`[label][ref]`, `[ref]`) whose definition the
 *       document holds; a footnote reference (`[^id]`) prints as "[n]";
 *    4. raw HTML as a reader sees it: a comment is hidden, `<br>` breaks the
 *       line, `<img>` prints its alt text and address, `<a href>` its label
 *       and address, and any other KNOWN element's tags are left out with the
 *       text between them kept; an entity (`&amp;`, `&#169;`) is decoded;
 *    5. a hard line break (two trailing spaces, or a trailing backslash);
 *    6. emphasis by the flanking rules: `*` must hug the text it wraps, and
 *       `_` additionally may not be intraword, so snake_case is not markup.
 *
 *  Anything not recognised as markup is printed as typed: an unclosed
 *  comment, an unknown entity (`&bogus;`), a tag name HTML does not have
 *  (`Array<string>`), a reference with no definition. Until audit #11
 *  (2026-11-06) step 4 did not exist, so a private `<!-- TODO -->` printed
 *  into the PDF and `&amp;` printed as typed.
 * ------------------------------------------------------------------ */

/**
 * What the inline layer needs from the whole document: the link reference
 * definitions, and the footnotes with the numbers their first references
 * gave them (in reading order, as GitHub numbers them).
 */
interface InlineContext {
  links: Map<string, string>;
  notes: Map<string, string>;
  noteNumbers: Map<string, number>;
}

const emptyContext = (): InlineContext => ({
  links: new Map(),
  notes: new Map(),
  noteNumbers: new Map(),
});

/** CommonMark's label matching: case-insensitive, whitespace collapsed. */
function referenceKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * HTML's Latin-1 named references, in code-point order from U+00A0: the
 * accented letters Western text uses most (`&eacute;`, `&uuml;`, `&szlig;`).
 * Each code point is DERIVED from its position, never typed, so the table
 * cannot hold one name with a mistyped number. All 96 are WinAnsi-drawable.
 */
const LATIN1_ENTITY_NAMES = (
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy " +
  "reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm " +
  "raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring " +
  "AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde " +
  "Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml " +
  "Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil " +
  "egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve " +
  "oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute " +
  "thorn yuml"
).split(" ");

/** Greek letters, also in code-point order (U+0391 and U+03B1 on). */
const GREEK_UPPER_NAMES = (
  "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi " +
  "Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega"
).split(" ");
const GREEK_LOWER_NAMES = (
  "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi " +
  "omicron pi rho sigmaf sigma tau upsilon phi chi psi omega"
).split(" ");

function namesFrom(names: string[], first: number): [string, number][] {
  // "-" holds a code point that has no name (U+03A2 is unassigned).
  return names.flatMap((name, i) =>
    name === "-" ? [] : [[name, first + i] as [string, number]],
  );
}

/**
 * HTML's named character references: every Latin-1 and Greek name, plus the
 * punctuation, symbols and arrows Markdown sources use. An unknown name
 * prints as typed, which loses nothing.
 */
export const NAMED_ENTITIES: Record<string, number> = {
  ...Object.fromEntries(namesFrom(LATIN1_ENTITY_NAMES, 0xa0)),
  ...Object.fromEntries(namesFrom(GREEK_UPPER_NAMES, 0x391)),
  ...Object.fromEntries(namesFrom(GREEK_LOWER_NAMES, 0x3b1)),
  amp: 0x26,
  lt: 0x3c,
  gt: 0x3e,
  quot: 0x22,
  apos: 0x27,
  OElig: 0x152,
  oelig: 0x153,
  Scaron: 0x160,
  scaron: 0x161,
  Yuml: 0x178,
  Zcaron: 0x17d,
  zcaron: 0x17e,
  fnof: 0x192,
  circ: 0x2c6,
  tilde: 0x2dc,
  ensp: 0x2002,
  emsp: 0x2003,
  thinsp: 0x2009,
  zwnj: 0x200c,
  zwj: 0x200d,
  ndash: 0x2013,
  mdash: 0x2014,
  lsquo: 0x2018,
  rsquo: 0x2019,
  sbquo: 0x201a,
  ldquo: 0x201c,
  rdquo: 0x201d,
  bdquo: 0x201e,
  dagger: 0x2020,
  Dagger: 0x2021,
  bull: 0x2022,
  hellip: 0x2026,
  permil: 0x2030,
  prime: 0x2032,
  Prime: 0x2033,
  lsaquo: 0x2039,
  rsaquo: 0x203a,
  euro: 0x20ac,
  trade: 0x2122,
  larr: 0x2190,
  uarr: 0x2191,
  rarr: 0x2192,
  darr: 0x2193,
  harr: 0x2194,
  lArr: 0x21d0,
  rArr: 0x21d2,
  hArr: 0x21d4,
  minus: 0x2212,
  infin: 0x221e,
  asymp: 0x2248,
  ne: 0x2260,
  le: 0x2264,
  ge: 0x2265,
  check: 0x2713,
};

/**
 * HTML reads a numeric reference in 0x80-0x9F as Windows-1252, so `&#150;`
 * is an en dash. The five slots Windows-1252 leaves empty stay undecoded.
 */
const WINDOWS_1252_C1 = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d,
  0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e,
  0x0178,
];

const ENTITY =
  /^&(?:#[xX]([0-9A-Fa-f]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/;

/** The character an entity at the start of `text` stands for, and its length. */
function matchEntity(text: string): { ch: string; length: number } | null {
  const m = ENTITY.exec(text);
  if (!m) return null;
  let cp: number;
  if (m[3] !== undefined) {
    const named = NAMED_ENTITIES[m[3]];
    if (named === undefined) return null;
    cp = named;
  } else {
    cp = m[1] !== undefined ? parseInt(m[1], 16) : Number(m[2]);
    // A control character has nothing to draw, and refusing the document
    // over an invisible one names a character the reader cannot see: printed
    // as typed instead. 0x80-0x9F are read as Windows-1252, as HTML does.
    if ((cp > 0 && cp < 0x20) || cp === 0x7f) return null;
    if (cp >= 0x80 && cp <= 0x9f) {
      cp = WINDOWS_1252_C1[cp - 0x80]!;
      if (!cp) return null;
    }
    // CommonMark: an invalid or NUL code point becomes U+FFFD.
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      cp = 0xfffd;
    }
  }
  return { ch: String.fromCodePoint(cp), length: m[0].length };
}

/** Every entity in an attribute value, decoded. */
function decodeEntities(text: string): string {
  return text.replace(/&[#A-Za-z0-9]+;/g, (raw) => matchEntity(raw)?.ch ?? raw);
}

/**
 * Element names HTML has: every current one, the obsolete ones READMEs still
 * carry, and the svg and math roots. Only these are read as tags, so
 * `Array<string>`, `<T>` and `<config>` in prose print as typed rather than
 * vanishing. The test checks this against TypeScript's DOM typings, so a
 * name left out here is a failing test, not a tag printed on the page.
 */
const HTML_ELEMENTS = new Set(
  (
    "a abbr address area article aside audio b base bdi bdo blockquote body " +
    "br button canvas caption cite code col colgroup data datalist dd del " +
    "details dfn dialog div dl dt em embed fieldset figcaption figure footer " +
    "form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input " +
    "ins kbd label legend li link main map mark menu meta meter nav noscript " +
    "object ol optgroup option output p picture pre progress q rp rt ruby s " +
    "samp script search section select slot small source span strong style " +
    "sub summary sup table tbody td template textarea tfoot th thead time " +
    "title tr track u ul var video wbr " +
    // Obsolete, still seen in READMEs.
    "acronym applet basefont big blink center dir font frame frameset " +
    "marquee nobr noembed noframes param rb rtc strike tt xmp " +
    "svg math"
  ).split(" "),
);

/** Elements whose content a browser never shows: hidden with it. */
const HIDDEN_CONTENT_ELEMENTS = new Set(["script", "style", "template"]);

/** A line that opens a hidden-content element. */
const HIDDEN_BLOCK = /^<(script|style|template)(?=[\s>]|$)/i;

/** Embedded media: printed as its address, the way an image is. */
const MEDIA_ELEMENTS = new Set(["video", "audio", "source", "iframe", "embed"]);

const OPEN_TAG =
  /^<([A-Za-z][A-Za-z0-9-]*)((?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*)\s*\/?>/;
const CLOSE_TAG = /^<\/([A-Za-z][A-Za-z0-9-]*)\s*>/;
const TAG_ATTRIBUTE =
  /([A-Za-z_:][\w.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function tagAttributes(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of raw.matchAll(TAG_ATTRIBUTE)) {
    const name = m[1]!.toLowerCase();
    if (!out.has(name)) {
      out.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim());
    }
  }
  return out;
}

/** CommonMark's ASCII punctuation: what a backslash may escape. */
const ASCII_PUNCT = /^[!-/:-@[-`{-~]$/;
const UNICODE_PUNCT = /^[\p{P}\p{S}]$/u;

interface InlineUnit {
  ch: string;
  /**
   * `text` may still turn out to be markup; `literal` was escaped, or is part
   * of a URL, and never is; `code` came from a code span and is never touched;
   * `break` is a hard line break, drawn as a new line.
   */
  kind: "text" | "literal" | "code" | "break";
  /** The clickable address this character's link opens (`clickableHref`). */
  href?: string;
}

/** Give `units` (a link's label and printed address) the link's address. */
function linkUnits(units: InlineUnit[], href: string | undefined): void {
  if (href === undefined) return;
  for (const unit of units) {
    if (unit.kind !== "break") unit.href = href;
  }
}

function literalUnits(text: string): InlineUnit[] {
  return Array.from(text, (ch) => ({ ch, kind: "literal" as const }));
}

/** `out.push(...units)` without the spread: a long run overflows the stack. */
function pushAll(out: InlineUnit[], units: InlineUnit[]): void {
  for (const unit of units) out.push(unit);
}

function backtickRun(src: string, at: number): number {
  let n = 0;
  while (src[at + n] === "`") n++;
  return n;
}

/**
 * The longest a link destination or title may run before the tokenizer stops
 * looking for its end. A real URL is far shorter; without a bound, a 2 MB
 * paragraph of `[a](b` repeats is quadratic.
 */
const LINK_SCAN_LIMIT = 4096;

/**
 * One inline source and the facts about it that every scan would otherwise
 * rediscover. Both caches exist for the same reason: a hostile or merely odd
 * paragraph (thousands of unmatched backticks or brackets, up to the 2 MB
 * source cap) must stay linear, not quadratic.
 */
class InlineSource {
  /** For a run length n: from this index on, no closing run of n exists. */
  private readonly noCloserFrom = new Map<number, number>();
  private brackets: Int32Array | null = null;
  /**
   * Characters link destinations may still scan. Each real link is scanned
   * once, so a document never gets near this; `[a](b` repeated 400,000 times
   * re-scans the same tail for every candidate and took 19.5 s before this
   * existed. Once spent, what is left prints as typed — raw markup, never a
   * missing character.
   */
  linkBudget: number;

  /** The last `-->` found, and from where; -1 once none is left. */
  private commentClose = { from: -1, at: -2 };
  /** Per hidden-content element: the last close tag found, and from where. */
  private readonly hiddenClose = new Map<
    string,
    { from: number; at: number; end: number }
  >();

  constructor(readonly src: string) {
    this.linkBudget = src.length * 4 + 65_536;
  }

  /**
   * Index of the first `-->` at or after `from`, or -1. Remembered, so a
   * paragraph of unclosed `<!--` stays linear.
   */
  commentEnd(from: number): number {
    const last = this.commentClose;
    if (last.at === -1 && from >= last.from) return -1;
    if (last.at >= from && from >= last.from) return last.at;
    const at = this.src.indexOf("-->", from);
    this.commentClose = { from, at };
    return at;
  }

  /**
   * Index just past the first `</name>` at or after `from`, or -1.
   * Remembered per name, so a paragraph of unclosed `<script>` stays linear.
   */
  hiddenContentEnd(name: string, from: number): number {
    const last = this.hiddenClose.get(name);
    if (last && from >= last.from && (last.at === -1 || last.at >= from)) {
      return last.end;
    }
    const pattern = new RegExp(`</${name}\\s*>`, "gi");
    pattern.lastIndex = from;
    const m = pattern.exec(this.src);
    const at = m ? m.index : -1;
    const end = m ? m.index + m[0].length : -1;
    this.hiddenClose.set(name, { from, at, end });
    return end;
  }

  /** Index of a backtick run of EXACTLY `n` at or after `from`, or -1. */
  closingBackticks(from: number, n: number): number {
    const known = this.noCloserFrom.get(n);
    if (known !== undefined && from >= known) return -1;
    const { src } = this;
    let i = from;
    while (i < src.length) {
      if (src[i] !== "`") {
        i++;
        continue;
      }
      const run = backtickRun(src, i);
      if (run === n) return i;
      i += run;
    }
    this.noCloserFrom.set(n, Math.min(known ?? from, from));
    return -1;
  }

  /**
   * The `]` that balances the `[` at `open`, or -1. Computed for every bracket
   * in one pass that skips escapes and code spans, so `[a \] b](u)` and
   * `` [`]`](u) `` both find the right `]`.
   */
  bracketClose(open: number): number {
    if (!this.brackets) {
      const { src } = this;
      const close = new Int32Array(src.length).fill(-1);
      const stack: number[] = [];
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === "`") {
          const run = backtickRun(src, i);
          const end = this.closingBackticks(i + run, run);
          i = end >= 0 ? end + run - 1 : i + run - 1;
          continue;
        }
        if (c === "[") stack.push(i);
        else if (c === "]" && stack.length) close[stack.pop()!] = i;
      }
      this.brackets = close;
    }
    return this.brackets[open] ?? -1;
  }
}

function codeSpanBody(raw: string): string {
  const body = raw.replace(/\n/g, " ");
  // One leading and one trailing space are stripped only as a pair, and never
  // from a span that is nothing but spaces (CommonMark 6.1).
  return body.length >= 2 &&
    body.startsWith(" ") &&
    body.endsWith(" ") &&
    body.trim() !== ""
    ? body.slice(1, -1)
    : body;
}

interface LinkMatch {
  label: string;
  url: string;
  end: number;
}

/** `[label](destination "title")` starting at `open`, which is a `[`. */
function matchLink(source: InlineSource, open: number): LinkMatch | null {
  const { src } = source;
  const close = source.bracketClose(open);
  if (close < 0 || src[close + 1] !== "(" || source.linkBudget <= 0) {
    return null;
  }
  const { match, reached } = scanLinkTail(src, open, close);
  source.linkBudget -= reached - close;
  return match;
}

/** `indexOf`, but never looking at or past `limit`. */
function indexBefore(src: string, ch: string, from: number, limit: number) {
  for (let i = from; i < limit; i++) if (src[i] === ch) return i;
  return -1;
}

/** The `(destination "title")` after a label, and how far the scan read. */
function scanLinkTail(
  src: string,
  open: number,
  close: number,
): { match: LinkMatch | null; reached: number } {
  const limit = Math.min(src.length, close + 2 + LINK_SCAN_LIMIT);
  const fail = (reached: number) => ({ match: null, reached });
  let i = close + 2;
  while (src[i] === " " || src[i] === "\n") i++;
  let url = "";
  if (src[i] === "<") {
    const end = indexBefore(src, ">", i + 1, limit);
    if (end < 0) return fail(limit);
    url = src.slice(i + 1, end);
    i = end + 1;
  } else {
    let parens = 0;
    while (i < limit) {
      const c = src[i]!;
      if (c === "\\" && i + 1 < src.length && ASCII_PUNCT.test(src[i + 1]!)) {
        url += src[i + 1];
        i += 2;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === "(") parens++;
      if (c === ")") {
        if (parens === 0) break;
        parens--;
      }
      url += c;
      i++;
    }
  }
  while (src[i] === " " || src[i] === "\n") i++;
  const quote = src[i];
  if (quote === '"' || quote === "'" || quote === "(") {
    const closer = quote === "(" ? ")" : quote;
    const end = indexBefore(src, closer, i + 1, limit);
    if (end < 0) return fail(limit);
    i = end + 1;
    while (src[i] === " " || src[i] === "\n") i++;
  }
  if (src[i] !== ")") return fail(i);
  return {
    match: { label: src.slice(open + 1, close), url, end: i + 1 },
    reached: i + 1,
  };
}

const AUTOLINK =
  /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+)>/;

/** GFM's trailing punctuation: the sentence's, not the address's. */
const URL_TRAILING = "?!.,:*_~";

/**
 * Where a bare address starting at `at` ends, or -1. GFM's autolink extension
 * — what GitHub shows a README reader — takes `https://…` and `www.…` before
 * emphasis is looked for, so `https://x.com/_private_` keeps its underscores.
 * CommonMark alone would print "https://x.com/private": a copied address that
 * no longer works. Any `scheme://` counts, not only GFM's http(s): an address
 * printed as typed can only be wrong by being unstyled, never by a missing
 * character. The address must start a word (after whitespace, `*`, `_`, `~`
 * or `(`), and runs to whitespace, `<` or a code span; trailing punctuation
 * and a `)` with no `(` to match are left to the sentence, as GFM does.
 */
function bareUrlEnd(src: string, at: number): number {
  const before = src[at - 1];
  if (before !== undefined && !/[\s*_~(]/.test(before)) return -1;
  let i = at;
  if (src.startsWith("www.", at)) i += 4;
  else {
    if (!/[A-Za-z]/.test(src[at] ?? "")) return -1;
    while (i - at < 32 && /[A-Za-z0-9+.-]/.test(src[i] ?? "")) i++;
    if (!src.startsWith("://", i)) return -1;
    i += 3;
  }
  const body = i;
  let opens = 0;
  let closes = 0;
  while (i < src.length && !/[\s<`]/.test(src[i]!)) {
    if (src[i] === "(") opens++;
    else if (src[i] === ")") closes++;
    i++;
  }
  while (i > body) {
    const last = src[i - 1]!;
    if (URL_TRAILING.includes(last)) i--;
    else if (last === ")" && closes > opens) {
      closes--;
      i--;
    } else break;
  }
  return i > body ? i : -1;
}

/**
 * How deep link and image labels are read as markup. A badge,
 * `[![alt](img)](url)`, is two; CommonMark allows nothing deeper than an image
 * inside a link. Each level builds its own {@link InlineSource} and a stack
 * frame, so without a bound `"[".repeat(k) + "a" + "](b)".repeat(k)` cost
 * O(k·n) and, at 20 KB, threw "Maximum call stack size exceeded". Past the
 * bound, brackets print as typed: raw markup, never a missing character.
 */
const MAX_LABEL_DEPTH = 3;

/**
 * A link's label and address, as this renderer prints a link: "label (url)",
 * the address alone when there is no label, the label alone when it IS the
 * address. Images cannot be drawn here, so their alt text and address stand
 * in for them — the output stays honest about what was left out.
 */
function pushLink(
  out: InlineUnit[],
  labelSource: string,
  url: string,
  context: InlineContext,
  depth: number,
  /** An image's address is printed, never opened: images are not links. */
  isImage = false,
): void {
  const href = isImage ? undefined : clickableHref(url);
  const label = tokenizeInline(labelSource, context, depth + 1);
  const labelText = label.map((u) => u.ch).join("");
  const printed: InlineUnit[] = [];
  if (!labelText.trim()) pushAll(printed, literalUnits(url));
  else {
    pushAll(printed, label);
    if (labelText.trim() !== url) pushAll(printed, literalUnits(` (${url})`));
  }
  linkUnits(printed, href);
  pushAll(out, printed);
}

/**
 * A reference link or image (`[label][ref]`, `[label][]`, `[label]`) whose
 * label opens at `open`, resolved against the document's definitions; null
 * when it names no definition, so the brackets print as typed.
 */
function matchReference(
  source: InlineSource,
  open: number,
  context: InlineContext,
): { label: string; url: string; end: number } | null {
  if (!context.links.size) return null;
  const { src } = source;
  const close = source.bracketClose(open);
  if (close < 0) return null;
  const label = src.slice(open + 1, close);
  if (src[close + 1] === "[") {
    const refClose = source.bracketClose(close + 1);
    if (refClose >= 0) {
      const ref = src.slice(close + 2, refClose);
      const url = context.links.get(referenceKey(ref.trim() ? ref : label));
      if (url !== undefined) return { label, url, end: refClose + 1 };
    }
  }
  const key = referenceKey(label);
  const url = key ? context.links.get(key) : undefined;
  return url === undefined ? null : { label, url, end: close + 1 };
}

function tokenizeInline(
  src: string,
  context: InlineContext,
  depth = 0,
): InlineUnit[] {
  const source = new InlineSource(src);
  const out: InlineUnit[] = [];
  // The open `<a>` tag: the address to print after its label, and where the
  // label began. One at a time, as in a browser, where an `<a>` closes the
  // one still open. Until the audit #11 review this was a stack, and every
  // `</a>` re-read its whole label, nested ones included: 40,000 nested
  // anchors (560 KB) took 78.5 s.
  let anchor: { href: string; at: number } | null = null;
  const closeAnchor = () => {
    const open = anchor;
    anchor = null;
    if (!open?.href) return;
    // Each unit is read by at most one anchor, so this stays linear.
    const label = out
      .slice(open.at)
      .map((u) => u.ch)
      .join("")
      .trim();
    if (!label) pushAll(out, literalUnits(open.href));
    else if (label !== open.href) {
      pushAll(out, literalUnits(` (${open.href})`));
    }
    const href = clickableHref(open.href);
    if (href !== undefined) linkUnits(out.slice(open.at), href);
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") {
      const next = src[i + 1];
      if (next !== undefined && ASCII_PUNCT.test(next)) {
        out.push({ ch: next, kind: "literal" });
        i += 2;
        continue;
      }
      if (next === "\n") {
        // A hard line break. Until audit #11 this was a space ("this renderer
        // reflows paragraphs"), and addresses and signatures ran together.
        out.push({ ch: "\n", kind: "break" });
        i += 2;
        continue;
      }
    }
    if (c === " ") {
      // Two or more spaces before a line end: a hard line break. Any other run
      // is pushed whole, so a long run of spaces is not rescanned per space.
      let j = i;
      while (src[j] === " ") j++;
      if (j - i >= 2 && src[j] === "\n") {
        out.push({ ch: "\n", kind: "break" });
        i = j + 1;
      } else {
        for (; i < j; i++) out.push({ ch: " ", kind: "text" });
      }
      continue;
    }
    if (c === "&") {
      const entity = matchEntity(src.slice(i, i + 40));
      if (entity) {
        // Literal: `&#42;` is an asterisk, never emphasis.
        out.push({ ch: entity.ch, kind: "literal" });
        i += entity.length;
        continue;
      }
    }
    if (c === "`") {
      const run = backtickRun(src, i);
      const end = source.closingBackticks(i + run, run);
      if (end >= 0) {
        for (const ch of codeSpanBody(src.slice(i + run, end))) {
          out.push({ ch, kind: "code" });
        }
        i = end + run;
      } else {
        pushAll(out, literalUnits("`".repeat(run)));
        i += run;
      }
      continue;
    }
    if (c === "[" && src[i + 1] === "^" && context.notes.size) {
      const close = source.bracketClose(i);
      const key = close > 0 ? referenceKey(src.slice(i + 2, close)) : "";
      if (key && context.notes.has(key)) {
        let n = context.noteNumbers.get(key);
        if (n === undefined) {
          n = context.noteNumbers.size + 1;
          context.noteNumbers.set(key, n);
        }
        pushAll(out, literalUnits(`[${n}]`));
        i = close + 1;
        continue;
      }
    }
    const isImage = c === "!" && src[i + 1] === "[";
    if ((c === "[" || isImage) && depth < MAX_LABEL_DEPTH) {
      const open = isImage ? i + 1 : i;
      const link =
        matchLink(source, open) ?? matchReference(source, open, context);
      if (link) {
        pushLink(out, link.label, link.url, context, depth, isImage);
        i = link.end;
        continue;
      }
    }
    if (c === "<") {
      const window = src.slice(i, i + LINK_SCAN_LIMIT);
      const auto = AUTOLINK.exec(window);
      if (auto) {
        const units = literalUnits(auto[1]!);
        linkUnits(units, clickableHref(auto[1]!));
        pushAll(out, units);
        i += auto[0].length;
        continue;
      }
      if (src.startsWith("<!--", i)) {
        // A comment is hidden, as every Markdown renderer hides it. Unclosed,
        // it prints as typed: nothing the user wrote goes missing silently.
        const end = source.commentEnd(i + 4);
        if (end >= 0) {
          i = end + 3;
          continue;
        }
      }
      const tag = OPEN_TAG.exec(window) ?? CLOSE_TAG.exec(window);
      const name = tag?.[1]!.toLowerCase();
      const closing = tag?.[0][1] === "/";
      if (tag && name && HIDDEN_CONTENT_ELEMENTS.has(name) && !closing) {
        // Hidden with its content, as a browser hides it. Unclosed, it prints
        // as typed, like an unclosed comment.
        const end = source.hiddenContentEnd(name, i + tag[0].length);
        if (end >= 0) {
          i = end;
          continue;
        }
      } else if (tag && name && HTML_ELEMENTS.has(name)) {
        i += tag[0].length;
        if (closing) {
          if (name === "a") closeAnchor();
          continue;
        }
        const attributes = tagAttributes(tag[2] ?? "");
        if (name === "br") out.push({ ch: "\n", kind: "break" });
        else if (name === "a") {
          closeAnchor();
          anchor = { href: attributes.get("href") ?? "", at: out.length };
        } else if (MEDIA_ELEMENTS.has(name)) {
          pushAll(out, literalUnits(attributes.get("src") ?? ""));
        } else if (
          name === "input" &&
          attributes.get("type")?.toLowerCase() === "checkbox"
        ) {
          pushAll(out, literalUnits(attributes.has("checked") ? "[x]" : "[ ]"));
        } else if (name === "img") {
          const alt = attributes.get("alt") ?? "";
          const imageSrc = attributes.get("src") ?? "";
          const shown = alt
            ? imageSrc && imageSrc !== alt
              ? `${alt} (${imageSrc})`
              : alt
            : imageSrc;
          pushAll(out, literalUnits(shown));
        }
        continue;
      }
    }
    const url = bareUrlEnd(src, i);
    if (url > i) {
      const units = literalUnits(src.slice(i, url));
      linkUnits(units, clickableHref(src.slice(i, url)));
      pushAll(out, units);
      i = url;
      continue;
    }
    const cp = src.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    out.push({ ch, kind: "text" });
    i += ch.length;
  }
  // An `<a>` never closed still prints its address: nothing goes missing.
  closeAnchor();
  return out;
}

type CharClass = "space" | "punct" | "other";

function classify(unit: InlineUnit | undefined): CharClass {
  if (!unit) return "space";
  // A code span reads as content to its neighbours: `*`code`*` is emphasis.
  if (unit.kind === "code") return "other";
  if (/\s/u.test(unit.ch)) return "space";
  if (UNICODE_PUNCT.test(unit.ch)) return "punct";
  return "other";
}

interface Delimiter {
  ch: "*" | "_" | "~";
  start: number;
  length: number;
  remaining: number;
  canOpen: boolean;
  canClose: boolean;
}

/**
 * CommonMark's delimiter-run algorithm (6.2), reduced to what a renderer that
 * removes emphasis needs: decide WHICH `*`, `_` and `~` characters are markup,
 * and mark only those for removal. Plus GFM strikethrough, `~~` only.
 */
function markEmphasis(units: InlineUnit[]): {
  removed: Uint8Array;
  styles: Uint8Array;
} {
  const removed = new Uint8Array(units.length);
  // What each character is wrapped in: BOLD and ITALIC from the pairs found.
  const styles = new Uint8Array(units.length);
  const delimiters: Delimiter[] = [];
  for (let i = 0; i < units.length;) {
    const unit = units[i]!;
    if (
      unit.kind !== "text" ||
      (unit.ch !== "*" && unit.ch !== "_" && unit.ch !== "~")
    ) {
      i++;
      continue;
    }
    let j = i;
    while (
      j < units.length &&
      units[j]!.kind === "text" &&
      units[j]!.ch === unit.ch
    ) {
      j++;
    }
    const before = classify(units[i - 1]);
    const after = classify(units[j]);
    const left = after !== "space" && (after !== "punct" || before !== "other");
    const right =
      before !== "space" && (before !== "punct" || after !== "other");
    let canOpen = left;
    let canClose = right;
    if (unit.ch === "_") {
      canOpen = left && (!right || before === "punct");
      canClose = right && (!left || after === "punct");
    }
    // Only `~~` is strikethrough here. GFM also accepts a single `~`, and that
    // is how "ABC~1\x~2" would lose both tildes; a lone tilde is far more
    // often a path, a home directory or "about" than markup.
    if (unit.ch === "~" && j - i !== 2) canOpen = canClose = false;
    delimiters.push({
      ch: unit.ch,
      start: i,
      length: j - i,
      remaining: j - i,
      canOpen,
      canClose,
    });
    i = j;
  }

  const stack: Delimiter[] = [];
  // openers_bottom: for each kind of closer, how far down the stack a failed
  // search already looked. Keeps the pass linear on hostile input.
  const bottom = new Map<string, number>();
  for (const closer of delimiters) {
    if (closer.canClose) {
      const key = `${closer.ch}${closer.canOpen ? 1 : 0}${closer.length % 3}${
        closer.ch === "~" ? closer.length : ""
      }`;
      while (closer.remaining > 0) {
        let found = -1;
        for (let s = stack.length - 1; s >= (bottom.get(key) ?? 0); s--) {
          const opener = stack[s]!;
          if (opener.ch !== closer.ch) continue;
          if (closer.ch === "~") {
            if (opener.remaining !== closer.remaining) continue;
          } else if (
            (opener.canClose || closer.canOpen) &&
            (opener.length + closer.length) % 3 === 0 &&
            !(opener.length % 3 === 0 && closer.length % 3 === 0)
          ) {
            continue;
          }
          found = s;
          break;
        }
        if (found < 0) {
          bottom.set(key, stack.length);
          break;
        }
        const opener = stack[found]!;
        const use =
          closer.ch === "~"
            ? closer.remaining
            : opener.remaining >= 2 && closer.remaining >= 2
              ? 2
              : 1;
        if (closer.ch !== "~") {
          const from = opener.start + opener.remaining;
          const to = closer.start + (closer.length - closer.remaining);
          for (let k = from; k < to; k++) {
            styles[k] = styles[k]! | (use === 2 ? BOLD : ITALIC);
          }
        }
        for (let k = 0; k < use; k++) {
          removed[opener.start + opener.remaining - 1 - k] = 1;
          removed[closer.start + (closer.length - closer.remaining) + k] = 1;
        }
        opener.remaining -= use;
        closer.remaining -= use;
        // Delimiters between the pair can no longer match anything.
        stack.length = opener.remaining > 0 ? found + 1 : found;
        for (const [k, v] of bottom) {
          if (v > stack.length) bottom.set(k, stack.length);
        }
      }
    }
    if (closer.canOpen && closer.remaining > 0) stack.push(closer);
  }
  return { removed, styles };
}

/**
 * Inline Markdown to the plain text this renderer draws. Whitespace outside
 * code spans collapses to single spaces (the block is reflowed anyway);
 * inside a code span it is kept as typed, and so is a no-break space typed as
 * `&nbsp;`. A hard line break is the one `\n` the text can hold; the drawing
 * code starts a new line there.
 */
function stripInlineMarkdown(
  input: string,
  context: InlineContext = emptyContext(),
): string {
  return renderInline(input, context).text;
}

/**
 * {@link stripInlineMarkdown}'s text, and the same text as styled runs: what
 * the emphasis around each character asked for (bold, italic), code spans,
 * and the clickable address of each link. `runs` joined is exactly `text`.
 */
function renderInline(
  input: string,
  context: InlineContext = emptyContext(),
): { text: string; runs: InlineRun[] } {
  const units = tokenizeInline(input, context);
  const { removed, styles } = markEmphasis(units);
  const runs: InlineRun[] = [];
  const append = (ch: string, style: number, href?: string) => {
    const last = runs.at(-1);
    if (last && last.style === style && last.href === href) last.text += ch;
    else
      runs.push(
        href === undefined ? { text: ch, style } : { text: ch, style, href },
      );
  };
  let lastWasSpace = true;
  units.forEach((unit, index) => {
    if (removed[index]) return;
    if (unit.kind === "break") {
      const last = runs.at(-1);
      if (last?.text.endsWith(" ")) last.text = last.text.slice(0, -1);
      append("\n", 0);
      lastWasSpace = true;
      return;
    }
    const style = (unit.kind === "code" ? CODE : 0) | styles[index]!;
    if (
      unit.kind !== "code" &&
      !(unit.kind === "literal" && unit.ch === "\u00A0") &&
      /\s/u.test(unit.ch)
    ) {
      if (!lastWasSpace) append(" ", style, unit.href);
      lastWasSpace = true;
      return;
    }
    append(unit.ch, style, unit.href);
    lastWasSpace = false;
  });
  const full = runs.map((run) => run.text).join("");
  const text = full.trim();
  const start = full.length - full.trimStart().length;
  return { text, runs: sliceRuns(runs, start, start + text.length) };
}

/** `runs` cut to the characters `[start, end)` of their joined text. */
function sliceRuns(runs: InlineRun[], start: number, end: number): InlineRun[] {
  const out: InlineRun[] = [];
  let at = 0;
  for (const run of runs) {
    const from = Math.max(start, at);
    const to = Math.min(end, at + run.text.length);
    if (to > from)
      out.push({ ...run, text: run.text.slice(from - at, to - at) });
    at += run.text.length;
  }
  return out.filter((run) => run.text.length > 0);
}

/**
 * The styled runs of a block's text, kept beside the block rather than in it:
 * `MarkdownBlock` is the parse result tests compare whole, and the runs are a
 * drawing detail. Set for paragraphs, list items and quotes; a block with no
 * entry, or with runs that carry no style or link, is drawn as plain text.
 */
const BLOCK_RUNS = new WeakMap<MarkdownBlock, InlineRun[]>();

/**
 * A heading's runs: its links and nothing else. A heading is drawn in its one
 * bold face, so bold, italic and code are dropped and only each link's
 * address is kept; that is what makes a heading's link open and take the
 * link colour. Until the markdown-to-pdf#6 review headings had no runs, so a
 * link in one printed its address but did not open.
 */
function headingRuns(runs: InlineRun[]): InlineRun[] {
  return runs.map((run) =>
    run.href === undefined
      ? { text: run.text, style: 0 }
      : { text: run.text, style: 0, href: run.href },
  );
}

/** The runs {@link drawBlock} draws `block` from, if it has any. */
export function blockRuns(
  block: MarkdownBlock,
): readonly InlineRun[] | undefined {
  return BLOCK_RUNS.get(block);
}

/* ------------------------------------------------------------------ *
 *  Blocks
 * ------------------------------------------------------------------ */

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const THEMATIC_BREAK = /^([-*_])(?:[ ]*\1){2,}[ ]*$/;
const SETEXT_1 = /^=+[ ]*$/;
const SETEXT_2 = /^-+[ ]*$/;
const ATX_HEADING = /^(#{1,6})(?:[ ]+(.*?))?(?:[ ]+#+)?[ ]*$/;
const BULLET_ITEM = /^([-*+])([ ]+)(.*)$/;
const ORDERED_ITEM = /^(\d{1,9})([.)])([ ]+)(.*)$/;
const QUOTE_LINE = /^>[ ]?(.*)$/;
const TABLE_DELIMITER = /^\|?[ ]*:?-+:?[ ]*(?:\|[ ]*:?-+:?[ ]*)*\|?$/;

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function stripIndent(line: string, n: number): string {
  return line.slice(Math.min(n, leadingSpaces(line)));
}

/**
 * GFM table cells: split on pipes that are not escaped. A leading and a
 * trailing pipe are optional and do not make empty cells. `\|` is a literal
 * pipe, even inside a code span (GFM 4.10).
 */
function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === "\\" && row[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (c === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  cells.push(current.trim());
  return cells;
}

function tableAlign(cell: string): TableAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : "left";
}

interface ListFrame {
  indent: number;
  /** Column where the item's text starts; a child must be indented this far. */
  content: number;
  /** The item's list type and number, so a sibling can count on from it. */
  ordered: boolean;
  delimiter: string;
  index: number;
}

/** `[label]: destination "optional title"`, at most three spaces in. */
const LINK_DEFINITION =
  /^ {0,3}\[((?:[^\]\\]|\\.){1,999})\]:[ ]*(?:<([^<>\n]*)>|(\S+))(?:[ ]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ ]*$/;
/** `[^id]: note text`, GFM's footnote definition. */
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ ]*(.*)$/;

/**
 * Collect the document's link reference and footnote definitions, which may
 * sit after the text that uses them, and return the lines they occupy so the
 * block pass skips them. Fenced code is skipped, and a definition cannot
 * interrupt a paragraph (CommonMark 4.7), so it must follow a blank line, the
 * start, a heading, a rule or another definition. The first definition of a
 * label wins.
 */
function collectDefinitions(
  lines: string[],
  start: number,
  context: InlineContext,
): Set<number> {
  const taken = new Set<number>();
  let fence: string | null = null;
  let mayDefine = true;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = FENCE_OPEN.exec(line)?.[2];
    if (fence) {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) {
        fence = null;
        mayDefine = true;
      }
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    if (!line.trim()) {
      mayDefine = true;
      continue;
    }
    if (mayDefine) {
      const note = FOOTNOTE_DEFINITION.exec(line);
      if (note) {
        const body = [note[2]!];
        taken.add(i);
        // Continuation lines are indented under the definition.
        while (
          i + 1 < lines.length &&
          lines[i + 1]!.trim() &&
          leadingSpaces(lines[i + 1]!) >= 2
        ) {
          i++;
          body.push(lines[i]!.trim());
          taken.add(i);
        }
        const key = referenceKey(note[1]!);
        if (!context.notes.has(key)) context.notes.set(key, body.join("\n"));
        continue;
      }
      const link = LINK_DEFINITION.exec(line);
      if (link && link[1]!.trim() && !link[1]!.startsWith("^")) {
        taken.add(i);
        const key = referenceKey(link[1]!);
        if (!context.links.has(key)) {
          context.links.set(key, link[2] ?? link[3] ?? "");
        }
        continue;
      }
    }
    const trimmed = line.trim();
    mayDefine = ATX_HEADING.test(trimmed) || THEMATIC_BREAK.test(trimmed);
  }
  return taken;
}

/**
 * How deep `>` quotes are read as containers. Each level parses its content
 * again, so without a bound a line of 100,000 `>` would recurse that deep;
 * past the bound the rest prints as one quote with its markers as typed.
 */
const MAX_QUOTE_DEPTH = 8;

/** GitHub's alert callouts: `> [!NOTE]` opens a titled quote. */
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \n]+|$)/i;

/**
 * A quote's content as quote blocks. The content was parsed as Markdown in its
 * own right (CommonMark block quotes are containers), so a list keeps its
 * items, a nested quote its depth and a second paragraph its break; each is
 * drawn as a quote line. Until audit #11 the content was flattened into one
 * run of text: "> - alpha\n> - beta" printed "- alpha - beta".
 */
function quoteBlocks(inner: MarkdownBlock[], depth: number): MarkdownBlock[] {
  const out: MarkdownBlock[] = [];
  const quote = (text: string, level = depth, runs?: InlineRun[]) => {
    if (text) {
      const block: MarkdownBlock =
        level > 1
          ? { kind: "quote", text, depth: level }
          : { kind: "quote", text };
      if (runs) BLOCK_RUNS.set(block, runs);
      out.push(block);
    }
  };
  inner.forEach((block, index) => {
    switch (block.kind) {
      case "quote":
        quote(block.text, depth + (block.depth ?? 1), BLOCK_RUNS.get(block));
        return;
      case "list-item": {
        const prefix = `${"  ".repeat(block.depth)}${block.continued ? "  " : `${listMarker(block)} `}`;
        const runs = BLOCK_RUNS.get(block);
        quote(
          `${prefix}${block.text}`,
          depth,
          runs && [{ text: prefix, style: 0 }, ...runs],
        );
        return;
      }
      case "table":
        quote(
          [block.header, ...block.rows]
            .map((row) => row.join(" | "))
            .join("\n"),
        );
        return;
      case "rule":
        return;
      case "paragraph": {
        const alert = index === 0 ? ALERT.exec(block.text) : null;
        if (alert) {
          const name = alert[1]!.toLowerCase();
          quote(name[0]!.toUpperCase() + name.slice(1));
          // The callout's text keeps its runs (bold, links). Until the
          // markdown-to-pdf#6 review it was passed as bare text, so a link
          // in a [!NOTE] printed but did not open.
          const runs = BLOCK_RUNS.get(block);
          quote(
            block.text.slice(alert[0].length),
            depth,
            runs && sliceRuns(runs, alert[0].length, block.text.length),
          );
          return;
        }
        quote(block.text, depth, BLOCK_RUNS.get(block));
        return;
      }
      default:
        quote(block.text);
    }
  });
  return out;
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];

  // YAML front matter is metadata no Markdown renderer shows as prose. Printed
  // as a code block it stays visible and verbatim; parsed as Markdown its
  // fences would become a rule and a setext heading.
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex(
      (line, index) =>
        index > 0 && (line.trim() === "---" || line.trim() === "..."),
    );
    // Only when it reads as YAML: a document may also simply open with a rule.
    if (end > 1 && /^[\w-]+[ ]*:/.test(lines[1]!.trim())) {
      blocks.push({ kind: "code", text: lines.slice(1, end).join("\n") });
      start = end + 1;
    }
  }

  const context = emptyContext();
  const definitions = collectDefinitions(lines, start, context);
  for (const block of parseBlocks(lines, start, context, definitions, 1)) {
    blocks.push(block);
  }

  // Footnotes, as GitHub prints them: after a rule at the end, numbered in the
  // order the text first refers to them. A definition nothing refers to still
  // prints, after those, so no text the user wrote goes missing.
  if (context.notes.size) {
    for (const key of context.notes.keys()) {
      if (!context.noteNumbers.has(key)) {
        context.noteNumbers.set(key, context.noteNumbers.size + 1);
      }
    }
    blocks.push({ kind: "rule" });
    const ordered = [...context.noteNumbers].sort((a, b) => a[1] - b[1]);
    for (const [key, index] of ordered) {
      blocks.push({
        kind: "list-item",
        ordered: true,
        index,
        depth: 0,
        text: stripInlineMarkdown(context.notes.get(key) ?? "", context),
      });
    }
  }
  return blocks;
}

function parseBlocks(
  lines: string[],
  start: number,
  context: InlineContext,
  skip: ReadonlySet<number>,
  quoteDepth: number,
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const inline = (text: string) => stripInlineMarkdown(text, context);
  const inlineRuns = (text: string) => renderInline(text, context);

  // Text is collected raw and rendered once per block, so emphasis and code
  // spans that run across a line break still pair up.
  let paragraph: string[] = [];
  let quote: string[] | null = null;
  let item: {
    block: MarkdownBlock & { kind: "list-item" };
    lines: string[];
  } | null = null;
  let list: ListFrame[] = [];
  let previousBlank = true;
  // A search for `-->` from this line found none, so later ones cannot.
  let noCommentCloseFrom = Infinity;
  // The same, per hidden-content element (`</script>`, `</style>`...).
  const noHiddenCloseFrom = new Map<string, number>();

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const { text, runs } = inlineRuns(paragraph.join("\n"));
    if (text) {
      const block: MarkdownBlock = { kind: "paragraph", text };
      BLOCK_RUNS.set(block, runs);
      blocks.push(block);
    }
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote) return;
    const source = quote;
    quote = null;
    if (quoteDepth >= MAX_QUOTE_DEPTH) {
      const text = inline(source.join("\n"));
      if (text) blocks.push({ kind: "quote", text });
      return;
    }
    const inner = parseBlocks(source, 0, context, new Set(), quoteDepth + 1);
    for (const block of quoteBlocks(inner, 1)) blocks.push(block);
  };
  const flushItem = () => {
    if (!item) return;
    const { text, runs } = inlineRuns(item.lines.join("\n"));
    item.block.text = text;
    BLOCK_RUNS.set(item.block, runs);
    item = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushItem();
  };
  const closeList = () => {
    flushItem();
    list = [];
  };

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const indent = leadingSpaces(raw);
    // Two trailing spaces are a hard line break (CommonMark 6.7); `trim` would
    // drop them before the inline pass could see them.
    const text = / {2,}$/.test(raw) && trimmed ? `${trimmed}  ` : trimmed;

    if (!trimmed || skip.has(i)) {
      flushParagraph();
      flushQuote();
      previousBlank = true;
      continue;
    }

    const fence = FENCE_OPEN.exec(raw);
    if (fence && !(fence[2]![0] === "`" && fence[3]!.includes("`"))) {
      flushAll();
      if (indent < (list.at(-1)?.content ?? 0)) list = [];
      const marker = fence[2]!;
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const close = FENCE_CLOSE.exec(lines[j]!);
        // Same character, at least as long: a ``` line inside a ~~~ block
        // (or a shorter run) is content.
        if (
          close &&
          close[1]![0] === marker[0] &&
          close[1]!.length >= marker.length
        ) {
          break;
        }
        body.push(stripIndent(lines[j]!, indent));
      }
      blocks.push({
        kind: "code",
        language: fence[3]!.trim().split(/\s+/)[0] || undefined,
        text: body.join("\n"),
      });
      i = j;
      previousBlank = false;
      continue;
    }

    const inList = list.length > 0;

    // Indented code: only where it cannot be a paragraph continuation or part
    // of a list item.
    if (indent >= 4 && !paragraph.length && !quote && !inList) {
      const body: string[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        const line = lines[j]!;
        if (line.trim() && leadingSpaces(line) < 4) break;
        body.push(line.trim() ? line.slice(4) : "");
      }
      while (body.length && !body.at(-1)!.trim()) body.pop();
      blocks.push({ kind: "code", text: body.join("\n") });
      i = j - 1;
      previousBlank = false;
      continue;
    }

    // An HTML comment that runs over several lines is hidden whole, blank
    // lines inside it too (CommonMark HTML block 2). One that closes on its
    // own line is left to the inline pass; one that never closes prints.
    if (indent <= 3 && trimmed.startsWith("<!--") && !quote) {
      const sameLine = trimmed.indexOf("-->", 4);
      let close = -1;
      if (sameLine < 0 && i + 1 < noCommentCloseFrom) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j]!.includes("-->")) {
            close = j;
            break;
          }
        }
        if (close < 0) noCommentCloseFrom = i + 1;
      }
      if (close > i) {
        flushParagraph();
        const rest = lines[close]!.slice(lines[close]!.indexOf("-->") + 3);
        // What follows `-->` on its line is read as the next line. The array
        // is this parse's own (a split of the source, or a quote's content).
        lines[close] = rest;
        i = close - 1;
        previousBlank = true;
        continue;
      }
    }

    // A <script>, <style> or <template> that runs over several lines is
    // hidden whole, blank lines inside it too (CommonMark HTML block 1), as a
    // browser hides it. One that closes on its own line is left to the inline
    // pass; one that never closes prints.
    const hiddenOpen = indent <= 3 && !quote && HIDDEN_BLOCK.exec(trimmed);
    if (hiddenOpen) {
      const name = hiddenOpen[1]!.toLowerCase();
      const closer = new RegExp(`</${name}\\s*>`, "i");
      let close = -1;
      const searched = noHiddenCloseFrom.get(name) ?? Infinity;
      if (!closer.test(trimmed) && i + 1 < searched) {
        for (let j = i + 1; j < lines.length; j++) {
          if (closer.test(lines[j]!)) {
            close = j;
            break;
          }
        }
        if (close < 0) noHiddenCloseFrom.set(name, i + 1);
      }
      if (close > i) {
        flushParagraph();
        const last = lines[close]!;
        const m = closer.exec(last)!;
        lines[close] = last.slice(m.index + m[0].length);
        i = close - 1;
        previousBlank = true;
        continue;
      }
    }

    // Setext headings take the paragraph above them. Checked before the
    // thematic break, because `Title\n---` is a heading, not a rule.
    if (paragraph.length && indent <= 3) {
      const level = SETEXT_1.test(trimmed) ? 1 : SETEXT_2.test(trimmed) ? 2 : 0;
      if (level) {
        const { text: heading, runs } = inlineRuns(paragraph.join("\n"));
        paragraph = [];
        if (heading) {
          const block: MarkdownBlock = {
            kind: "heading",
            depth: level as 1 | 2,
            text: heading,
          };
          BLOCK_RUNS.set(block, headingRuns(runs));
          blocks.push(block);
        }
        previousBlank = false;
        continue;
      }
    }

    // Before the bullet test, so `* * *` is a rule and not an empty bullet.
    if (THEMATIC_BREAK.test(trimmed)) {
      flushAll();
      closeList();
      blocks.push({ kind: "rule" });
      previousBlank = false;
      continue;
    }

    const heading = ATX_HEADING.exec(trimmed);
    if (heading) {
      flushAll();
      closeList();
      const { text: headingText, runs } = inlineRuns(heading[2] ?? "");
      if (headingText) {
        const block: MarkdownBlock = {
          kind: "heading",
          depth: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
          text: headingText,
        };
        BLOCK_RUNS.set(block, headingRuns(runs));
        blocks.push(block);
      }
      previousBlank = false;
      continue;
    }

    // A GFM table: a row with a pipe, then a delimiter row with as many cells.
    const next = lines[i + 1]?.trim() ?? "";
    if (
      trimmed.includes("|") &&
      next.includes("|") &&
      next.includes("-") &&
      TABLE_DELIMITER.test(next)
    ) {
      const header = splitTableRow(trimmed);
      const delimiter = splitTableRow(next);
      if (header.length === delimiter.length) {
        flushAll();
        closeList();
        const width = header.length;
        const rows: string[][] = [];
        let j = i + 2;
        for (; j < lines.length; j++) {
          const line = lines[j]!.trim();
          // GFM ends a table at a blank line or at the start of any other
          // block, pipes or not: `- a | b` is a list item, not a row.
          if (
            !line ||
            QUOTE_LINE.test(line) ||
            ATX_HEADING.test(line) ||
            FENCE_OPEN.test(lines[j]!) ||
            THEMATIC_BREAK.test(line) ||
            BULLET_ITEM.test(line) ||
            ORDERED_ITEM.test(line)
          ) {
            break;
          }
          // Short rows are padded and long ones cut, as GFM does.
          const cells = splitTableRow(line).slice(0, width);
          while (cells.length < width) cells.push("");
          rows.push(cells.map(inline));
        }
        blocks.push({
          kind: "table",
          align: delimiter.map(tableAlign),
          header: header.map(inline),
          rows,
        });
        i = j - 1;
        previousBlank = false;
        continue;
      }
    }

    if (QUOTE_LINE.test(trimmed)) {
      if (!quote) {
        flushParagraph();
        flushItem();
        closeList();
        quote = [];
      }
      // The content keeps its own indentation and blank lines: it is parsed
      // as Markdown again when the quote closes.
      quote.push(raw.trimStart().replace(/^>[ ]?/, ""));
      previousBlank = false;
      continue;
    }

    const bullet = BULLET_ITEM.exec(trimmed);
    const ordered = bullet ? null : ORDERED_ITEM.exec(trimmed);
    if (bullet || ordered) {
      flushAll();
      // A child starts at or past its parent's text column; anything shallower
      // closes the frames it is not inside. The last frame closed at this
      // depth is the previous item of the same list, if there is one.
      let sibling: ListFrame | undefined;
      while (list.length && indent < list.at(-1)!.content) sibling = list.pop();
      const markerWidth = bullet ? bullet[1]!.length : ordered![1]!.length + 1;
      const gap = (bullet ? bullet[2]! : ordered![3]!).length;
      const delimiter = bullet ? bullet[1]! : ordered![2]!;
      // Only the first item's number counts; the rest count on from it
      // (CommonMark 5.3), so "1. 1. 1." prints 1, 2, 3. Until audit #11 each
      // item printed the number typed on it.
      const index =
        ordered && sibling?.ordered && sibling.delimiter === delimiter
          ? sibling.index + 1
          : Number(ordered?.[1] ?? 0);
      list.push({
        indent,
        content: indent + markerWidth + (gap > 4 ? 1 : gap),
        ordered: Boolean(ordered),
        delimiter,
        index,
      });
      const block: MarkdownBlock & { kind: "list-item" } = bullet
        ? {
            kind: "list-item",
            ordered: false,
            depth: list.length - 1,
            text: "",
          }
        : {
            kind: "list-item",
            ordered: true,
            index,
            depth: list.length - 1,
            text: "",
          };
      blocks.push(block);
      const first = bullet ? bullet[3]! : ordered![4]!;
      item = { block, lines: [first + text.slice(trimmed.length)] };
      previousBlank = false;
      continue;
    }

    if (quote && !previousBlank) {
      // Lazy continuation of the quote's paragraph.
      quote.push(text);
      continue;
    }

    if (inList) {
      // Directly under an item's text, or indented to its text column after a
      // blank line: the item continues. Otherwise the list is over.
      const continues =
        (!previousBlank && !paragraph.length) ||
        (previousBlank && indent >= list.at(-1)!.content);
      if (continues && item && previousBlank) {
        // A second paragraph of the item: drawn under its text, without a
        // marker. Until audit #11 it was run into the item's first line.
        const parent: MarkdownBlock & { kind: "list-item" } = item.block;
        const isOrdered: boolean = parent.ordered;
        const depth: number = parent.depth;
        flushItem();
        const block: MarkdownBlock & { kind: "list-item" } = isOrdered
          ? {
              kind: "list-item",
              ordered: true,
              index: list.at(-1)!.index,
              depth,
              continued: true,
              text: "",
            }
          : {
              kind: "list-item",
              ordered: false,
              depth,
              continued: true,
              text: "",
            };
        blocks.push(block);
        item = { block, lines: [text] };
        previousBlank = false;
        continue;
      }
      if (continues && item) {
        item.lines.push(text);
        previousBlank = false;
        continue;
      }
      if (continues && !item) {
        // The item's text was already closed (a fence inside the item, say);
        // keep the prose in the item's column as a paragraph of its own.
        paragraph.push(text);
        previousBlank = false;
        continue;
      }
      if (!continues) closeList();
    }

    flushQuote();
    flushItem();
    paragraph.push(text);
    previousBlank = false;
  }

  flushAll();
  return blocks;
}

/* ------------------------------------------------------------------ *
 *  Drawing
 * ------------------------------------------------------------------ */

function listMarker(block: MarkdownBlock & { kind: "list-item" }): string {
  return block.ordered ? `${block.index ?? 1}.` : "•";
}

/**
 * Wrapped lines for a block's text. A hard line break is the one newline
 * block text can hold, and each one starts a new line.
 */
function wrapBlockText(
  text: string,
  font: PDFFont,
  maxWidth: number,
  size: number,
): string[] {
  return text
    .split("\n")
    .flatMap((line) => wrapTextLine(line, font, maxWidth, size));
}

/**
 * Every string this renderer will hand to `drawText`, including the decorations
 * it invents.
 *
 * Kept next to {@link drawBlock} and mirroring its cases on purpose: a new block
 * kind that draws a new marker has to be added in both, and the two sitting
 * together is the cheapest way to make that obvious. Two tests pin it, each by
 * proving the glyphs in the output PDF, and each for ONE decoration: the bullet
 * ("markdown picks a face that can draw the bullet it invents", in
 * `unicode-font.test.ts`) and table cells ("a table in a script only its cells
 * use still gets a face that can draw it", here). Nothing checks the corpus
 * against every string the PDF shows, so a new decoration is covered only if
 * it is added here by hand.
 */
function drawnStrings(blocks: MarkdownBlock[], title: string): string[] {
  const out = [title, ELLIPSIS];
  for (const block of blocks) {
    switch (block.kind) {
      case "list-item":
        out.push(
          block.continued ? block.text : `${listMarker(block)} ${block.text}`,
        );
        continue;
      case "code":
        if (block.language) out.push(block.language);
        out.push(block.text);
        continue;
      case "table":
        // Cell by cell, never `push(...cells)`: a table at the source cap has
        // hundreds of thousands of cells, and a spread passes each one as an
        // argument on the stack.
        for (const cell of block.header) out.push(cell);
        for (const row of block.rows) for (const cell of row) out.push(cell);
        continue;
      case "rule":
        // Drawn as a line, not as text.
        continue;
      default:
        out.push(block.text);
    }
  }
  return out;
}

function newPage(cursor: Cursor): void {
  cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.y = PAGE_HEIGHT - MARGIN;
}

function ensureSpace(cursor: Cursor, height: number): void {
  if (cursor.y - height < MARGIN) newPage(cursor);
}

function drawLines(
  cursor: Cursor,
  lines: string[],
  opts: {
    x: number;
    size: number;
    lineHeight: number;
    font: PDFFont;
    color?: PdfLibRGB;
  },
): void {
  for (const line of lines) {
    ensureSpace(cursor, opts.lineHeight);
    cursor.page.drawText(line || " ", {
      x: opts.x,
      y: cursor.y,
      size: opts.size,
      font: opts.font,
      color: opts.color ?? cursor.rgb(0.1, 0.12, 0.18),
    });
    cursor.y -= opts.lineHeight;
  }
}

/**
 * A block's text in its styled runs (bold, italic, code, clickable links),
 * when it has any; null when it is plain, so it is drawn exactly as before
 * by {@link drawLines}.
 */
function styledLines(
  cursor: Cursor,
  block: MarkdownBlock,
  base: PDFFont,
  maxWidth: number,
  size: number,
) {
  const runs = BLOCK_RUNS.get(block);
  if (!runs || !hasStyledRuns(runs)) return null;
  return wrapRuns(runs, cursor.fonts, base, maxWidth, size);
}

function drawStyledLines(
  cursor: Cursor,
  lines: ReturnType<typeof wrapRuns>,
  opts: {
    x: number;
    size: number;
    lineHeight: number;
    color?: PdfLibRGB;
    /** Drawn before each line, after the page break check (a quote's bars). */
    before?: () => void;
  },
): void {
  for (const line of lines) {
    ensureSpace(cursor, opts.lineHeight);
    opts.before?.();
    drawSegments(cursor.lib, cursor.page, line, {
      x: opts.x,
      y: cursor.y,
      size: opts.size,
      color: opts.color ?? cursor.rgb(0.1, 0.12, 0.18),
    });
    cursor.y -= opts.lineHeight;
  }
}

const HEADING_SIZES = { 1: 22, 2: 17, 3: 14, 4: 12.5, 5: 11.5, 6: 11 };

/**
 * Column widths for a table that must fit `available`. Columns that fit their
 * fair share keep their natural width; the rest split what is left in
 * proportion to how much they want. Cells then wrap inside their column.
 */
function tableColumnWidths(natural: number[], available: number): number[] {
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= available) return natural;
  const fair = available / natural.length;
  const small = natural.map((w) => w <= fair);
  const fixed = natural.reduce((sum, w, i) => sum + (small[i] ? w : 0), 0);
  const wanting = natural.reduce((sum, w, i) => sum + (small[i] ? 0 : w), 0);
  const rest = available - fixed;
  return natural.map((w, i) => (small[i] ? w : (w / wanting) * rest));
}

function drawTable(
  cursor: Cursor,
  block: MarkdownBlock & { kind: "table" },
  maxWidth: number,
): void {
  const { body, bold } = cursor.fonts;
  const columns = block.header.length;
  const rows = [block.header, ...block.rows];
  const fontFor = (r: number) => (r === 0 ? bold : body);
  // Each column's natural width is its widest cell. Folded, not
  // `Math.max(...rows.map(...))`: that passes one argument per row, and a
  // table at the source cap has more rows than the call stack has room for.
  const natural = Array.from(
    { length: columns },
    (_, c) =>
      rows.reduce(
        (widest, row, r) =>
          (row[c] ?? "")
            .split("\n")
            .reduce(
              (w, line) =>
                Math.max(w, fontFor(r).widthOfTextAtSize(line, TABLE_SIZE)),
              widest,
            ),
        0,
      ) +
      TABLE_PAD_X * 2,
  );
  const widths = tableColumnWidths(natural, maxWidth);
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const rule = cursor.rgb(0.78, 0.8, 0.85);
  const ink = cursor.rgb(0.1, 0.12, 0.18);

  cursor.y -= 2;
  rows.forEach((row, r) => {
    const font = fontFor(r);
    // The slack absorbs float error: a column sized to its widest cell must not
    // wrap that cell because (w + 10) - 10 came back a hair under w.
    const cells = widths.map((w, c) =>
      wrapBlockText(
        row[c] ?? "",
        font,
        w - TABLE_PAD_X * 2 + 0.001,
        TABLE_SIZE,
      ),
    );
    // Folded for the same reason, per column this time.
    const height = cells.reduce(
      (tallest, lines) => Math.max(tallest, lines.length),
      0,
    );
    // A row taller than the space left is continued on the next page; the
    // slice that fits is drawn as a row of its own, rules and all.
    for (let offset = 0; offset < height;) {
      let fit = Math.floor(
        (cursor.y - MARGIN - TABLE_PAD_Y * 2) / TABLE_LINE_HEIGHT,
      );
      if (fit < 1) {
        newPage(cursor);
        fit = Math.floor(
          (cursor.y - MARGIN - TABLE_PAD_Y * 2) / TABLE_LINE_HEIGHT,
        );
      }
      const take = Math.min(fit, height - offset);
      const rowHeight = take * TABLE_LINE_HEIGHT + TABLE_PAD_Y * 2;
      const top = cursor.y;
      if (r === 0) {
        cursor.page.drawRectangle({
          x: MARGIN,
          y: top - rowHeight,
          width: tableWidth,
          height: rowHeight,
          color: cursor.rgb(0.94, 0.95, 0.97),
        });
      }
      let x = MARGIN;
      widths.forEach((w, c) => {
        cells[c]!.slice(offset, offset + take).forEach((line, l) => {
          if (!line) return;
          const lineWidth = font.widthOfTextAtSize(line, TABLE_SIZE);
          const align = block.align[c] ?? "left";
          const dx =
            align === "right"
              ? w - TABLE_PAD_X - lineWidth
              : align === "center"
                ? (w - lineWidth) / 2
                : TABLE_PAD_X;
          cursor.page.drawText(line, {
            x: x + dx,
            y: top - TABLE_PAD_Y - (l + 1) * TABLE_LINE_HEIGHT + 4,
            size: TABLE_SIZE,
            font,
            color: ink,
          });
        });
        x += w;
      });
      const bottomY = top - rowHeight;
      const hLine = (y: number) =>
        cursor.page.drawLine({
          start: { x: MARGIN, y },
          end: { x: MARGIN + tableWidth, y },
          thickness: 0.6,
          color: rule,
        });
      if (r === 0 || offset > 0) hLine(top);
      hLine(bottomY);
      let edge = MARGIN;
      for (const w of [0, ...widths]) {
        edge += w;
        cursor.page.drawLine({
          start: { x: edge, y: top },
          end: { x: edge, y: bottomY },
          thickness: 0.6,
          color: rule,
        });
      }
      cursor.y = bottomY;
      offset += take;
    }
  });
  // Clear of the bottom rule: the next block draws from its baseline up.
  cursor.y -= 18;
}

function drawBlock(cursor: Cursor, block: MarkdownBlock): void {
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  switch (block.kind) {
    case "heading": {
      const size = HEADING_SIZES[block.depth];
      const lineHeight = size + 9;
      cursor.y -= block.depth === 1 ? 8 : 4;
      const color =
        block.depth === 6
          ? cursor.rgb(0.3, 0.33, 0.42)
          : cursor.rgb(0.05, 0.07, 0.14);
      // Styled only when the heading has a link: headingRuns keeps no style.
      const styled = styledLines(
        cursor,
        block,
        cursor.fonts.bold,
        maxWidth,
        size,
      );
      if (styled) {
        drawStyledLines(cursor, styled, { x: MARGIN, size, lineHeight, color });
      } else {
        drawLines(
          cursor,
          wrapBlockText(block.text, cursor.fonts.bold, maxWidth, size),
          { x: MARGIN, size, lineHeight, font: cursor.fonts.bold, color },
        );
      }
      cursor.y -= 4;
      return;
    }
    case "paragraph": {
      const styled = styledLines(
        cursor,
        block,
        cursor.fonts.body,
        maxWidth,
        BODY_SIZE,
      );
      if (styled) {
        drawStyledLines(cursor, styled, {
          x: MARGIN,
          size: BODY_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
        });
      } else {
        drawLines(
          cursor,
          wrapBlockText(block.text, cursor.fonts.body, maxWidth, BODY_SIZE),
          {
            x: MARGIN,
            size: BODY_SIZE,
            lineHeight: BODY_LINE_HEIGHT,
            font: cursor.fonts.body,
          },
        );
      }
      cursor.y -= 6;
      return;
    }
    case "list-item": {
      const x =
        MARGIN +
        LIST_INDENT +
        Math.min(block.depth, MAX_LIST_DEPTH) * LIST_INDENT;
      const marker = listMarker(block);
      const font = cursor.fonts.body;
      // Hanging indent: the marker sits in its own column and wrapped lines
      // line up with the item's text, not with the marker.
      const hang = Math.max(
        12,
        font.widthOfTextAtSize(`${marker} `, BODY_SIZE),
      );
      const styled = styledLines(
        cursor,
        block,
        font,
        PAGE_WIDTH - MARGIN - x - hang,
        BODY_SIZE,
      );
      const lines = styled
        ? []
        : wrapBlockText(
            block.text,
            font,
            PAGE_WIDTH - MARGIN - x - hang,
            BODY_SIZE,
          );
      ensureSpace(cursor, BODY_LINE_HEIGHT);
      if (block.continued) {
        // A later paragraph of the item: a little air, then its text column.
        cursor.y -= 4;
      } else {
        cursor.page.drawText(marker, {
          x,
          y: cursor.y,
          size: BODY_SIZE,
          font,
          color: cursor.rgb(0.1, 0.12, 0.18),
        });
      }
      if (styled) {
        drawStyledLines(cursor, styled, {
          x: x + hang,
          size: BODY_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
        });
      } else {
        drawLines(cursor, lines, {
          x: x + hang,
          size: BODY_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          font,
        });
      }
      return;
    }
    case "quote": {
      // One bar per level of nesting, each QUOTE_STEP further right.
      const levels = Math.min(block.depth ?? 1, MAX_LIST_DEPTH);
      const inset = (levels - 1) * QUOTE_STEP;
      const bars = () => {
        for (let level = 0; level < levels; level++) {
          cursor.page.drawRectangle({
            x: MARGIN + level * QUOTE_STEP,
            y: cursor.y - 4,
            width: 3,
            height: BODY_LINE_HEIGHT,
            color: cursor.rgb(0.45, 0.36, 0.95),
          });
        }
      };
      const styled = styledLines(
        cursor,
        block,
        cursor.fonts.italic,
        maxWidth - 18 - inset,
        BODY_SIZE,
      );
      if (styled) {
        drawStyledLines(cursor, styled, {
          x: MARGIN + 14 + inset,
          size: BODY_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          color: cursor.rgb(0.24, 0.27, 0.38),
          before: bars,
        });
        cursor.y -= 5;
        return;
      }
      const lines = wrapBlockText(
        block.text,
        cursor.fonts.italic,
        maxWidth - 18 - inset,
        BODY_SIZE,
      );
      for (const line of lines) {
        ensureSpace(cursor, BODY_LINE_HEIGHT);
        // The bar is drawn per line so it runs the full height of the quote,
        // across a page break too.
        for (let level = 0; level < levels; level++) {
          cursor.page.drawRectangle({
            x: MARGIN + level * QUOTE_STEP,
            y: cursor.y - 4,
            width: 3,
            height: BODY_LINE_HEIGHT,
            color: cursor.rgb(0.45, 0.36, 0.95),
          });
        }
        drawLines(cursor, [line], {
          x: MARGIN + 14 + inset,
          size: BODY_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          font: cursor.fonts.italic,
          color: cursor.rgb(0.24, 0.27, 0.38),
        });
      }
      cursor.y -= 5;
      return;
    }
    case "code": {
      if (block.language) {
        drawLines(
          cursor,
          wrapTextLine(block.language, cursor.fonts.bold, maxWidth, 8),
          {
            x: MARGIN,
            size: 8,
            lineHeight: 12,
            font: cursor.fonts.bold,
            color: cursor.rgb(0.37, 0.39, 0.48),
          },
        );
      }
      for (const line of block.text.split("\n")) {
        drawLines(
          cursor,
          wrapTextLine(line || " ", cursor.fonts.mono, maxWidth - 16, 9),
          {
            x: MARGIN + 8,
            size: 9,
            lineHeight: 13,
            font: cursor.fonts.mono,
            color: cursor.rgb(0.08, 0.1, 0.16),
          },
        );
      }
      cursor.y -= 8;
      return;
    }
    case "rule": {
      ensureSpace(cursor, 14);
      const y = cursor.y - 2;
      cursor.page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_WIDTH - MARGIN, y },
        thickness: 0.8,
        color: cursor.rgb(0.78, 0.8, 0.85),
      });
      cursor.y -= 14;
      return;
    }
    case "table":
      ensureSpace(cursor, TABLE_LINE_HEIGHT * 2 + TABLE_PAD_Y * 4);
      drawTable(cursor, block, maxWidth);
      return;
  }
}

/** The running header, shortened to fit the text column if it has to be. */
function fitTitle(title: string, font: PDFFont, size: number): string {
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  if (font.widthOfTextAtSize(title, size) <= maxWidth) return title;
  const chars = Array.from(title);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd() + ELLIPSIS;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("").trimEnd() + ELLIPSIS;
}

export async function markdownToPdf(
  markdown: string,
  options: MarkdownToPdfOptions = {},
): Promise<Uint8Array> {
  validateMarkdownInput(markdown);
  const blocks = parseMarkdownBlocks(markdown);
  const lib = await loadPdfLib();
  const { PDFDocument, rgb } = lib;
  const doc = await PDFDocument.create();
  const title =
    (options.title ?? "Markdown document").trim() || "Markdown document";
  // The corpus is what will be DRAWN, not what was typed. `drawnStrings` adds
  // the list markers this renderer synthesises — "•" is U+2022, which is inside
  // WinAnsi but outside Noto Sans Bengali's 14% of General Punctuation, so a
  // Bengali bullet list chosen from the raw markdown would have picked a face
  // that cannot draw its own bullets. Deriving the corpus from the parsed
  // blocks is the difference between a right answer and a right answer to the
  // wrong question.
  const drawn = drawnStrings(blocks, title);
  const fonts: PdfFonts = {
    body: await embedDrawingFont(doc, drawn, "sans"),
    bold: await embedDrawingFont(doc, drawn, "sans-bold"),
    mono: await embedDrawingFont(doc, drawn, "mono"),
    italic: await embedDrawingFont(doc, drawn, "sans-oblique"),
  };
  doc.setTitle(title);
  doc.setCreator(PRODUCER);
  doc.setProducer(PRODUCER);
  const cursor: Cursor = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN,
    fonts,
    rgb,
    lib,
  };

  cursor.page.drawText(fitTitle(title, fonts.bold, 9), {
    x: MARGIN,
    y: PAGE_HEIGHT - 34,
    size: 9,
    font: fonts.bold,
    color: cursor.rgb(0.35, 0.38, 0.45),
  });
  cursor.y -= 10;
  blocks.forEach((block, index) => {
    // Items stack tight; the list as a whole gets the gap a paragraph has.
    if (index > 0 && blocks[index - 1]!.kind === "list-item") {
      if (block.kind !== "list-item") cursor.y -= 6;
    }
    drawBlock(cursor, block);
  });
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const label = `${index + 1} / ${pages.length}`;
    // Right-aligned to the margin, so "10 / 12" does not run into it.
    page.drawText(label, {
      x: PAGE_WIDTH - MARGIN - fonts.mono.widthOfTextAtSize(label, 8),
      y: 28,
      size: 8,
      font: fonts.mono,
      color: cursor.rgb(0.45, 0.48, 0.55),
    });
  });
  return doc.save();
}
