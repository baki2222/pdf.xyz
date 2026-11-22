import type { PDFFont } from "pdf-lib";
import { loadPdfLib } from "./pdf-lib";
import { outputName } from "./files";
import { PdfEngineError } from "./engine";
import { embedDrawingFont } from "./unicode-font";
import {
  DEFAULT_TEXT_PAGE_OPTIONS,
  TEXT_TAB_STOP,
  textPageGeometry,
  type TextPageGeometry,
  type TextPageOptions,
} from "./text-page-options";
import { stripControls } from "@/lib/text/decode-text-file";
import { MAX_TEXT_PAGES, TOO_MANY_TEXT_PAGES } from "./text-page-ceiling";
import { wrapTextLine } from "./text-wrap";

const PRODUCER = "pdf.xyz";
// The page the tool page states, from one table (./text-page-options): the
// engine's default is the US Letter, 11 pt page it drew before it had options.
const DEFAULT_GEOMETRY = textPageGeometry(DEFAULT_TEXT_PAGE_OPTIONS);
// The cap the tool page advertises, so the gate and the promise are one value.
import {
  MAX_SOURCE_BYTES as MAX_TEXT_BYTES,
  MAX_SOURCE_MB,
} from "@/lib/tools/limits";

export interface TextToPdfOptions extends Partial<TextPageOptions> {
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
    throw new PdfEngineError("Add some text or choose a non-empty .txt file.");
  }
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_TEXT_BYTES) {
    throw new PdfEngineError(
      `This text file is too large for in-browser conversion (max ${MAX_SOURCE_MB} MB).`,
    );
  }
}

export { wrapTextLine };

export function textPdfOutputName(sourceName: string): string {
  return outputName(sourceName || "text", "pdf", "pdf");
}

const TAB = String.fromCharCode(9);

/**
 * Each tab moved to the next tab stop, every {@link TEXT_TAB_STOP} characters
 * counted from the start of its line, as a terminal or a text editor draws
 * it, so tab-separated columns line up (audit wave 2, text-to-pdf#7). A tab
 * that sits on a stop moves a whole stop. Until then every tab became four
 * spaces wherever it stood, and a TSV's columns drifted row by row.
 */
export function expandTabs(text: string, stop: number = TEXT_TAB_STOP): string {
  if (!text.includes(TAB)) return text;
  return text
    .split("\n")
    .map((line) => {
      let out = "";
      for (const ch of line) {
        if (ch === TAB) out += " ".repeat(stop - (out.length % stop));
        else out += ch;
      }
      return out;
    })
    .join("\n");
}

function normalizeInput(text: string): string {
  return expandTabs(text.replace(/\r\n?/g, "\n"));
}

/** U+000C, built from its code: the page break of RFCs and man pages. */
const FORM_FEED = String.fromCharCode(0x0c);

/**
 * Text that can be drawn, and how many control characters were dropped to get
 * it. Form feeds are kept: {@link layoutPlainText} starts a new page at each.
 */
export function printablePlainText(text: string): {
  text: string;
  removed: number;
} {
  return stripControls(text, { keepFormFeeds: true });
}

/**
 * Lines wrapped to the column and cut into pages. A form feed ends the page it
 * is on, as a printer would; one after the last text adds no empty page.
 * Throws {@link TOO_MANY_TEXT_PAGES} at the first page over
 * {@link MAX_TEXT_PAGES}, so the work stops there (hostile matrix CI-11).
 * Measured at `geometry`'s text size, and cut at its lines per page.
 */
export function layoutPlainText(
  text: string,
  font: PDFFont,
  geometry: Pick<
    TextPageGeometry,
    "maxWidth" | "linesPerPage" | "fontSize"
  > = DEFAULT_GEOMETRY,
): TextLayout {
  const { maxWidth, linesPerPage, fontSize } = geometry;
  const sections = normalizeInput(text).split(FORM_FEED);
  while (sections.length > 1 && !sections.at(-1)!.trim()) sections.pop();
  const pages: TextLayoutPage[] = [];
  let lineCount = 0;
  for (const section of sections) {
    const lines = section
      .split("\n")
      .flatMap((line) => wrapTextLine(line, font, maxWidth, fontSize));
    lineCount += lines.length;
    for (let i = 0; i < lines.length; i += linesPerPage) {
      if (pages.length === MAX_TEXT_PAGES)
        throw new PdfEngineError(TOO_MANY_TEXT_PAGES);
      pages.push({ lines: lines.slice(i, i + linesPerPage) });
    }
  }
  return {
    pages: pages.length ? pages : [{ lines: [""] }],
    lineCount,
  };
}

/** The page choices in `options`, without the keys left unset. */
function pageOf(options: TextToPdfOptions): Partial<TextPageOptions> {
  const page: Partial<TextPageOptions> = {};
  if (options.pageSize !== undefined) page.pageSize = options.pageSize;
  if (options.orientation !== undefined) page.orientation = options.orientation;
  if (options.fontSize !== undefined) page.fontSize = options.fontSize;
  return page;
}

/** Convert plain text into a clean, paginated, in-browser PDF. */
export async function textToPdf(
  text: string,
  options: TextToPdfOptions = {},
): Promise<Uint8Array> {
  // Pasted and typed text is cleaned here, not only a loaded file: an ESC
  // colour code or a bell reached the font check, which refused the document
  // naming an invisible character (audit #34). Text that was nothing but
  // control characters is empty, and refused as empty.
  const printable = printablePlainText(text).text;
  validatePlainTextInput(printable.split(FORM_FEED).join(""));
  text = printable;
  const { PDFDocument, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const title = (options.title ?? "Text document").trim() || "Text document";
  // The body font also draws the "1 / 3" footer, so its corpus is the document
  // text plus the title; the title font's corpus is the title alone. Western
  // input takes the same Courier/Helvetica-Bold pair this tool has always used
  // and downloads nothing. A Bengali or Chinese .txt gets a real face instead
  // of the refusal it used to get, and the layout below measures with THAT
  // font — wrapping non-Latin text against Courier's metrics would have put
  // every line break in the wrong place.
  const font = await embedDrawingFont(
    doc,
    [text.split(FORM_FEED).join(" "), title],
    "mono",
  );
  const bold = await embedDrawingFont(doc, [title], "sans-bold");
  const g = textPageGeometry({
    ...DEFAULT_TEXT_PAGE_OPTIONS,
    ...pageOf(options),
  });
  const layout = layoutPlainText(text, font, g);

  doc.setTitle(title);
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);

  layout.pages.forEach((pageLayout, index) => {
    const page = doc.addPage([g.width, g.height]);
    page.drawText(title, {
      x: g.margin,
      y: g.height - 34,
      size: 9,
      font: bold,
      color: rgb(0.35, 0.38, 0.45),
      maxWidth: g.maxWidth,
    });
    page.drawText(`${index + 1} / ${layout.pages.length}`, {
      x: g.width - g.margin - 32,
      y: 28,
      size: 8,
      font,
      color: rgb(0.45, 0.48, 0.55),
    });

    let y = g.height - g.margin;
    for (const line of pageLayout.lines) {
      page.drawText(line || " ", {
        x: g.margin,
        y,
        size: g.fontSize,
        font,
        color: rgb(0.08, 0.1, 0.16),
      });
      y -= g.lineHeight;
    }
  });

  return doc.save();
}
