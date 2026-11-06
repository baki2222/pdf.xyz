/**
 * What a PDF from EPUB to PDF must look like, read from the PDF a user
 * downloads — its pages' text, the images and colours drawn on them, its
 * page boxes and its outline — never from what the renderer was asked to do.
 * One module, three readers: the real-Chromium test (`epub.chromium.test.ts`),
 * the in-image proof (`pnpm worker:epub-proof`) and the deployment proof
 * (`pnpm worker:prove-tools`).
 *
 * Each verdict returns its PROBLEMS: an empty list is a pass. Every verdict
 * has a negative control in `epub.chromium.test.ts` — a
 * wrong PDF it must find a problem with — so an empty list cannot come from
 * a reader that saw nothing.
 */
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";

/** Each chapter's distinctive text, in SPINE order. */
export const EPUB_CHAPTER_MARKS = [
  "Quillfeather opening chapter",
  "Marrowgate middle chapter",
  "Zephyrine closing chapter",
] as const;
/** The table-of-contents titles, in spine order. */
export const EPUB_TOC_TITLES = [
  "Part One Quillfeather",
  "Part Two Marrowgate",
  "Part Three Zephyrine",
] as const;
/** Text a chapter script would write if scripts ran. */
export const EPUB_SCRIPT_MARK = "Scriptran Lanternfly";
/** The heading colour the stylesheet sets: rgb(200, 30, 40). */
export const EPUB_HEADING_RGB = [200, 30, 40] as const;
/** A web link chapter three carries: it must stay a link in the PDF. */
export const EPUB_WEB_LINK = "https://example.org/further-reading";
/** The PNG chapter one shows, in pixels. */
export const EPUB_IMAGE_PIXELS = [24, 24] as const;
/** A remote image a chapter links: never to be fetched. */
export const EPUB_REMOTE_IMAGE = "https://example.com/remote-cover.png";


export interface OutlineNode {
  title: string;
  /** 0-based page the bookmark opens, or null when it opens none. */
  page: number | null;
  children: OutlineNode[];
}

export interface EpubPdfReading {
  /** Each page's text, whitespace collapsed. */
  pages: string[];
  /** Each page's size in points. */
  sizes: [number, number][];
  /** The pixel size (width x height) of each image each page draws. */
  images: [number, number][][];
  /** The fill colours each page sets, as [r, g, b] in 0–255. */
  fills: [number, number, number][][];
  outline: OutlineNode[];
}

function rgbOf(args: unknown): [number, number, number] | null {
  const a = Array.isArray(args) ? args[0] : args;
  if (typeof a === "string" && /^#[0-9a-f]{6}$/i.test(a))
    return [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  if (Array.isArray(args) && args.length >= 3 && args.every((n) => typeof n === "number")) {
    const nums = args as number[];
    const scale = nums.every((n) => n <= 1) ? 255 : 1;
    return [nums[0]! * scale, nums[1]! * scale, nums[2]! * scale];
  }
  return null;
}

/** Read the PDF with pdf.js's legacy (Node) build. */
export async function readEpubPdf(pdf: Uint8Array): Promise<EpubPdfReading> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { OPS } = pdfjs;
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    data: new Uint8Array(pdf),
  });
  try {
    const doc = await awaitPdfjsDocument(task);
    const reading: EpubPdfReading = {
      pages: [],
      sizes: [],
      images: [],
      fills: [],
      outline: [],
    };
    const imageOps = new Set<number>([
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageXObjectRepeat,
    ]);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      reading.pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      reading.sizes.push([x1 - x0, y1 - y0]);
      const ops = await page.getOperatorList();
      const images: [number, number][] = [];
      const fills: [number, number, number][] = [];
      ops.fnArray.forEach((fn, k) => {
        if (imageOps.has(fn)) {
          const args = ops.argsArray[k] as unknown[];
          images.push([Number(args?.[1] ?? 0), Number(args?.[2] ?? 0)]);
        }
        if (fn === OPS.setFillRGBColor) {
          const rgb = rgbOf(ops.argsArray[k]);
          if (rgb) fills.push(rgb);
        }
      });
      reading.images.push(images);
      reading.fills.push(fills);
    }
    type PdfjsOutline = {
      title: string;
      dest: unknown;
      items: PdfjsOutline[];
    };
    const pageOf = async (dest: unknown): Promise<number | null> => {
      const explicit =
        typeof dest === "string" ? await doc.getDestination(dest) : dest;
      const ref = Array.isArray(explicit) ? explicit[0] : null;
      if (!ref || typeof ref !== "object") return null;
      try {
        return await doc.getPageIndex(ref as { num: number; gen: number });
      } catch {
        return null;
      }
    };
    const walk = async (items: PdfjsOutline[] | null): Promise<OutlineNode[]> =>
      Promise.all(
        (items ?? []).map(async (item) => ({
          title: item.title,
          page: await pageOf(item.dest),
          children: await walk(item.items),
        })),
      );
    reading.outline = await walk(
      (await doc.getOutline()) as PdfjsOutline[] | null,
    );
    return reading;
  } finally {
    await task.destroy();
  }
}

