import type { PDFFont, PDFPage, RGB as PdfLibRGB } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Markdown to PDF's styled inline text: runs of bold, italic and code, and
 * the web links that become clickable /Link annotations. Only the Markdown
 * to PDF engine imports this module.
 */

/** Bit flags on a run: emphasis the source asked for. */
export const BOLD = 1;
export const ITALIC = 2;
export const CODE = 4;

export interface InlineRun {
  text: string;
  /** {@link BOLD} | {@link ITALIC} | {@link CODE}, or 0 for plain text. */
  style: number;
  /** A web address this text links to; only the schemes below get one. */
  href?: string;
}

/** The schemes a drawn link is made clickable for. Anything else prints only. */
export const PDF_LINK_SCHEMES = ["http:", "https:", "mailto:"] as const;

/**
 * The address a link's text should open, or undefined: a `www.` address is
 * opened over http, a bare email address as `mailto:`, and any scheme not in
 * {@link PDF_LINK_SCHEMES} (a relative path, `javascript:`, `file:`) is not
 * made clickable at all.
 */
export function clickableHref(raw: string): string | undefined {
  const url = raw.trim();
  if (!url) return undefined;
  const candidate = /^www\./i.test(url)
    ? `http://${url}`
    : /^[^\s@:/]+@[^\s@]+\.[^\s@]+$/.test(url)
      ? `mailto:${url}`
      : url;
  // A cheap refusal first: no exception per non-web address (a document of
  // thousands of `<a href="x">` must stay linear and fast).
  if (!/^(https?:\/\/|mailto:)/i.test(candidate)) return undefined;
  try {
    const parsed = new URL(candidate);
    return (PDF_LINK_SCHEMES as readonly string[]).includes(parsed.protocol)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

/** Whether runs carry anything a single-face line cannot draw. */
export function hasStyledRuns(runs: readonly InlineRun[]): boolean {
  return runs.some((run) => run.style !== 0 || run.href !== undefined);
}

export interface RunFonts {
  body: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

/**
 * The face a run is drawn in. `base` is the block's own face (a quote is
 * italic): italic text inside an italic block is drawn upright, as browsers
 * do. There is no bold-italic face, so bold wins.
 */
function fontFor(style: number, fonts: RunFonts, base: PDFFont): PDFFont {
  if (style & CODE) return fonts.mono;
  if (style & BOLD) return fonts.bold;
  if (style & ITALIC) return base === fonts.italic ? fonts.body : fonts.italic;
  return base;
}

/** One piece of a drawn line: text in one face, with its link if any. */
export interface Segment {
  text: string;
  font: PDFFont;
  style: number;
  href?: string;
  width: number;
}

/** Text in one face, split at whitespace, with each part's width. */
interface Piece extends Segment {
  space: boolean;
}

/**
 * Lay runs out in lines of at most `maxWidth`, breaking at spaces; a word
 * wider than a line is broken between characters. A `\n` in a run (a hard
 * line break) always starts a new line.
 */
export function wrapRuns(
  runs: readonly InlineRun[],
  fonts: RunFonts,
  base: PDFFont,
  maxWidth: number,
  size: number,
): Segment[][] {
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let width = 0;
  // Pieces of the word being built, not yet placed (a word can span runs).
  let word: Piece[] = [];
  let pendingSpace: Piece | null = null;

  const measure = (text: string, font: PDFFont) =>
    font.widthOfTextAtSize(text, size);
  const push = (segment: Segment) => {
    const last = line.at(-1);
    if (
      last &&
      last.font === segment.font &&
      last.style === segment.style &&
      last.href === segment.href
    ) {
      last.text += segment.text;
      last.width += segment.width;
    } else {
      line.push({ ...segment });
    }
    width += segment.width;
  };
  const endLine = () => {
    lines.push(line);
    line = [];
    width = 0;
  };
  const placeWord = () => {
    if (!word.length) return;
    const wordWidth = word.reduce((sum, p) => sum + p.width, 0);
    const spaceWidth = line.length && pendingSpace ? pendingSpace.width : 0;
    if (line.length && width + spaceWidth + wordWidth > maxWidth) {
      endLine();
    } else if (line.length && pendingSpace) {
      push(pendingSpace);
    }
    for (const piece of word) {
      if (piece.width <= maxWidth - width) {
        push(piece);
        continue;
      }
      // Wider than what is left: break it between characters.
      let chunk = "";
      for (const ch of Array.from(piece.text)) {
        const next = chunk + ch;
        if (chunk && width + measure(next, piece.font) > maxWidth) {
          push({ ...piece, text: chunk, width: measure(chunk, piece.font) });
          endLine();
          chunk = ch;
        } else {
          chunk = next;
        }
      }
      if (chunk) {
        push({ ...piece, text: chunk, width: measure(chunk, piece.font) });
      }
    }
    word = [];
    pendingSpace = null;
  };

  for (const run of runs) {
    const font = fontFor(run.style, fonts, base);
    const parts = run.text.split(/(\n|[^\S\n]+)/).filter((p) => p.length > 0);
    for (const part of parts) {
      if (part === "\n") {
        placeWord();
        endLine();
        pendingSpace = null;
        continue;
      }
      const piece: Piece = {
        text: part,
        font,
        style: run.style,
        href: run.href,
        width: measure(part, font),
        space: /^\s+$/.test(part),
      };
      if (piece.space) {
        placeWord();
        // A space inside a link stays part of the link's underline.
        pendingSpace = { ...piece, text: " ", width: measure(" ", font) };
      } else {
        word.push(piece);
      }
    }
  }
  placeWord();
  if (line.length || !lines.length) endLine();
  return lines;
}

/** The link colour and the inline code wash, as RGB triples. */
const LINK_RGB: [number, number, number] = [0.1, 0.32, 0.78];
const CODE_WASH_RGB: [number, number, number] = [0.93, 0.94, 0.96];

/**
 * A URI as a PDF literal string can carry it: ASCII only, and no bracket or
 * backslash a reader could take for the string's own syntax.
 */
export function pdfSafeUri(url: string): string {
  return Array.from(url)
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (code > 0x7e) return encodeURIComponent(ch);
      // encodeURIComponent leaves ( and ) alone; a PDF string may not.
      if (code < 0x21 || "()\\".includes(ch)) {
        return `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
      }
      return ch;
    })
    .join("");
}

/**
 * Draw one wrapped line at (x, y): each segment in its face, code on a light
 * wash, links in the link colour, underlined, and covered by a /Link
 * annotation with a /URI action — one per run of the same address on the
 * line, so a link that wraps is clickable on both lines.
 */
export function drawSegments(
  lib: Pick<PdfLibModule, "PDFString" | "rgb">,
  page: PDFPage,
  segments: readonly Segment[],
  at: { x: number; y: number; size: number; color: PdfLibRGB },
): void {
  let x = at.x;
  const links: { href: string; x1: number; x2: number }[] = [];
  for (const segment of segments) {
    if (segment.style & CODE && segment.text.trim()) {
      page.drawRectangle({
        x: x - 1,
        y: at.y - at.size * 0.25,
        width: segment.width + 2,
        height: at.size * 1.15,
        color: lib.rgb(...CODE_WASH_RGB),
      });
    }
    page.drawText(segment.text, {
      x,
      y: at.y,
      size: at.size,
      font: segment.font,
      color: segment.href ? lib.rgb(...LINK_RGB) : at.color,
    });
    if (segment.href) {
      page.drawLine({
        start: { x, y: at.y - 1.5 },
        end: { x: x + segment.width, y: at.y - 1.5 },
        thickness: 0.6,
        color: lib.rgb(...LINK_RGB),
      });
      const last = links.at(-1);
      if (last && last.href === segment.href && Math.abs(last.x2 - x) < 0.01) {
        last.x2 = x + segment.width;
      } else {
        links.push({ href: segment.href, x1: x, x2: x + segment.width });
      }
    }
    x += segment.width;
  }
  for (const link of links) {
    const context = page.doc.context;
    const annot = context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [link.x1, at.y - at.size * 0.3, link.x2, at.y + at.size * 0.9],
      Border: [0, 0, 0],
      F: 4,
      P: page.ref,
      A: {
        Type: "Action",
        S: "URI",
        URI: lib.PDFString.of(pdfSafeUri(link.href)),
      },
    });
    page.node.addAnnot(context.register(annot));
  }
}
