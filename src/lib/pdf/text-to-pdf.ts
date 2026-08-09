import type { PDFFont } from "pdf-lib";
import { loadPdfLib } from "./pdf-lib";
import { outputName } from "./files";
import { PdfEngineError } from "./engine";

const PRODUCER = "pdf.xyz";
const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const FONT_SIZE = 11;
const LINE_HEIGHT = 16;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export interface TextToPdfOptions {
  title?: string;
}

export interface TextLayoutPage {
  lines: string[];
}

export interface TextLayout {
  pages: TextLayoutPage[];
  lineCount: number;
}

/** Keep user text readable and avoid accidentally rendering huge files in-browser. */
export function validatePlainTextInput(text: string): void {
  if (text.trim().length === 0) {
    throw new PdfEngineError("Add some text or upload a non-empty .txt file.");
  }
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_TEXT_BYTES) {
    throw new PdfEngineError("This text file is too large for in-browser conversion (max 2 MB).");
  }
}

export function textPdfOutputName(sourceName: string): string {
  return outputName(sourceName || "text", "pdf", "pdf");
}

function normalizeInput(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}

function splitLongWord(word: string, font: PDFFont, maxWidth: number, fontSize: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const char of word) {
    const next = current + char;
    if (current && font.widthOfTextAtSize(next, fontSize) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function wrapTextLine(
  line: string,
  font: PDFFont,
  maxWidth: number,
  fontSize = FONT_SIZE,
): string[] {
  if (line.length === 0) return [""];
  const words = line.split(/(\s+)/).filter((part) => part.length > 0);
  const wrapped: string[] = [];
  let current = "";

  for (const part of words) {
    const candidates = font.widthOfTextAtSize(part, fontSize) > maxWidth
      ? splitLongWord(part, font, maxWidth, fontSize)
      : [part];

    for (const piece of candidates) {
      const next = current + piece;
      if (current && font.widthOfTextAtSize(next, fontSize) > maxWidth) {
        wrapped.push(current.trimEnd());
        current = piece.trimStart();
      } else {
        current = next;
      }
    }
  }
  if (current || wrapped.length === 0) wrapped.push(current.trimEnd());
  return wrapped;
}

export function layoutPlainText(
  text: string,
  font: PDFFont,
  maxWidth = PAGE_WIDTH - MARGIN * 2,
  linesPerPage = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT),
): TextLayout {
  const normalized = normalizeInput(text);
  const allLines = normalized.split("\n").flatMap((line) =>
    wrapTextLine(line, font, maxWidth),
  );
  const pages: TextLayoutPage[] = [];
  for (let i = 0; i < allLines.length; i += linesPerPage) {
    pages.push({ lines: allLines.slice(i, i + linesPerPage) });
  }
  return { pages: pages.length ? pages : [{ lines: [""] }], lineCount: allLines.length };
}

/** Convert plain text into a clean, paginated, in-browser PDF. */
export async function textToPdf(
  text: string,
  options: TextToPdfOptions = {},
): Promise<Uint8Array> {
  validatePlainTextInput(text);
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const layout = layoutPlainText(text, font);
  const title = (options.title ?? "Text document").trim() || "Text document";

  doc.setTitle(title);
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);

  layout.pages.forEach((pageLayout, index) => {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText(title, {
      x: MARGIN,
      y: PAGE_HEIGHT - 34,
      size: 9,
      font: bold,
      color: rgb(0.35, 0.38, 0.45),
      maxWidth: PAGE_WIDTH - MARGIN * 2,
    });
    page.drawText(`${index + 1} / ${layout.pages.length}`, {
      x: PAGE_WIDTH - MARGIN - 32,
      y: 28,
      size: 8,
      font,
      color: rgb(0.45, 0.48, 0.55),
    });

    let y = PAGE_HEIGHT - MARGIN;
    for (const line of pageLayout.lines) {
      page.drawText(line || " ", {
        x: MARGIN,
        y,
        size: FONT_SIZE,
        font,
        color: rgb(0.08, 0.1, 0.16),
      });
      y -= LINE_HEIGHT;
    }
  });

  return doc.save();
}
