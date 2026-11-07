import { baseName, outputName } from "./files";
import type { ExtractedPdfText, ExtractedTextPage, TextLine } from "./text";

/**
 * A page to convert. `lines` is the visual-line geometry `extractPdfLines`
 * records.
 *
 * REQUIRED, and `null` must be written out, because the fallback it selects is
 * the defect: without geometry the converter can only split `text` on blank
 * lines, and pdfjs never emits one — every page of a real PDF becomes a single
 * paragraph. Optional, `extractPdfText`'s result would type-check here and the
 * runner could regress to it silently; required, that swap is a compile error.
 */
export type PdfToMarkdownPage = ExtractedTextPage & {
  lines: readonly TextLine[] | null;
  /**
   * The web links on the page (`./pdf-to-markdown-read`). Optional, because
   * the converter is also fed text with no annotations at all; the runner's
   * chain is `pdfToMarkdown`, and `pdf-to-markdown-read.test.ts` reads links
   * through it from a real PDF.
   */
  links?: readonly MarkdownLink[];
  /**
   * The tables Extract Tables' detector finds on the page
   * (`./pdf-to-markdown-tables`). Optional for the same reason as `links`.
   */
  tables?: readonly MarkdownTable[];
};

/**
 * A detected table: its cells, and the baselines (PDF points, y up) of its
 * first and last rows, so its lines can be found on the page.
 */
export interface MarkdownTable {
  rows: string[][];
  top: number;
  bottom: number;
}

/**
 * The schemes a Markdown link may carry; a link to anything else (a script, a
 * file, a page inside the PDF) keeps its words only. Here rather than in the
 * reader so the tool page can name them without importing pdf.js's loader.
 */
export const MARKDOWN_LINK_SCHEMES = ["http:", "https:", "mailto:"] as const;

/**
 * A /Link annotation's web address and the words it covers. `top`/`bottom` are
 * the link's vertical extent in PDF points (y up), so a phrase is linked only
 * in the block that sits where the link does.
 */
export interface MarkdownLink {
  text: string;
  url: string;
  top: number;
  bottom: number;
}

export type PdfToMarkdownInput = Pick<
  ExtractedPdfText,
  "pageCount" | "text" | "characterCount" | "hasText"
> & { pages: PdfToMarkdownPage[] };

export interface PdfToMarkdownOptions {
  sourceName?: string;
  includePageHeadings?: boolean;
  /**
   * Leave out running headers and footers ({@link repeatedEdgeLines}).
   * Defaults to {@link DEFAULT_REMOVE_REPEATED_LINES}.
   */
  removeRepeatedLines?: boolean;
}

/** Repeated headers and footers are left out unless the user keeps them. */
export const DEFAULT_REMOVE_REPEATED_LINES = true;

/**
 * A running header or footer is one of the top or bottom
 * {@link EDGE_LINES} lines of a page...
 */
export const EDGE_LINES = 2;
/** ...whose text, digits aside, is at an edge of at least this share of pages... */
export const REPEATED_LINE_SHARE = 0.5;
/**
 * ...in a document of at least this many pages with text. Two pages are too
 * few to tell a running header from a title repeated on a cover and a first
 * page.
 */
export const REPEATED_LINE_MIN_PAGES = 3;

export interface PdfToMarkdownResult {
  markdown: string;
  pageCount: number;
  characterCount: number;
  hasMarkdown: boolean;
  /** Links written as `[text](url)` or `<url>`. */
  linkCount: number;
  /** Tables written as GFM pipe tables. */
  tableCount: number;
  /** Running header and footer lines left out. */
  removedLineCount: number;
}

export function markdownOutputName(sourceName: string): string {
  return outputName(sourceName, "markdown", "md");
}

/** The result's summary line: what was written, and what was kept. */
export function markdownSummary(result: PdfToMarkdownResult): string {
  const parts = [
    `${result.characterCount.toLocaleString()} Markdown characters from ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`,
  ];
  if (result.linkCount > 0) {
    parts.push(`${result.linkCount} link${result.linkCount === 1 ? "" : "s"}`);
  }
  if (result.removedLineCount > 0) {
    parts.push(
      `${result.removedLineCount} repeated header and footer line${result.removedLineCount === 1 ? "" : "s"} left out`,
    );
  }
  if (result.tableCount > 0) {
    parts.push(
      `${result.tableCount} table${result.tableCount === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" · ");
}

function titleFromSource(sourceName?: string): string {
  const raw = sourceName ? baseName(sourceName) : "PDF document";
  return raw.trim() || "PDF document";
}

/* ------------------------------------------------------------------ *
 *  Escaping
 * ------------------------------------------------------------------ */

/**
 * Escape what would turn a block's opening characters into Markdown syntax the
 * PDF never had: an ATX heading, a thematic break (`-`, `---`, `* * *`), a
 * block quote, a code fence, or a table row.
 *
 * The thematic-break pattern once read `^([-*_])\s*$`, which escaped a lone `-`
 * and let `---`, `***` and `___` — the actual thematic breaks — through.
 */
function escapeBlockStart(text: string): string {
  if (/^#{1,6}(\s|$)/.test(text)) return `\\${text}`;
  if (/^([-*_])(\s*\1){2,}\s*$|^[-*_]\s*$/.test(text)) return `\\${text}`;
  if (/^(`{3,}|~{3,})/.test(text)) return `\\${text}`;
  if (/^[>|]/.test(text)) return `\\${text}`;
  return text;
}