/** The first page whose text holds `mark`, or -1. */
export const pageOfMark = (r: EpubPdfReading, mark: string) =>
  r.pages.findIndex((text) => text.includes(mark));

const near = (a: readonly number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= 2);

/** Flatten an outline to "title@page" in reading order. */
export const flatOutline = (nodes: OutlineNode[]): string[] =>
  nodes.flatMap((n) => [`${n.title}@${n.page}`, ...flatOutline(n.children)]);

/**
 * The EPUB 3 fixture (`epub3Book()`) printed correctly:
 *  - each chapter's mark is on a page, in SPINE order, and no page holds two
 *    chapters (each chapter starts on a fresh page);
 *  - chapter one's page draws an image (the book's PNG);
 *  - chapter one's page fills text in the stylesheet's heading colour;
 *  - the chapter script did not run;
 *  - the outline is the nav's, each bookmark opening its chapter's page.
 */
export function epub3Verdict(r: EpubPdfReading): string[] {
  const problems: string[] = [];
  const at = EPUB_CHAPTER_MARKS.map((m) => pageOfMark(r, m));
  at.forEach((page, i) => {
    if (page < 0) problems.push(`chapter ${i + 1}'s text is on no page`);
  });
  if (at.every((p) => p >= 0)) {
    if (!(at[0]! < at[1]! && at[1]! < at[2]!))
      problems.push(
        `chapters are out of spine order: their first pages are ${at.map((p) => p + 1).join(", ")}`,
      );
    for (const text of r.pages) {
      const held = EPUB_CHAPTER_MARKS.filter((m) => text.includes(m));
      if (held.length > 1)
        problems.push(`one page holds ${held.length} chapters: no page break`);
    }
  }
  const first = at[0] ?? -1;
  if (first >= 0) {
    // The book's own PNG, by its pixel size: a missing image still draws
    // Chromium's broken-image icon, which is an image too (measured).
    const [w, h] = EPUB_IMAGE_PIXELS;
    if (!(r.images[first] ?? []).some(([iw, ih]) => iw === w && ih === h))
      problems.push(
        `chapter one's page draws no ${w}x${h} image (drew ${JSON.stringify(r.images[first] ?? [])})`,
      );
    if (!(r.fills[first] ?? []).some((rgb) => near(rgb, EPUB_HEADING_RGB)))
      problems.push(
        `chapter one's page never fills in the stylesheet's heading colour rgb(${EPUB_HEADING_RGB.join(", ")})`,
      );
  }
  if (r.pages.some((text) => text.includes(EPUB_SCRIPT_MARK)))
    problems.push("a chapter's script ran (its text is in the PDF)");
  const want = [
    `${EPUB_TOC_TITLES[0]}@${at[0]}`,
    `Later parts@${at[1]}`,
    `${EPUB_TOC_TITLES[1]}@${at[1]}`,
    `${EPUB_TOC_TITLES[2]}@${at[2]}`,
  ];
  const got = flatOutline(r.outline);
  if (got.join(" | ") !== want.join(" | "))
    problems.push(
      `the outline is [${got.join(" | ")}], not [${want.join(" | ")}]`,
    );
  return problems;
}

/** The EPUB 2 fixture (`epub2Book()`): both chapters in order, NCX outline. */
export function epub2Verdict(r: EpubPdfReading): string[] {
  const problems: string[] = [];
  const at = EPUB_CHAPTER_MARKS.slice(0, 2).map((m) => pageOfMark(r, m));
  if (at.some((p) => p < 0) || !(at[0]! < at[1]!))
    problems.push(
      `the two chapters' first pages are ${at.map((p) => p + 1).join(", ")}, not in spine order`,
    );
  const want = [
    `${EPUB_TOC_TITLES[0]}@${at[0]}`,
    `Inside one@${at[0]}`,
    `${EPUB_TOC_TITLES[1]}@${at[1]}`,
  ];
  const got = flatOutline(r.outline);
  if (got.join(" | ") !== want.join(" | "))
    problems.push(
      `the outline is [${got.join(" | ")}], not the NCX's [${want.join(" | ")}]`,
    );
  return problems;
}

/** The fixed-layout fixture: two pages, each 600×800 CSS px (450×600 pt). */
export function fixedLayoutVerdict(r: EpubPdfReading): string[] {
  const problems: string[] = [];
  if (r.pages.length !== 2)
    problems.push(`${r.pages.length} pages, not one per fixed-layout page (2)`);
  r.sizes.forEach(([w, h], i) => {
    if (Math.abs(w - 450) > 1 || Math.abs(h - 600) > 1)
      problems.push(
        `page ${i + 1} is ${w.toFixed(1)}×${h.toFixed(1)}pt, not its viewport's 450×600pt`,
      );
  });
  EPUB_CHAPTER_MARKS.slice(0, 2).forEach((mark, i) => {
    if (!(r.pages[i] ?? "").includes(mark))
      problems.push(`page ${i + 1} does not hold its page's text`);
  });
  return problems;
}
