/**
 * What a PDF from HTML/Webpage to PDF must look like for each layout option,
 * read from the PDF a user downloads — its page boxes and its text — never
 * from the arguments the renderer was given. One module, three readers: the
 * real-Chromium test (`native.chromium.test.ts`), the in-image options proof
 * (`pnpm worker:options-proof`), and the live deployment proof
 * (`pnpm worker:prove-tools`).
 */
import { PDFDocument } from "pdf-lib";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import {
  HTML_PAGE_SIZES,
  type HtmlPageSize,
} from "@/lib/jobs/html-render-options";

/** Shown only when the page is laid out at 1000 CSS px or wider. */
export const LAYOUT_WIDE_MARKER = "Layout proof wide screen";
/** Shown only below 1000 CSS px. */
export const LAYOUT_NARROW_MARKER = "Layout proof narrow screen";

/**
 * A page whose text says which width it was laid out at, and long enough
 * (60 paragraphs) to need several pages of any paper size offered — so a
 * one-page render that is really a first page alone cannot pass.
 */
export function layoutProofHtml(): Uint8Array {
  const rows = Array.from(
    { length: 60 },
    (_, i) => `<p>Layout proof paragraph ${i + 1} of 60.</p>`,
  ).join("");
  return new TextEncoder().encode(
    `<!doctype html><html><head><meta charset="utf-8"><title>layout</title><style>
body{font:16px/1.5 sans-serif;margin:0}p{margin:0 0 12px}
.wide{display:none}.narrow{display:block}
@media (min-width:1000px){.wide{display:block}.narrow{display:none}}
</style></head><body><h1 class="wide">${LAYOUT_WIDE_MARKER}</h1><h1 class="narrow">${LAYOUT_NARROW_MARKER}</h1>${rows}</body></html>`,
  );
}

/** The PDF's text, every page, as pdf.js's legacy (Node) build reads it. */
export async function layoutPdfText(pdf: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    data: new Uint8Array(pdf),
  });
  try {
    const doc = await awaitPdfjsDocument(task);
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += ` ${content.items.map((item) => ("str" in item ? item.str : "")).join(" ")}`;
    }
    return text.replace(/\s+/g, " ");
  } finally {
    await task.destroy();
  }
}

/** Each page's size in PDF points (width, height), crop box applied. */
export async function pdfPageSizes(
  pdf: Uint8Array,
): Promise<[number, number][]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  return doc.getPages().map((p) => {
    const box = p.getCropBox();
    return [box.width, box.height];
  });
}

type Verdict = { ok: boolean; detail: string };

const fmt = ([w, h]: [number, number]) => `${w.toFixed(1)}×${h.toFixed(1)}pt`;

/** Every page is `size` in the given orientation, within one point. */
export async function pageSizeVerdict(
  pdf: Uint8Array,
  size: Exclude<HtmlPageSize, "auto">,
  orientation: "portrait" | "landscape",
): Promise<Verdict> {
  const inches = HTML_PAGE_SIZES.find((s) => s.id === size)!.inches!;
  const [a, b] = inches.map((v) => v * 72) as [number, number];
  const want: [number, number] = orientation === "landscape" ? [b, a] : [a, b];
  const pages = await pdfPageSizes(pdf);
  if (pages.length === 0) return { ok: false, detail: "the PDF has no pages" };
  const off = pages.filter(
    ([w, h]) => Math.abs(w - want[0]) > 1 || Math.abs(h - want[1]) > 1,
  );
  return off.length === 0
    ? {
        ok: true,
        detail: `${pages.length} page(s), each ${fmt(pages[0]!)} (${size} ${orientation})`,
      }
    : {
        ok: false,
        detail: `${off.length} of ${pages.length} page(s) are not ${size} ${orientation} ${fmt(want)}: first is ${fmt(off[0]!)}`,
      };
}

/** The first and last paragraph of {@link layoutProofHtml}. */
export const LAYOUT_PROOF_ENDS = [
  "Layout proof paragraph 1 of 60.",
  "Layout proof paragraph 60 of 60.",
] as const;

/**
 * One page, holding the content from its first line to its last (`ends`,
 * read from the PDF's text), and taller than it is wide — so the content was
 * measured and laid out whole, not cut to a first page.
 */
export async function onePageVerdict(
  pdf: Uint8Array,
  text: string,
  ends: readonly string[],
): Promise<Verdict> {
  const pages = await pdfPageSizes(pdf);
  if (pages.length !== 1)
    return {
      ok: false,
      detail: `${pages.length} pages, not one long page`,
    };
  const flat = text.replace(/\s+/g, " ");
  const lost = ends.filter((e) => !flat.includes(e));
  if (lost.length > 0)
    return {
      ok: false,
      detail: `one page, but ${lost.length} of ${ends.length} marker line(s) are not on it — the content was cut`,
    };
  const [w, h] = pages[0]!;
  return h > w
    ? {
        ok: true,
        detail: `one page of ${fmt(pages[0]!)}, first to last line`,
      }
    : { ok: false, detail: `one page of ${fmt(pages[0]!)}, wider than tall` };
}

/** The text shows the layout of the screen width asked for, and not the other. */
export function viewportVerdict(
  text: string,
  want: "wide" | "narrow",
): Verdict {
  const flat = text.replace(/\s+/g, " ");
  const wide = flat.includes(LAYOUT_WIDE_MARKER);
  const narrow = flat.includes(LAYOUT_NARROW_MARKER);
  const ok = want === "wide" ? wide && !narrow : narrow && !wide;
  return {
    ok,
    detail: ok
      ? `laid out ${want} (its marker printed, the other not)`
      : `wanted the ${want} layout; printed wide=${wide} narrow=${narrow}`,
  };
}
