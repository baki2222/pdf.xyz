import type { PDFDocument, PDFFont, PDFPage, PDFRef } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";
import { embedDrawingFont } from "./unicode-font";

/**
 * Merge PDF's "Add a contents page": pages put IN FRONT of the merged pages,
 * listing each file by name with the page it starts on, every line a link
 * (an explicit `/Dest` to that page object, so it survives any later page
 * renumbering in a viewer). The numbers are the merged file's own page
 * numbers, contents pages included, so "7" is the seventh page a viewer
 * shows. Bookmarks point at page OBJECTS, not indexes, so they keep opening
 * the right page when the contents pages are inserted before them.
 */

export interface ContentsEntry {
  title: string;
  /** The entry's first page in the merged document, before contents pages. */
  page: PDFPage;
}

const MARGIN = 56;
const TITLE_SIZE = 20;
const ENTRY_SIZE = 11;
const LINE = 20;
const TITLE_GAP = 40;

/** Heading on every contents page. */
export const CONTENTS_TITLE = "Contents";

/** How many entries fit a contents page of `height` points. */
export function entriesPerPage(height: number): number {
  return Math.max(
    1,
    Math.floor((height - 2 * MARGIN - TITLE_SIZE - TITLE_GAP) / LINE) + 1,
  );
}

/** The longest prefix of `text` that fits `width`, with an ellipsis if cut. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const s = `${chars.slice(0, mid).join("").trimEnd()}…`;
    if (font.widthOfTextAtSize(s, size) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join("").trimEnd()}…`;
}

/** Characters outside Latin-1 (all of which Helvetica draws), replaced. */
function latinOnly(text: string): string {
  return text.replace(/[^\x20-\x7e\xa0-\xff]/gu, "?");
}

/**
 * Insert the contents pages at the front of `out`. Returns how many pages
 * were inserted.
 */
export async function addContentsPages(
  lib: PdfLibModule,
  out: PDFDocument,
  entries: readonly ContentsEntry[],
): Promise<number> {
  const { PDFName, rgb } = lib;
  if (entries.length === 0) return 0;
  const first = out.getPage(0);
  const { width: w0, height: h0 } = first.getSize();
  const turned = first.getRotation().angle % 180 !== 0;
  // The first merged page's displayed size, so the contents read as part of
  // the same document; never smaller than a postcard.
  const width = Math.max(300, turned ? h0 : w0);
  const height = Math.max(400, turned ? w0 : h0);

  const titles = entries.map((e) => e.title.replace(/[\r\n\t]+/g, " "));
  let font: PDFFont;
  let shown = titles;
  try {
    // The ellipsis too: a long name is cut with one.
    font = await embedDrawingFont(out, [...titles, "…"], "sans");
  } catch {
    // A name no shipped face can draw: the contents still list every file,
    // with "?" for each character that cannot be drawn.
    shown = titles.map(latinOnly);
    font = await embedDrawingFont(out, [...shown, "…"], "sans");
  }
  const bold = await embedDrawingFont(out, [CONTENTS_TITLE], "sans-bold");
  const numbers = await embedDrawingFont(out, ["0123456789. "], "sans");

  const per = entriesPerPage(height);
  const pageCount = Math.ceil(entries.length / per);
  const inner = width - 2 * MARGIN;

  // Insert them all first: an entry's number counts every contents page.
  const pages: PDFPage[] = [];
  for (let p = 0; p < pageCount; p++) {
    pages.push(out.insertPage(p, [width, height]));
  }
  const order = out.getPages();
  for (let p = 0; p < pageCount; p++) {
    const page = pages[p]!;
    page.drawText(CONTENTS_TITLE, {
      x: MARGIN,
      y: height - MARGIN - TITLE_SIZE,
      size: TITLE_SIZE,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    const slice = entries.slice(p * per, (p + 1) * per);
    slice.forEach((entry, k) => {
      const i = p * per + k;
      const target = order.findIndex((pg) => pg.ref === entry.page.ref);
      if (target < 0)
        throw new Error("a contents entry's page is not in the file");
      const label = String(target + 1);
      const labelWidth = numbers.widthOfTextAtSize(label, ENTRY_SIZE);
      const name = fit(shown[i]!, font, ENTRY_SIZE, inner - labelWidth - 24);
      const nameWidth = font.widthOfTextAtSize(name, ENTRY_SIZE);
      const y = height - MARGIN - TITLE_SIZE - TITLE_GAP - k * LINE;
      page.drawText(name, {
        x: MARGIN,
        y,
        size: ENTRY_SIZE,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      // Dot leaders between the name and its page number.
      const dotsFrom = MARGIN + nameWidth + 6;
      const dotsTo = MARGIN + inner - labelWidth - 6;
      const unit = numbers.widthOfTextAtSize(". ", ENTRY_SIZE);
      const n = Math.max(0, Math.floor((dotsTo - dotsFrom) / unit));
      if (n > 0) {
        const dots = ". ".repeat(n).trimEnd();
        page.drawText(dots, {
          x: dotsTo - numbers.widthOfTextAtSize(dots, ENTRY_SIZE),
          y,
          size: ENTRY_SIZE,
          font: numbers,
          color: rgb(0.55, 0.55, 0.55),
        });
      }
      page.drawText(label, {
        x: MARGIN + inner - labelWidth,
        y,
        size: ENTRY_SIZE,
        font: numbers,
        color: rgb(0.1, 0.1, 0.1),
      });
      const link = out.context.register(
        out.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [MARGIN, y - 5, MARGIN + inner, y + ENTRY_SIZE + 3],
          Border: [0, 0, 0],
          Dest: [entry.page.ref as PDFRef, PDFName.of("Fit")],
        }),
      );
      page.node.addAnnot(link);
    });
  }
  return pageCount;
}
