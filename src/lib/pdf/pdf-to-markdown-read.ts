import { loadPdfjs } from "./pdfjs";
import {
  extractedTextToMarkdown,
  MARKDOWN_LINK_SCHEMES,
  type MarkdownLink,
  type PdfToMarkdownInput,
  type PdfToMarkdownOptions,
  type PdfToMarkdownResult,
} from "./pdf-to-markdown";
import { extractPdfLines, type PdfTextReader, type TextItemLike } from "./text";

/**
 * PDF to Markdown's reader: each page's lines through `extractPdfLines` (the
 * route PDF to Text's reading-order fixtures run), plus the links on that
 * page, read from the same open pdf.js page.
 *
 * Its own module, because `./text` is shared with PDF to Text, Compare and
 * the AI tools, none of which read links; only this tool's chunk imports it.
 */

/**
 * A word is inside a link when at least this share of its letters' centres
 * fall inside the link's box. Letter positions are ESTIMATED (an item's width
 * spread evenly over its characters), so a word on the edge of the box is
 * decided by its majority rather than by one letter's guessed position.
 */
const WORD_INSIDE_SHARE = 0.5;

/** What pdf.js's `getAnnotations()` gives for an annotation, as read here. */
export interface AnnotationLike {
  subtype?: unknown;
  url?: unknown;
  rect?: unknown;
  quadPoints?: unknown;
}

interface Rect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function rectOf(values: ArrayLike<unknown>, at = 0, count = 4): Rect | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = at; i < at + count * 2; i += 2) {
    const x = values[i];
    const y = values[i + 1];
    if (!finite(x) || !finite(y)) return null;
    xs.push(x);
    ys.push(y);
  }
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}

/** A link's boxes: its QuadPoints when it has them (one per line), else its Rect. */
function linkBoxes(annotation: AnnotationLike): Rect[] {
  const quads = annotation.quadPoints;
  if (
    quads &&
    typeof quads === "object" &&
    "length" in quads &&
    typeof quads.length === "number" &&
    quads.length > 0 &&
    quads.length % 8 === 0
  ) {
    const boxes: Rect[] = [];
    for (let i = 0; i < quads.length; i += 8) {
      const box = rectOf(quads as ArrayLike<unknown>, i);
      if (box) boxes.push(box);
    }
    if (boxes.length) return boxes;
  }
  const rect = annotation.rect;
  if (rect && typeof rect === "object" && "length" in rect) {
    const box = rectOf(rect as ArrayLike<unknown>, 0, 2);
    if (box) return [box];
  }
  return [];
}

function safeUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    return (MARKDOWN_LINK_SCHEMES as readonly string[]).includes(
      parsed.protocol,
    )
      ? url
      : null;
  } catch {
    return null;
  }
}

/**
 * The words each web link on a page covers, in the order pdf.js stores the
 * text, with the link's vertical extent so the converter can match it to the
 * block it sits in.
 *
 * Only upright text is read: a rotated item's width does not run along x.
 */
export function linksFromPage(
  items: readonly TextItemLike[],
  annotations: readonly AnnotationLike[],
): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const annotation of annotations) {
    if (annotation.subtype !== "Link") continue;
    const url = safeUrl(annotation.url);
    if (!url) continue;
    const boxes = linkBoxes(annotation);
    if (!boxes.length) continue;
    const words: string[] = [];
    for (const item of items) {
      words.push(...wordsInside(item, boxes));
    }
    const text = words.join(" ").trim();
    if (!text) continue;
    links.push({
      text,
      url,
      top: Math.max(...boxes.map((b) => b.top)),
      bottom: Math.min(...boxes.map((b) => b.bottom)),
    });
  }
  return links;
}

/** The words of one item that sit inside any of `boxes`. */
function wordsInside(item: TextItemLike, boxes: readonly Rect[]): string[] {
  const str = item.str;
  const t = item.transform;
  if (typeof str !== "string" || !str.trim() || !Array.isArray(t)) return [];
  const [a, b, c, d, x, y] = t as unknown[];
  if (!finite(a) || !finite(d) || !finite(x) || !finite(y)) return [];
  if (b !== 0 || c !== 0 || a <= 0) return [];
  const width = finite(item.width) && item.width > 0 ? item.width : 0;
  if (!width) return [];
  const height =
    finite(item.height) && item.height > 0 ? item.height : Math.abs(d);
  // Where the letters sit vertically: a little above the baseline.
  const mid = y + height * 0.35;
  const rows = boxes.filter((box) => mid >= box.bottom && mid <= box.top);
  if (!rows.length) return [];

  const chars = [...str];
  const pitch = width / chars.length;
  const inside = chars.map((_, i) => {
    const cx = x + pitch * (i + 0.5);
    return rows.some((box) => cx >= box.left && cx <= box.right);
  });

  const words: string[] = [];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i]!)) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < chars.length && !/\s/.test(chars[end]!)) end += 1;
    const span = inside.slice(i, end);
    if (span.filter(Boolean).length >= span.length * WORD_INSIDE_SHARE) {
      // Trim punctuation the box does not cover ("here." → "here"); letters
      // are kept whatever their estimated position.
      let s = i;
      let e = end;
      while (s < e && !inside[s] && /\p{P}/u.test(chars[s]!)) s += 1;
      while (e > s && !inside[e - 1] && /\p{P}/u.test(chars[e - 1]!)) e -= 1;
      words.push(chars.slice(s, e).join(""));
    }
    i = end;
  }
  return words;
}

/** Read every page of `bytes` for the converter: its lines and its links. */
export async function readPdfForMarkdown(
  bytes: Uint8Array,
  /** See {@link PdfTextReader}; tests pass pdfjs's legacy build. */
  loadReader: PdfTextReader = loadPdfjs,
): Promise<PdfToMarkdownInput> {
  const links: MarkdownLink[][] = [];
  const extracted = await extractPdfLines(
    bytes,
    async (page, items, pageNumber) => {
      const annotations = await page.getAnnotations({ intent: "display" });
      links[pageNumber - 1] = linksFromPage(
        items,
        annotations as AnnotationLike[],
      );
    },
    loadReader,
  );
  return {
    ...extracted,
    pages: extracted.pages.map((page, i) => ({
      ...page,
      links: links[i] ?? [],
    })),
  };
}

/** The runner's whole chain: read the PDF, then convert what was read. */
export async function pdfToMarkdown(
  bytes: Uint8Array,
  options: PdfToMarkdownOptions = {},
  loadReader: PdfTextReader = loadPdfjs,
): Promise<PdfToMarkdownResult> {
  return extractedTextToMarkdown(
    await readPdfForMarkdown(bytes, loadReader),
    options,
  );
}
