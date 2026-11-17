/**
 * Wrapping a line of text to a column, measured with the font that draws it:
 * Text to PDF's and Markdown to PDF's one rule. Its own module (2026-11-16)
 * so Markdown to PDF, which needs only this, does not load Text to PDF's
 * page-setup tables with it — that cost markdown-to-pdf's first load about
 * 1 KB gz when the tables arrived (audit backlog #5).
 */
import type { PDFFont } from "pdf-lib";

function splitLongWord(
  word: string,
  font: PDFFont,
  maxWidth: number,
  fontSize: number,
): string[] {
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
  fontSize: number,
): string[] {
  if (line.length === 0) return [""];
  const words = line.split(/(\s+)/).filter((part) => part.length > 0);
  const wrapped: string[] = [];
  let current = "";

  for (const part of words) {
    const candidates =
      font.widthOfTextAtSize(part, fontSize) > maxWidth
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
