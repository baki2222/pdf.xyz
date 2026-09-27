import type { PDFDocument, PDFFont, PDFPage, RGB as PdfLibRGB } from "pdf-lib";
import { loadPdfLib } from "./pdf-lib";
import { outputName } from "./files";
import { PdfEngineError } from "./engine";
import { embedDrawingFont } from "./unicode-font";
import { TEXT_PAGE_MARGIN_PT, US_LETTER_PT } from "./page-geometry";
import { MARKDOWN_BLOCK_KINDS } from "./markdown-blocks";

export { MARKDOWN_BLOCK_KINDS };

const PRODUCER = "pdf.xyz";
// The page geometry the tool page states — one value, see ./page-geometry.
const PAGE_WIDTH = US_LETTER_PT.width;
const PAGE_HEIGHT = US_LETTER_PT.height;
const MARGIN = TEXT_PAGE_MARGIN_PT;
const BODY_SIZE = 11;
const BODY_LINE_HEIGHT = 16;
// The cap the tool page advertises, so the gate and the promise are one value.
import {
  MAX_SOURCE_BYTES as MAX_MARKDOWN_BYTES,
  MAX_SOURCE_MB,
} from "@/lib/tools/limits";

export type MarkdownBlock =
  | { kind: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list-item"; ordered: boolean; index?: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; language?: string; text: string };

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

function stripInlineMarkdown(input: string): string {
  return (
    input
      // Images: keep alt text and URL so the output remains honest about omitted images.
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) =>
        alt ? `${alt} (${url})` : url,
      )
      // Links: preserve visible label + URL.
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, label: string, url: string) => `${label} (${url})`,
      )
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/\\([\\`*{}_\[\]()#+\-.!>])/g, "$1")
      .trim()
  );
}

function flushParagraph(lines: string[], blocks: MarkdownBlock[]): void {
  if (!lines.length) return;
  const text = stripInlineMarkdown(lines.join(" ").replace(/\s+/g, " "));
  if (text) blocks.push({ kind: "paragraph", text });
  lines.length = 0;
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  const paragraph: string[] = [];
  let inCode = false;
  let codeLanguage: string | undefined;
  let codeLines: string[] = [];

  for (const rawLine of lines) {
    const fence = rawLine.match(/^\s*```\s*([^`]*)\s*$/);
    if (fence) {
      if (inCode) {
        blocks.push({
          kind: "code",
          language: codeLanguage,
          text: codeLines.join("\n"),
        });
        inCode = false;
        codeLanguage = undefined;
        codeLines = [];
      } else {
        flushParagraph(paragraph, blocks);
        inCode = true;
        codeLanguage = fence[1]?.trim() || undefined;
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushParagraph(paragraph, blocks);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(paragraph, blocks);
      blocks.push({
        kind: "heading",
        depth: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        text: stripInlineMarkdown(heading[2]!),
      });
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph(paragraph, blocks);
      blocks.push({
        kind: "list-item",
        ordered: false,
        text: stripInlineMarkdown(unordered[1]!),
      });
      continue;
    }

    const ordered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph(paragraph, blocks);
      blocks.push({
        kind: "list-item",
        ordered: true,
        index: Number(ordered[1]),
        text: stripInlineMarkdown(ordered[2]!),
      });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph(paragraph, blocks);
      blocks.push({ kind: "quote", text: stripInlineMarkdown(quote[1]!) });
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inCode) {
    blocks.push({
      kind: "code",
      language: codeLanguage,
      text: codeLines.join("\n"),
    });
  }
  flushParagraph(paragraph, blocks);
  return blocks;
}

function wrapText(
  text: string,
  font: PDFFont,
  maxWidth: number,
  size: number,
): string[] {
  if (!text) return [""];
  const words = text.split(/(\s+)/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current + word;
    if (current && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(current.trimEnd());
      current = word.trimStart();
    } else {
      current = next;
    }
  }
  if (current || !lines.length) lines.push(current.trimEnd());
  return lines;
}

/**
 * Every string this renderer will hand to `drawText`, including the decorations
 * it invents.
 *
 * Kept next to {@link drawBlock} and mirroring its cases on purpose: a new block
 * kind that draws a new marker has to be added in both, and the two sitting
 * together is the cheapest way to make that obvious. `markdown-to-pdf.test.ts`
 * pins the bullet specifically, because that is the character that broke.
 */
function drawnStrings(blocks: MarkdownBlock[], title: string): string[] {
  const out = [title];
  for (const block of blocks) {
    if (block.kind === "list-item") {
      const marker = block.ordered ? `${block.index ?? 1}. ` : "• ";
      out.push(`${marker}${block.text}`);
      continue;
    }
    if (block.kind === "code") {
      if (block.language) out.push(block.language);
      out.push(block.text);
      continue;
    }
    out.push(block.text);
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

function drawBlock(cursor: Cursor, block: MarkdownBlock): void {
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  switch (block.kind) {
    case "heading": {
      const size = block.depth === 1 ? 22 : block.depth === 2 ? 17 : 14;
      const lineHeight = size + 9;
      cursor.y -= block.depth === 1 ? 8 : 4;
      drawLines(
        cursor,
        wrapText(block.text, cursor.fonts.bold, maxWidth, size),
        {
          x: MARGIN,
          size,
          lineHeight,
          font: cursor.fonts.bold,
          color: cursor.rgb(0.05, 0.07, 0.14),
        },
      );
      cursor.y -= 4;
      return;
    }
    case "paragraph":
      drawLines(
        cursor,
        wrapText(block.text, cursor.fonts.body, maxWidth, BODY_SIZE),
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
      const marker = block.ordered ? `${block.index ?? 1}. ` : "• ";
      drawLines(
        cursor,
        wrapText(
          `${marker}${block.text}`,
          cursor.fonts.body,
          maxWidth - 18,
          BODY_SIZE,
        ),
        {
          x: MARGIN + 18,
          size: BODY_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          font: cursor.fonts.body,
        },
      );
      return;
    }
    case "quote":
      cursor.page.drawRectangle({
        x: MARGIN,
        y: Math.max(MARGIN, cursor.y - BODY_LINE_HEIGHT),
        width: 3,
        height: BODY_LINE_HEIGHT,
        color: cursor.rgb(0.45, 0.36, 0.95),
      });
      drawLines(
        cursor,
        wrapText(block.text, cursor.fonts.italic, maxWidth - 18, BODY_SIZE),
        {
          x: MARGIN + 14,
          size: BODY_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          font: cursor.fonts.italic,
          color: cursor.rgb(0.24, 0.27, 0.38),
        },
      );
      cursor.y -= 5;
      return;
    case "code": {
      if (block.language) {
        drawLines(cursor, [block.language], {
          x: MARGIN,
          size: 8,
          lineHeight: 12,
          font: cursor.fonts.bold,
          color: cursor.rgb(0.37, 0.39, 0.48),
        });
      }
      for (const line of block.text.split("\n")) {
        drawLines(
          cursor,
          wrapText(line || " ", cursor.fonts.mono, maxWidth - 16, 9),
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
  }
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
  // the list markers this renderer synthesises — "• " is U+2022, which is inside
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
  cursor.page.drawText(title, {
    x: MARGIN,
    y: PAGE_HEIGHT - 34,
    size: 9,
    font: fonts.bold,
    color: cursor.rgb(0.35, 0.38, 0.45),
  });
  cursor.y -= 10;
  for (const block of blocks) drawBlock(cursor, block);
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    page.drawText(`${index + 1} / ${pages.length}`, {
      x: PAGE_WIDTH - MARGIN - 32,
      y: 28,
      size: 8,
      font: fonts.mono,
      color: cursor.rgb(0.45, 0.48, 0.55),
    });
  });
  return doc.save();
}