/**
 * Escape a `<` that opens something a Markdown renderer would treat as HTML (a
 * tag, a comment, a processing instruction, an autolink), so `<div>` in the
 * PDF stays visible text instead of vanishing into the renderer; and an `&`
 * that opens an entity reference, so `&lt;` in the PDF is not decoded.
 *
 * Deliberately NOT escaped: `*`, `_`, backticks and `[`. They are common in
 * identifiers, file names and URLs, and backslashes through them make the text
 * unreadable to the LLM and note-taking readers this tool is for.
 */
function escapeInline(text: string): string {
  return (
    text
      // An `&` that starts an entity reference, so `&lt;` shown in the PDF
      // stays `&lt;` instead of rendering as `<`. A bare `&` (R&D) renders
      // as itself and is left alone. First, so the `&lt;` below survives.
      .replace(/&(?=#?[A-Za-z0-9]+;)/g, "&amp;")
      .replace(/<(?=[A-Za-z/!?])/g, "&lt;")
  );
}

/** Collapse whitespace, trim, and escape the block-leading syntax above. */
export function normalizeMarkdownLine(line: string): string {
  const trimmed = collapseWhitespace(line);
  if (!trimmed) return "";
  return escapeBlockStart(trimmed);
}

function collapseWhitespace(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ *
 *  Lists and line joining
 * ------------------------------------------------------------------ */

/**
 * Bullet glyphs generators draw at the start of a list line.
 *
 * Word's own Save as PDF maps its default bullet to U+2022 (measured, Word
 * 16: a real export came back from pdfjs as U+2022). The private-use code
 * points are the same bullets at their Symbol / Wingdings font positions
 * (U+F0B7 round, U+F0A7 square, U+F076 diamond, U+F0D8 arrowhead, U+F0FC
 * check mark) — what a PDF carries when its symbol font has no Unicode map,
 * which pdfjs then passes through as-is.
 */
export const BULLET_GLYPHS =
  "\u2022\u25CF\u25AA\u25E6\u2023\u2043\u2219\u00B7\u25A0\u25A1\u25CB\u27A2\u25BA\u25B8\uF0B7\uF0A7\uF076\uF0D8\uF0FC";
const GLYPH_BULLET = new RegExp(`^[${BULLET_GLYPHS}]\\s*(?=\\S)`);
const ASCII_BULLET = /^[-*+]\s+(?=\S)/;
const ORDERED_ITEM = /^(\d{1,9}[.)])\s+(?=\S)/;

/**
 * The Markdown for a list line, or null when the line is not one. Unordered
 * markers — glyph or ASCII — all become `- `; ordered markers are kept.
 */
function listItem(line: string): { marker: string; content: string } | null {
  const glyph = GLYPH_BULLET.exec(line) ?? ASCII_BULLET.exec(line);
  if (glyph) return { marker: "-", content: line.slice(glyph[0].length) };
  const ordered = ORDERED_ITEM.exec(line);
  if (ordered?.[1]) {
    return { marker: ordered[1], content: line.slice(ordered[0].length) };
  }
  return null;
}

/**
 * Join wrapped lines into one run of text, repairing what the line break did
 * to a hyphen:
 *
 * - `exam-` + `ple` is `example`: a letter, a hyphen, then a LOWERCASE letter
 *   is a word the generator hyphenated to fit, so the hyphen goes. A compound
 *   split exactly there (`well-` + `known`) loses its hyphen too — the same
 *   trade-off `pdftotext` makes.
 * - `Jean-` + `Paul`, `2019-` + `2020`: any other hyphen attached to its word
 *   is real, and the break after it never stood for a space, so the halves are
 *   joined with the hyphen kept.
 * - A soft hyphen (U+00AD) only ever marks a break, and is always removed.
 *
 * Called on the lines of ONE block only, so nothing is joined across a
 * paragraph or page break.
 */
export function joinWrappedLines(lines: readonly string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = collapseWhitespace(raw);
    if (!line) continue;
    if (!out) {
      out = line;
    } else if (/\u00AD$/.test(out)) {
      out = out.slice(0, -1) + line;
    } else if (/\p{L}[-\u2010]$/u.test(out) && /^\p{Ll}/u.test(line)) {
      out = out.slice(0, -1) + line;
    } else if (/\S[-\u2010]$/.test(out)) {
      out += line;
    } else {
      out = `${out} ${line}`;
    }
  }
  return out.replace(/\u00AD/g, "");
}

/* ------------------------------------------------------------------ *
 *  Blocks
 * ------------------------------------------------------------------ */

/** Where a block sits on its page, in PDF points (y up); geometry only. */
interface Span {
  top: number;
  bottom: number;
}

type Block = (
  | { kind: "paragraph"; lines: string[] }
  | { kind: "item"; marker: string; lines: string[] }
  | { kind: "heading"; size: number; lines: string[] }
  | { kind: "table"; rows: string[][]; lines: string[] }
) & { span?: Span };

/* ------------------------------------------------------------------ *
 *  Links
 * ------------------------------------------------------------------ */

/** Whether `text[start, end)` is a whole run of words, not part of one. */
function onWordBoundaries(text: string, start: number, end: number): boolean {
  const word = /[\p{L}\p{N}]/u;
  return (
    !(start > 0 && word.test(text[start - 1]!) && word.test(text[start]!)) &&
    !(end < text.length && word.test(text[end]!) && word.test(text[end - 1]!))
  );
}

/** A URL as a Markdown destination: nothing in it can end or split the link. */
function markdownUrl(url: string): string {
  return url.replace(/[\s()<>]/g, (c) => encodeURIComponent(c));
}

function linkMarkdown(text: string, url: string): string {
  const destination = markdownUrl(url);
  // An address shown as its own text is an autolink, not `[x](x)`.
  if (text === url || `${text}/` === url) return `<${destination}>`;
  const label = escapeInline(text).replace(/[[\]\\]/g, "\\$&");
  return `[${label}](${destination})`;
}

/**
 * Turns a block's joined text into escaped inline Markdown, writing each of
 * the page's links over the first unclaimed run of its words — in a block
 * that sits where the link does, when both have geometry. Each link is
 * written once; one whose words are not found (a hyphen rejoined across its
 * line break, say) leaves the text as it was.
 */
function pageLinker(links: readonly MarkdownLink[]) {
  const used = links.map(() => false);
  let count = 0;
  const write = (raw: string, span: Span | undefined): string => {
    const taken: { start: number; end: number; url: string }[] = [];
    links.forEach((link, i) => {
      if (used[i]) return;
      if (span && (link.bottom > span.top || link.top < span.bottom)) return;
      for (
        let at = raw.indexOf(link.text);
        at !== -1;
        at = raw.indexOf(link.text, at + 1)
      ) {
        const end = at + link.text.length;
        if (
          onWordBoundaries(raw, at, end) &&
          !taken.some((t) => at < t.end && end > t.start)
        ) {
          taken.push({ start: at, end, url: link.url });
          used[i] = true;
          return;
        }
      }
    });
    taken.sort((a, b) => a.start - b.start);
    let out = "";
    let at = 0;
    for (const t of taken) {
      out += escapeInline(raw.slice(at, t.start));
      out += linkMarkdown(raw.slice(t.start, t.end), t.url);
      at = t.end;
    }
    count += taken.length;
    return out + escapeInline(raw.slice(at));
  };
  return { write, count: () => count };
}

type Linker = ReturnType<typeof pageLinker>;

/** Heading font sizes are bucketed to half a point before being ranked. */
const headingKey = (size: number) => Math.round(size * 2) / 2;

/**
 * A GFM pipe table. The first row is the header row GFM requires; a `|` in a
 * cell is escaped so it stays in its cell. Rows are padded to the widest.
 */
function renderTable(rows: string[][], linker: Linker, span?: Span): string {
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const cell = (text: string | undefined) =>
    linker.write(collapseWhitespace(text ?? ""), span).replace(/\|/g, "\\|");
  const [head = [], ...body] = rows.map((row) =>
    Array.from({ length: width }, (_, i) => cell(row[i])),
  );
  return [
    line(head),
    line(Array.from({ length: width }, () => "---")),
    ...body.map(line),
  ].join("\n");
}

function renderBlock(
  block: Block,
  headingLevel: (size: number) => number,
  linker: Linker,
) {
  if (block.kind === "table") {
    return renderTable(block.rows, linker, block.span);
  }
  const text = linker.write(joinWrappedLines(block.lines), block.span);
  if (!text) return "";
  switch (block.kind) {
    case "paragraph":
      return escapeBlockStart(text);
    case "item":
      return `${block.marker} ${escapeBlockStart(text)}`;
    case "heading":
      // A trailing ` #` run would be read as the heading's closing sequence.
      return `${"#".repeat(headingLevel(block.size))} ${text.replace(/(\s)(#+)$/, "$1\\$2")}`;
  }
}

function renderBlocks(
  blocks: Block[],
  headingLevel: (size: number) => number,
  linker: Linker,
): string {
  let out = "";
  let previous: Block | null = null;
  for (const block of blocks) {
    const rendered = renderBlock(block, headingLevel, linker);
    if (!rendered) continue;
    if (out) {
      // Items of one list stay on consecutive lines (a tight list); every
      // other boundary is a blank line.
      out += previous?.kind === "item" && block.kind === "item" ? "\n" : "\n\n";
    }
    out += rendered;
    previous = block;
  }
  return out;
}

/** Fallback for pages without geometry: blocks are separated by blank lines. */
function blocksFromText(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = collapseWhitespace(rawLine);
    if (!line) {
      flush();
      continue;
    }
    const item = listItem(line);
    if (item) {
      flush();
      blocks.push({ kind: "item", marker: item.marker, lines: [item.content] });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/* ------------------------------------------------------------------ *
 *  Geometry
 * ------------------------------------------------------------------ */

/**
 * A new paragraph starts when the baseline step is more than this multiple of
 * the page's line pitch. Measured on a Word 16 Save as PDF with the default
 * styles (12pt body): 16.9pt between lines of a paragraph, 25.0pt between
 * paragraphs — a ratio of 1.48 — so 1.3 separates the two with room on both
 * sides. `pdf-to-markdown.test.ts` pins this ratio against that measurement.
 */
export const PARAGRAPH_GAP_RATIO = 1.3;

/**
 * A line is a heading candidate when its glyphs are at least this multiple of
 * the document's body size. The same Word export set Heading 2 at 15.96pt over
 * a 12pt body (1.33), which a rounder 1.3 would only just admit; Google Docs'
 * default Heading 3 is 14pt over 11pt (1.27), which it would miss.
 * Size alone is not enough — see `isHeadingLine`.
 */
export const HEADING_SIZE_RATIO = 1.2;

/** Headings are short. Longer large-font text is a pull quote or a cover blurb. */
export const HEADING_MAX_CHARS = 80;

/**
 * A line belongs to a detected table's rows when its baseline is within this
 * multiple of the body size of the table's first-to-last row range — the
 * detector's own row tolerance (0.6 of the median height).
 */
export const TABLE_ROW_TOLERANCE = 0.6;

interface GeoLine {
  text: string;
  x: number;
  y: number;
  size: number;
}

/**
 * Steps within this factor of the smallest one are the same line pitch, read
 * with rounding jitter; the pitch is their median.
 */
const PITCH_CLUSTER = 1.1;

/**
 * The page's line pitch: the smallest cluster of baseline steps.
 *
 * Not a quantile of all the steps. Every quantile is a vote, and on a page of
 * one-line paragraphs the paragraph GAPS are the majority: the lower quartile
 * landed on the gap once no more than a quarter of the steps were wraps (a
 * page of two-line paragraphs did the same to the median), nothing exceeded
 * 1.3x it, and the whole page merged. A single wrapped line is enough to show
 * the pitch, so the smallest steps decide, not the most common ones.
 *
 * The price: one page that mixes line spacings at the body size (a
 * single-spaced block quote inside double-spaced text) takes the tighter
 * pitch, and the looser text then splits line by line. Over-splitting keeps
 * every word in order; the merge it replaces lost every boundary on the page.
 */
function linePitch(steps: number[]): number | null {
  if (!steps.length) return null;
  const sorted = [...steps].sort((a, b) => a - b);
  const cluster = sorted.filter((s) => s <= sorted[0]! * PITCH_CLUSTER);
  return cluster[Math.floor((cluster.length - 1) / 2)]!;
}

function geoLines(lines: readonly TextLine[] | null): GeoLine[] | null {
  if (!lines) return null;
  const out: GeoLine[] = [];
  for (const line of lines) {
    const text = collapseWhitespace(line.text);
    if (!text) continue;
    // A line with visible text but no geometry means the input did not come
    // from `extractPdfLines`; the whole page then uses the text fallback
    // rather than a half-geometric guess.
    if (line.x === null || line.y === null || line.size === null) return null;
    out.push({ text, x: line.x, y: line.y, size: line.size });
  }
  return out;
}

/**
 * The size most of the document's characters are set in. Weighted by
 * characters, not lines, so a page of short large headings cannot outvote the
 * body text under them; document-wide, so a cover page set entirely in large
 * type still has its title recognised as one.
 */
function bodySizeOf(pages: GeoLine[][]): number | null {
  const weighted: { size: number; chars: number }[] = [];
  let total = 0;
  for (const line of pages.flat()) {
    weighted.push({ size: line.size, chars: line.text.length });
    total += line.text.length;
  }
  if (!total) return null;
  weighted.sort((a, b) => a.size - b.size);
  let seen = 0;
  for (const entry of weighted) {
    seen += entry.chars;
    if (seen * 2 >= total) return entry.size;
  }
  return null;
}

const nearly = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance;

function isHeadingLine(line: GeoLine, bodySize: number): boolean {
  return (
    line.size >= bodySize * HEADING_SIZE_RATIO &&
    line.text.length <= HEADING_MAX_CHARS &&
    /\p{L}/u.test(line.text) &&
    !/[.,;]$/.test(line.text) &&
    // A numbered heading ("1. Introduction", "2) Results") is the usual style
    // in reports, papers and contracts, so an ordered marker does not stop a
    // heading-size line; a bullet does. Until audit #8 (2026-11-06) any
    // marker did, and numbered headings came out as ordered-list items.
    !GLYPH_BULLET.test(line.text) &&
    !ASCII_BULLET.test(line.text)
  );
}

/**
 * Whether `next` opens the list item that would follow `line` if `line` were
 * one: one pitch below, on the same left edge, with the next ordered number
 * and the same delimiter, or the same ASCII bullet.
 */
function startsSiblingItem(
  line: GeoLine,
  next: GeoLine | undefined,
  pitch: number,
): boolean {
  if (!next) return false;
  const step = line.y - next.y;
  if (
    step <= 0 ||
    step > pitch * PARAGRAPH_GAP_RATIO ||
    !nearly(next.x, line.x, line.size * 0.3) ||
    !nearly(next.size, line.size, line.size * 0.15)
  ) {
    return false;
  }
  const ordered = ORDERED_ITEM.exec(line.text)?.[1];
  if (ordered) {
    const n = Number(ordered.slice(0, -1));
    return ORDERED_ITEM.exec(next.text)?.[1] === `${n + 1}${ordered.at(-1)}`;
  }
  const bullet = ASCII_BULLET.exec(line.text)?.[0].trim();
  return (
    bullet !== undefined && ASCII_BULLET.exec(next.text)?.[0].trim() === bullet
  );
}

/** A line that closes its sentence or lead-in, before any closing quote or bracket. */
const ENDS_CLAUSE = /[.!?:;]["'\u201D\u2019)\]]*$/;

/**
 * Rebuild a page's blocks from where its lines sit.
 *
 * pdfjs marks the END of a visual line (`hasEOL`) but never a paragraph: it
 * emits one EOL however large the vertical gap, so plain text reaches this
 * module with no blank lines at all and every page used to collapse into one
 * paragraph. Paragraphs are recovered from the baseline steps instead.
 */
function blocksFromGeometry(
  lines: GeoLine[],
  bodySize: number,
  /** Blocks to place before `lines[index]` (or at the end), ending the open one. */
  inserts: ReadonlyMap<number, Block[]> = new Map(),
): Block[] {
  // The page's line pitch, from the steps between consecutive body-size
  // lines (see `linePitch`). Steps under half a line are super/subscript
  // shifts, not lines. A page with no wrapped line at all has only gap steps,
  // so its smallest step IS the gap and it stays one paragraph: a known
  // limitation, pinned as such in the tests.
  const steps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1]!;
    const cur = lines[i]!;
    const step = prev.y - cur.y;
    if (
      nearly(prev.size, bodySize, bodySize * 0.15) &&
      nearly(cur.size, bodySize, bodySize * 0.15) &&
      step >= bodySize * 0.5
    ) {
      steps.push(step);
    }
  }
  const pitch = linePitch(steps) ?? bodySize * 1.2;

  // Left edges body lines share: a margin, a column's margin, a list's
  // hanging indent. Bucketed to whole points; an edge is an x at least two
  // lines start on. Used for first-line-indent paragraphs (LaTeX, books,
  // justified web text) that have no extra vertical gap at all.
  //
  // Not the median x: measured on a Chrome-printed two-column page it landed
  // on the INDENT (116pt, not the 100pt margin), because a page of short
  // paragraphs has many first lines, and every paragraph merged.
  const edgeCounts = new Map<number, number>();
  for (const line of lines) {
    if (!nearly(line.size, bodySize, bodySize * 0.15)) continue;
    const bucket = Math.round(line.x);
    edgeCounts.set(bucket, (edgeCounts.get(bucket) ?? 0) + 1);
  }
  const isEdge = (x: number) => {
    const bucket = Math.round(x);
    let count = 0;
    for (let b = bucket - 1; b <= bucket + 1; b += 1) {
      count += edgeCounts.get(b) ?? 0;
    }
    return count >= 2;
  };

  // A line the generator WRAPPED ran close to the right edge, so it is long
  // for its page; a short lead-in with no colon ("You will need") ended
  // early, and the list under it is a list. Characters stand in for width.
  let longest = 0;
  for (const line of lines) {
    if (nearly(line.size, bodySize, bodySize * 0.15)) {
      longest = Math.max(longest, line.text.length);
    }
  }
  const wrapChars = longest * 0.6;

  const blocks: Block[] = [];
  // The open block and the line that opened it.
  let open: { block: Block; anchor: GeoLine } | null = null;
  let prev: GeoLine | null = null;
  // A block's span runs from its top line's cap height to its bottom line's
  // descenders, so a link box drawn round the words falls inside it.
  const extend = (block: Block, line: GeoLine) => {
    const top = line.y + line.size;
    const bottom = line.y - line.size * 0.4;
    block.span = block.span
      ? {
          top: Math.max(block.span.top, top),
          bottom: Math.min(block.span.bottom, bottom),
        }
      : { top, bottom };
  };
  const start = (block: Block, line: GeoLine) => {
    extend(block, line);
    blocks.push(block);
    open = { block, anchor: line };
  };

  for (const [index, line] of lines.entries()) {
    const placed = inserts.get(index);
    if (placed) {
      blocks.push(...placed);
      open = null;
      prev = null;
    }
    const step = prev ? prev.y - line.y : 0;
    // A step back UP the page is a new column or an out-of-order block. It
    // ends the paragraph unless the sentence visibly runs on: the previous
    // line has no closing punctuation and this one starts in lower case —
    // flowed text crossing into the next column mid-sentence.
    const jump = prev !== null && step < -line.size * 0.5;
    const flowsOn =
      jump &&
      prev !== null &&
      !ENDS_CLAUSE.test(prev.text) &&
      /^\p{Ll}/u.test(line.text);
    const gapBreak =
      prev !== null &&
      (step > pitch * PARAGRAPH_GAP_RATIO || (jump && !flowsOn));
    const current = open as { block: Block; anchor: GeoLine } | null;

    // A wrap that merely STARTS like an ASCII or ordered marker ("1998. Since
    // then", "- 5 percent") is the paragraph running on, not a list: the
    // previous line left its sentence open, the step is one line, and this
    // line sits on the previous line's own left edge. A glyph bullet is never
    // a word, so it always opens an item. Until audit #8 (2026-11-06) such a
    // wrap cut one paragraph into three blocks with a fake item in the middle.
    const wrapsOn =
      current?.block.kind === "paragraph" &&
      prev !== null &&
      !gapBreak &&
      step > 0 &&
      !ENDS_CLAUSE.test(prev.text) &&
      prev.text.length >= wrapChars &&
      nearly(line.size, prev.size, prev.size * 0.15) &&
      nearly(line.x, prev.x, line.size * 0.3) &&
      !GLYPH_BULLET.test(line.text) &&
      // Looking back is not enough: a long lead-in with no colon reads as a
      // wrap too. The next line one pitch below, on the same edge, with the
      // sibling marker ("2." after "1.", "-" after "-") says it is a list.
      // Until the audit #8 review, that lead-in swallowed the first item.
      !startsSiblingItem(line, lines[index + 1], pitch);
    const item = wrapsOn ? null : listItem(line.text);
    // Heading size is asked first, so a numbered heading stays a heading.
    if (item && !isHeadingLine(line, bodySize)) {
      start({ kind: "item", marker: item.marker, lines: [item.content] }, line);
    } else if (isHeadingLine(line, bodySize)) {
      // A title wrapped over two lines is one heading: same size, and a step
      // no larger than that size's own line spacing.
      const heading = current?.block.kind === "heading" ? current.block : null;
      if (
        heading &&
        // A numbered line is its own heading (a slide's or a contents page's
        // "1. ..." then "2. ..."), never the second line of the one above.
        !ORDERED_ITEM.test(line.text) &&
        nearly(heading.size, line.size, line.size * 0.05) &&
        step > 0 &&
        step <= line.size * 1.6
      ) {
        heading.lines.push(line.text);
        extend(heading, line);
      } else {
        start({ kind: "heading", size: line.size, lines: [line.text] }, line);
      }
    } else {
      let continues =
        current !== null && !gapBreak && current.block.kind !== "heading";
      if (continues && current?.block.kind === "item") {
        // A wrapped list item hangs to the right of its bullet; a line back at
        // the bullet's own x is the paragraph after the list.
        continues = line.x > current.anchor.x + line.size * 0.3;
      } else if (continues && prev && !flowsOn) {
        // First-line indent: the previous line starts on a shared left edge
        // and this one starts one to five ems to the right of it.
        const indent = line.x - prev.x;
        if (
          isEdge(prev.x) &&
          indent >= line.size * 0.8 &&
          indent <= line.size * 5
        ) {
          continues = false;
        }
      }
      if (continues && current) {
        current.block.lines.push(line.text);
        extend(current.block, line);
      } else start({ kind: "paragraph", lines: [line.text] }, line);
    }
    prev = line;
  }
  blocks.push(...(inserts.get(lines.length) ?? []));
  return blocks;
}

/**
 * A line's identity across pages: case and spacing ignored, and every run of
 * digits the same, so "Page 3 of 30" and "Page 4 of 30" are one line, and so
 * are the bare numbers "3" and "4".
 */
const edgeKey = (text: string) =>
  collapseWhitespace(text).toLowerCase().replace(/\d+/g, "#");

/**
 * The running headers and footers of a document: for each page, the indices
 * of its lines to leave out.
 *
 * A line is left out when all of these hold:
 *  - it is one of the top or bottom {@link EDGE_LINES} lines of its page;
 *  - the same line (see `edgeKey`) is at an edge of at least
 *    {@link REPEATED_LINE_SHARE} of the pages with text, in a document of at
 *    least {@link REPEATED_LINE_MIN_PAGES} such pages, at the same height on
 *    each (within half its font size): a running header does not move;
 *  - where the line has digits, one of its numbers COUNTS THE PAGES — it is
 *    the page number plus the same offset on every page ("Page 3 of 30",
 *    "- 12 -"). Without that, "Step 1" and "Step 2" heading two pages would
 *    be one line.
 * A page is never emptied: one whose every line qualifies keeps them all.
 */
function repeatedEdgeLines(
  pages: readonly (GeoLine[] | null)[],
): Set<number>[] {
  const none = () => pages.map(() => new Set<number>());
  const candidates = pages.flatMap((lines, p) => {
    if (!lines?.length) return [];
    const byHeight = lines
      .map((line, i) => ({ line, i }))
      .sort((a, b) => b.line.y - a.line.y);
    const edge = new Map(
      [...byHeight.slice(0, EDGE_LINES), ...byHeight.slice(-EDGE_LINES)].map(
        (entry) => [entry.i, entry.line],
      ),
    );
    return [...edge].map(([i, line]) => ({
      page: p,
      i,
      line,
      key: edgeKey(line.text),
      numbers: [...line.text.matchAll(/\d+/g)].map((m) => Number(m[0])),
    }));
  });
  const counted = pages.filter((lines) => lines?.length).length;
  if (counted < REPEATED_LINE_MIN_PAGES) return none();
  const needed = Math.max(2, Math.ceil(counted * REPEATED_LINE_SHARE));

  const groups = new Map<string, typeof candidates>();
  for (const c of candidates) {
    groups.set(c.key, [...(groups.get(c.key) ?? []), c]);
  }
  const out = none();
  for (const group of groups.values()) {
    // One per page, at the height most of them share.
    const ys = group.map((c) => c.line.y).sort((a, b) => a - b);
    const y = ys[Math.floor(ys.length / 2)]!;
    let members = group.filter(
      (c) => Math.abs(c.line.y - y) <= c.line.size * 0.5,
    );
    const digits = members[0]?.numbers.length ?? 0;
    if (digits > 0) {
      // A number that is the page number plus one offset on every page.
      const counter = Array.from({ length: digits }, (_, k) => k).find((k) => {
        const offsets = new Set(members.map((c) => c.numbers[k]! - c.page));
        return offsets.size === 1;
      });
      const fixed = members.every(
        (c) => c.numbers.join() === members[0]!.numbers.join(),
      );
      if (counter === undefined && !fixed) members = [];
    }
    if (new Set(members.map((c) => c.page)).size < needed) continue;
    for (const c of members) out[c.page]!.add(c.i);
  }
  return out.map((set, p) =>
    set.size >= (pages[p]?.length ?? 0) ? new Set<number>() : set,
  );
}

/** Each non-space character of `texts`, sorted: what they say, in any order. */
const characters = (texts: readonly string[]) =>
  [...texts.join("").replace(/\s+/g, "")].sort().join("");

/**
 * Take each detected table's lines out of the page and say where its block
 * goes instead. A table's lines are the page's lines on its rows (baselines
 * from its first row to its last, give or take {@link TABLE_ROW_TOLERANCE} of
 * the body size), and they are replaced ONLY when they hold exactly the
 * table's characters: a line on the same rows that is not in the table (a
 * second column of prose beside it) means the table stays prose, so no word
 * is ever lost or written twice.
 */
function placeTables(
  lines: GeoLine[],
  tables: readonly MarkdownTable[],
  bodySize: number,
): { lines: GeoLine[]; inserts: Map<number, Block[]>; placed: number } {
  const tolerance = bodySize * TABLE_ROW_TOLERANCE;
  const taken = new Set<number>();
  const at: { index: number; block: Block }[] = [];
  for (const table of tables) {
    const indices = lines.flatMap((line, i) =>
      line.y <= table.top + tolerance && line.y >= table.bottom - tolerance
        ? [i]
        : [],
    );
    if (
      !indices.length ||
      indices.some((i) => taken.has(i)) ||
      characters(indices.map((i) => lines[i]!.text)) !==
        characters(table.rows.flat())
    ) {
      continue;
    }
    for (const i of indices) taken.add(i);
    const size = Math.max(...indices.map((i) => lines[i]!.size));
    at.push({
      index: indices[0]!,
      block: {
        kind: "table",
        rows: table.rows,
        lines: [],
        span: { top: table.top + size, bottom: table.bottom - size * 0.4 },
      },
    });
  }
  const kept: GeoLine[] = [];
  const inserts = new Map<number, Block[]>();
  lines.forEach((line, i) => {
    for (const { block } of at.filter((a) => a.index === i)) {
      inserts.set(kept.length, [...(inserts.get(kept.length) ?? []), block]);
    }
    if (!taken.has(i)) kept.push(line);
  });
  return { lines: kept, inserts, placed: at.length };
}

/* ------------------------------------------------------------------ *
 *  Document
 * ------------------------------------------------------------------ */

export function extractedTextToMarkdown(
  extracted: PdfToMarkdownInput,
  options: PdfToMarkdownOptions = {},
): PdfToMarkdownResult {
  if (!extracted.hasText) {
    return {
      markdown: "",
      pageCount: extracted.pageCount,
      characterCount: 0,
      hasMarkdown: false,
      linkCount: 0,
      tableCount: 0,
      removedLineCount: 0,
    };
  }

  const includePageHeadings =
    options.includePageHeadings ?? extracted.pageCount > 1;

  const read = extracted.pages.map((page) => geoLines(page.lines));
  const repeated =
    (options.removeRepeatedLines ?? DEFAULT_REMOVE_REPEATED_LINES)
      ? repeatedEdgeLines(read)
      : read.map(() => new Set<number>());
  const removedLineCount = repeated.reduce((sum, set) => sum + set.size, 0);
  const geometry = read.map(
    (lines, p) => lines?.filter((_, i) => !repeated[p]!.has(i)) ?? null,
  );
  const bodySize = bodySizeOf(
    geometry.filter((lines): lines is GeoLine[] => lines !== null),
  );
  let tableCount = 0;
  const pageBlocks = extracted.pages.map((page, index) => {
    const lines = geometry[index];
    if (!lines || bodySize === null) return blocksFromText(page.text);
    const tables = placeTables(lines, page.tables ?? [], bodySize);
    tableCount += tables.placed;
    return blocksFromGeometry(tables.lines, bodySize, tables.inserts);
  });

  // Headings nest under the outline this function already writes: `#` is the
  // document and `##` each page, so a detected heading starts one level below
  // whichever of those is the deepest present — never a second H1, never a
  // collision with `## Page N`. Larger sizes rank higher, document-wide.
  const baseLevel = includePageHeadings ? 3 : 2;
  const headingSizes = [
    ...new Set(
      pageBlocks
        .flat()
        .flatMap((block) =>
          block.kind === "heading" ? [headingKey(block.size)] : [],
        ),
    ),
  ].sort((a, b) => b - a);
  const headingLevel = (size: number) =>
    Math.min(
      6,
      baseLevel + Math.max(0, headingSizes.indexOf(headingKey(size))),
    );

  const sections: string[] = [
    `# ${escapeInline(normalizeMarkdownLine(titleFromSource(options.sourceName)))}`,
  ];
  let linkCount = 0;
  extracted.pages.forEach((page, index) => {
    const linker = pageLinker(page.links ?? []);
    const pageMarkdown = renderBlocks(
      pageBlocks[index] ?? [],
      headingLevel,
      linker,
    );
    linkCount += linker.count();
    if (!pageMarkdown) return;
    if (includePageHeadings) sections.push(`## Page ${page.pageNumber}`);
    sections.push(pageMarkdown);
  });

  const markdown = sections.join("\n\n").trim();
  return {
    markdown,
    pageCount: extracted.pageCount,
    characterCount: markdown.length,
    hasMarkdown: markdown.length > 0,
    linkCount,
    tableCount,
    removedLineCount,
  };
}
