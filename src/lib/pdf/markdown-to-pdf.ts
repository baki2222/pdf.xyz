import type { PDFDocument, PDFFont, PDFPage, RGB as PdfLibRGB } from "pdf-lib";
import { loadPdfLib } from "./pdf-lib";
import { outputName } from "./files";
import { PdfEngineError } from "./engine";
import { embedDrawingFont } from "./unicode-font";
import { wrapTextLine } from "./text-to-pdf";

const PRODUCER = "pdf.xyz";
/** US Letter, points. Exported so tests bind their page-edge check to it. */
export const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
/** Exported so tests bind their page-edge check to it. */
export const MARGIN = 54;
const BODY_SIZE = 11;
const BODY_LINE_HEIGHT = 16;
const LIST_INDENT = 18;
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
      text: string;
    }
  | { kind: "quote"; text: string }
  | { kind: "code"; language?: string; text: string }
  | { kind: "rule" }
  | {
      kind: "table";
      align: TableAlign[];
      header: string[];
      rows: string[][];
    };

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
}

export function validateMarkdownInput(markdown: string): void {
  if (markdown.trim().length === 0) {
    throw new PdfEngineError(
      "Add some Markdown or upload a non-empty .md file.",
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
 *  This renderer draws inline text in one face per block, so inline markup
 *  is REMOVED rather than styled. That makes the one unforgivable outcome a
 *  character the user typed going missing: the previous regex chain unwrapped
 *  code spans first and then ran `_x_` / `*x*` over what they exposed, so
 *  `MAX_UPLOAD_SIZE` printed as MAXUPLOADSIZE, `__init__.py` as init.py and
 *  "2 * 3 * 4" as "2  3  4" — silently, in a tool whose keyword is "readme to
 *  pdf". So this is a small tokenizer that follows CommonMark where it
 *  decides whether a character is markup at all:
 *
 *    1. code spans first (N backticks close on exactly N), contents verbatim;
 *    2. backslash escapes, which make a punctuation mark literal;
 *    3. links and images, printed as "label (url)" — the URL is literal;
 *    4. emphasis by the flanking rules: `*` must hug the text it wraps, and
 *       `_` additionally may not be intraword, so snake_case is not markup.
 *
 *  Anything not recognised as markup is printed as typed.
 * ------------------------------------------------------------------ */

/** CommonMark's ASCII punctuation: what a backslash may escape. */
const ASCII_PUNCT = /^[!-/:-@[-`{-~]$/;
const UNICODE_PUNCT = /^[\p{P}\p{S}]$/u;

interface InlineUnit {
  ch: string;
  /**
   * `text` may still turn out to be markup; `literal` was escaped, or is part
   * of a URL, and never is; `code` came from a code span and is never touched.
   */
  kind: "text" | "literal" | "code";
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

  constructor(readonly src: string) {
    this.linkBudget = src.length * 4 + 65_536;
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

function tokenizeInline(src: string): InlineUnit[] {
  const source = new InlineSource(src);
  const out: InlineUnit[] = [];
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
        // A hard line break. This renderer reflows paragraphs, so it is a space.
        out.push({ ch: " ", kind: "text" });
        i += 2;
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
    const isImage = c === "!" && src[i + 1] === "[";
    if (c === "[" || isImage) {
      const link = matchLink(source, isImage ? i + 1 : i);
      if (link) {
        const label = tokenizeInline(link.label);
        const labelText = label.map((u) => u.ch).join("");
        // Images cannot be drawn here, so their alt text and address stand in
        // for them — the output stays honest about what was left out.
        if (!labelText.trim()) pushAll(out, literalUnits(link.url));
        else {
          pushAll(out, label);
          if (labelText.trim() !== link.url) {
            pushAll(out, literalUnits(` (${link.url})`));
          }
        }
        i = link.end;
        continue;
      }
    }
    if (c === "<") {
      const auto = AUTOLINK.exec(src.slice(i, i + LINK_SCAN_LIMIT));
      if (auto) {
        pushAll(out, literalUnits(auto[1]!));
        i += auto[0].length;
        continue;
      }
    }
    const cp = src.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    out.push({ ch, kind: "text" });
    i += ch.length;
  }
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
function markEmphasis(units: InlineUnit[]): Uint8Array {
  const removed = new Uint8Array(units.length);
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
  return removed;
}

/**
 * Inline Markdown to the plain text this renderer draws. Whitespace outside
 * code spans collapses to single spaces (the block is reflowed anyway);
 * inside a code span it is kept as typed.
 */
function stripInlineMarkdown(input: string): string {
  const units = tokenizeInline(input);
  const removed = markEmphasis(units);
  let out = "";
  let lastWasSpace = true;
  units.forEach((unit, index) => {
    if (removed[index]) return;
    if (unit.kind !== "code" && /\s/u.test(unit.ch)) {
      if (!lastWasSpace) out += " ";
      lastWasSpace = true;
      return;
    }
    out += unit.ch;
    lastWasSpace = false;
  });
  return out.trim();
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
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];

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

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = stripInlineMarkdown(paragraph.join("\n"));
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote) return;
    const text = stripInlineMarkdown(quote.join("\n"));
    if (text) blocks.push({ kind: "quote", text });
    quote = null;
  };
  const flushItem = () => {
    if (!item) return;
    item.block.text = stripInlineMarkdown(item.lines.join("\n"));
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

    if (!trimmed) {
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

    // Setext headings take the paragraph above them. Checked before the
    // thematic break, because `Title\n---` is a heading, not a rule.
    if (paragraph.length && indent <= 3) {
      const level = SETEXT_1.test(trimmed) ? 1 : SETEXT_2.test(trimmed) ? 2 : 0;
      if (level) {
        const text = stripInlineMarkdown(paragraph.join("\n"));
        paragraph = [];
        if (text) blocks.push({ kind: "heading", depth: level as 1 | 2, text });
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
      const text = stripInlineMarkdown(heading[2] ?? "");
      if (text) {
        blocks.push({
          kind: "heading",
          depth: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
          text,
        });
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
          if (
            !line ||
            QUOTE_LINE.test(line) ||
            ATX_HEADING.test(line) ||
            FENCE_OPEN.test(lines[j]!)
          ) {
            break;
          }
          // Short rows are padded and long ones cut, as GFM does.
          const cells = splitTableRow(line).slice(0, width);
          while (cells.length < width) cells.push("");
          rows.push(cells.map(stripInlineMarkdown));
        }
        blocks.push({
          kind: "table",
          align: delimiter.map(tableAlign),
          header: header.map(stripInlineMarkdown),
          rows,
        });
        i = j - 1;
        previousBlank = false;
        continue;
      }
    }

    const quoted = QUOTE_LINE.exec(trimmed);
    if (quoted) {
      if (!quote) {
        flushParagraph();
        flushItem();
        closeList();
        quote = [];
      }
      if (quoted[1]!.trim()) quote.push(quoted[1]!);
      else flushQuote();
      previousBlank = false;
      continue;
    }

    const bullet = BULLET_ITEM.exec(trimmed);
    const ordered = bullet ? null : ORDERED_ITEM.exec(trimmed);
    if (bullet || ordered) {
      flushAll();
      // A child starts at or past its parent's text column; anything shallower
      // closes the frames it is not inside.
      while (list.length && indent < list.at(-1)!.content) list.pop();
      const markerWidth = bullet ? bullet[1]!.length : ordered![1]!.length + 1;
      const gap = (bullet ? bullet[2]! : ordered![3]!).length;
      list.push({
        indent,
        content: indent + markerWidth + (gap > 4 ? 1 : gap),
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
            index: Number(ordered![1]),
            depth: list.length - 1,
            text: "",
          };
      blocks.push(block);
      item = { block, lines: [bullet ? bullet[3]! : ordered![4]!] };
      previousBlank = false;
      continue;
    }

    if (quote && !previousBlank) {
      // Lazy continuation of the quote's paragraph.
      quote.push(trimmed);
      continue;
    }

    if (inList) {
      // Directly under an item's text, or indented to its text column after a
      // blank line: the item continues. Otherwise the list is over.
      const continues =
        (!previousBlank && !paragraph.length) ||
        (previousBlank && indent >= list.at(-1)!.content);
      if (continues && item) {
        item.lines.push(trimmed);
        previousBlank = false;
        continue;
      }
      if (continues && !item) {
        // The item's text was already closed (a fence inside the item, say);
        // keep the prose in the item's column as a paragraph of its own.
        paragraph.push(trimmed);
        previousBlank = false;
        continue;
      }
      if (!continues) closeList();
    }

    flushQuote();
    flushItem();
    paragraph.push(trimmed);
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
 * Every string this renderer will hand to `drawText`, including the decorations
 * it invents.
 *
 * Kept next to {@link drawBlock} and mirroring its cases on purpose: a new block
 * kind that draws a new marker has to be added in both, and the two sitting
 * together is the cheapest way to make that obvious. `markdown-to-pdf.test.ts`
 * pins the bullet specifically, because that is the character that broke, and
 * checks that every string the output PDF shows is covered by this corpus.
 */
function drawnStrings(blocks: MarkdownBlock[], title: string): string[] {
  const out = [title, ELLIPSIS];
  for (const block of blocks) {
    switch (block.kind) {
      case "list-item":
        out.push(`${listMarker(block)} ${block.text}`);
        continue;
      case "code":
        if (block.language) out.push(block.language);
        out.push(block.text);
        continue;
      case "table":
        out.push(...block.header, ...block.rows.flat());
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
  const natural = Array.from(
    { length: columns },
    (_, c) =>
      Math.max(
        ...rows.map((row, r) =>
          fontFor(r).widthOfTextAtSize(row[c] ?? "", TABLE_SIZE),
        ),
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
      wrapTextLine(row[c] ?? "", font, w - TABLE_PAD_X * 2 + 0.001, TABLE_SIZE),
    );
    const height = Math.max(...cells.map((lines) => lines.length));
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
      drawLines(
        cursor,
        wrapTextLine(block.text, cursor.fonts.bold, maxWidth, size),
        {
          x: MARGIN,
          size,
          lineHeight,
          font: cursor.fonts.bold,
          color:
            block.depth === 6
              ? cursor.rgb(0.3, 0.33, 0.42)
              : cursor.rgb(0.05, 0.07, 0.14),
        },
      );
      cursor.y -= 4;
      return;
    }
    case "paragraph":
      drawLines(
        cursor,
        wrapTextLine(block.text, cursor.fonts.body, maxWidth, BODY_SIZE),
        {
          x: MARGIN,
          size: BODY_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          font: cursor.fonts.body,
        },
      );
      cursor.y -= 6;
      return;
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
      const lines = wrapTextLine(
        block.text,
        font,
        PAGE_WIDTH - MARGIN - x - hang,
        BODY_SIZE,
      );
      ensureSpace(cursor, BODY_LINE_HEIGHT);
      cursor.page.drawText(marker, {
        x,
        y: cursor.y,
        size: BODY_SIZE,
        font,
        color: cursor.rgb(0.1, 0.12, 0.18),
      });
      drawLines(cursor, lines, {
        x: x + hang,
        size: BODY_SIZE,
        lineHeight: BODY_LINE_HEIGHT,
        font,
      });
      return;
    }
    case "quote": {
      const lines = wrapTextLine(
        block.text,
        cursor.fonts.italic,
        maxWidth - 18,
        BODY_SIZE,
      );
      for (const line of lines) {
        ensureSpace(cursor, BODY_LINE_HEIGHT);
        // The bar is drawn per line so it runs the full height of the quote,
        // across a page break too.
        cursor.page.drawRectangle({
          x: MARGIN,
          y: cursor.y - 4,
          width: 3,
          height: BODY_LINE_HEIGHT,
          color: cursor.rgb(0.45, 0.36, 0.95),
        });
        drawLines(cursor, [line], {
          x: MARGIN + 14,
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
  const { PDFDocument, rgb } = await loadPdfLib();
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
