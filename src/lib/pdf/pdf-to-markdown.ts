import { baseName, outputName } from "./files";
import type { ExtractedPdfText, ExtractedTextPage } from "./text";

export type PdfToMarkdownInput = Pick<
  ExtractedPdfText,
  "pageCount" | "pages" | "text" | "characterCount" | "hasText"
>;

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

/** Escape only line-leading Markdown control sequences we might otherwise invent. */
export function normalizeMarkdownLine(line: string): string {
  const trimmed = line.replace(/[\t ]+/g, " ").trim();
  if (!trimmed) return "";
  if (/^(#{1,6}\s)/.test(trimmed)) return `\\${trimmed}`;
  if (/^([-*_])\s*$/.test(trimmed)) return `\\${trimmed}`;
  return trimmed;
}

function isListLine(line: string): boolean {
  return /^([-*+]\s+|\d+[.)]\s+)/.test(line.trim());
}

function normalizeParagraph(lines: string[]): string {
  return lines
    .map(normalizeMarkdownLine)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageTextToMarkdown(page: Pick<ExtractedTextPage, "text">): string {
  const lines = page.text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    const text = normalizeParagraph(paragraph);
    if (text) blocks.push(text);
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = normalizeMarkdownLine(rawLine);
    if (!line) {
      flush();
      continue;
    }
    if (isListLine(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks.join("\n\n");
}

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
  const sections: string[] = [
    `# ${normalizeMarkdownLine(titleFromSource(options.sourceName))}`,
  ];

  for (const page of extracted.pages) {
    const pageMarkdown = pageTextToMarkdown(page);
    if (!pageMarkdown) continue;
    if (includePageHeadings) sections.push(`## Page ${page.pageNumber}`);
    sections.push(pageMarkdown);
  }

  const markdown = sections.join("\n\n").trim();
  return {
    markdown,
    pageCount: extracted.pageCount,
    characterCount: markdown.length,
    hasMarkdown: markdown.length > 0,
  };
}
