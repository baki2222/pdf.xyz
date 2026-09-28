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
};

export type PdfToMarkdownInput = Pick<
  ExtractedPdfText,
  "pageCount" | "text" | "characterCount" | "hasText"
> & { pages: PdfToMarkdownPage[] };

export interface PdfToMarkdownOptions {
  sourceName?: string;
  includePageHeadings?: boolean;
}

export interface PdfToMarkdownResult {
  markdown: string;
  pageCount: number;
  characterCount: number;
  hasMarkdown: boolean;
}

export function markdownOutputName(sourceName: string): string {
  return outputName(sourceName, "markdown", "md");
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
const BULLET_GLYPHS =
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

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "item"; marker: string; lines: string[] }
  | { kind: "heading"; size: number; lines: string[] };

/** Heading font sizes are bucketed to half a point before being ranked. */
const headingKey = (size: number) => Math.round(size * 2) / 2;

function renderBlock(block: Block, headingLevel: (size: number) => number) {
  const text = escapeInline(joinWrappedLines(block.lines));
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
): string {
  let out = "";
  let previous: Block | null = null;
  for (const block of blocks) {
    const rendered = renderBlock(block, headingLevel);
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
const HEADING_MAX_CHARS = 80;

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
    listItem(line.text) === null
  );
}

/**
 * Rebuild a page's blocks from where its lines sit.
 *
 * pdfjs marks the END of a visual line (`hasEOL`) but never a paragraph: it
 * emits one EOL however large the vertical gap, so plain text reaches this
 * module with no blank lines at all and every page used to collapse into one
 * paragraph. Paragraphs are recovered from the baseline steps instead.
 */
function blocksFromGeometry(lines: GeoLine[], bodySize: number): Block[] {
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

  const blocks: Block[] = [];
  // The open block and the line that opened it.
  let open: { block: Block; anchor: GeoLine } | null = null;
  let prev: GeoLine | null = null;
  const start = (block: Block, line: GeoLine) => {
    blocks.push(block);
    open = { block, anchor: line };
  };

  for (const line of lines) {
    const step = prev ? prev.y - line.y : 0;
    // A step back UP the page is a new column or an out-of-order block. It
    // ends the paragraph unless the sentence visibly runs on: the previous
    // line has no closing punctuation and this one starts in lowercase —
    // flowed text crossing into the next column mid-sentence.
    const jump = prev !== null && step < -line.size * 0.5;
    const flowsOn =
      jump &&
      prev !== null &&
      !/[.!?:;]["'\u201D\u2019)\]]*$/.test(prev.text) &&
      /^\p{Ll}/u.test(line.text);
    const gapBreak =
      prev !== null &&
      (step > pitch * PARAGRAPH_GAP_RATIO || (jump && !flowsOn));
    const current = open as { block: Block; anchor: GeoLine } | null;

    const item = listItem(line.text);
    if (item) {
      start({ kind: "item", marker: item.marker, lines: [item.content] }, line);
    } else if (isHeadingLine(line, bodySize)) {
      // A title wrapped over two lines is one heading: same size, and a step
      // no larger than that size's own line spacing.
      const heading = current?.block.kind === "heading" ? current.block : null;
      if (
        heading &&
        nearly(heading.size, line.size, line.size * 0.05) &&
        step > 0 &&
        step <= line.size * 1.6
      ) {
        heading.lines.push(line.text);
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
      if (continues && current) current.block.lines.push(line.text);
      else start({ kind: "paragraph", lines: [line.text] }, line);
    }
    prev = line;
  }
  return blocks;
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
    };
  }

  const includePageHeadings =
    options.includePageHeadings ?? extracted.pageCount > 1;

  const geometry = extracted.pages.map((page) => geoLines(page.lines));
  const bodySize = bodySizeOf(
    geometry.filter((lines): lines is GeoLine[] => lines !== null),
  );
  const pageBlocks = extracted.pages.map((page, index) => {
    const lines = geometry[index];
    return lines && bodySize !== null
      ? blocksFromGeometry(lines, bodySize)
      : blocksFromText(page.text);
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
  extracted.pages.forEach((page, index) => {
    const pageMarkdown = renderBlocks(pageBlocks[index] ?? [], headingLevel);
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
  };
}
