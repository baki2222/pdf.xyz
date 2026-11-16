/**
 * The translation as ONE HTML document, for Chromium to print as a reflowed
 * PDF — pure, no Node built-ins, no pdf-lib text drawing.
 *
 * ── DECISION RECORD (2026-11-15): CHROMIUM ON THE WORKER, NOT PDF-LIB ────────
 *
 * Translate writes into 21 languages, and the in-repo pdf-lib text path cannot
 * draw them all honestly:
 *
 *   - pdf-lib refuses Arabic and Thai outright: neither has a shaping-free
 *     font pack (`src/lib/pdf/font-packs.ts:333-460`).
 *   - `refuseMixedScripts` refuses a whole corpus that mixes scripts
 *     (`src/lib/pdf/unicode-font.ts:420-426`) — and it would do so AFTER the
 *     provider calls were paid for. A translation into Japanese routinely
 *     keeps Latin names and numbers.
 *   - `splitLongWord` breaks over-long words per code point
 *     (`src/lib/pdf/text-to-pdf.ts:56-107`), which splits grapheme clusters in
 *     Bengali, Hindi and Thai.
 *   - The worker image ships no `public/fonts` at all (Dockerfile:229-233
 *     copies node_modules, package.json, tsconfig, scripts and src), so the
 *     browser font packs pdf-lib draws with are not on the worker.
 *
 * The worker image DOES have Chromium plus `fonts-noto-core` and
 * `fonts-noto-cjk` (Dockerfile:158, 201-202). Chromium shapes complex
 * scripts, lays out bidirectional text, and falls back per glyph between
 * faces — exactly the three things above. So the translation is written as
 * HTML here and printed by the HTML renderer's `renderPackage`
 * (`../html-render/native`), with scripts off and every request outside the
 * synthetic document origin refused.
 *
 * REJECTED FOR NOW — overlaying the translation on the ORIGINAL pages: the
 * translated text overflows its source boxes (translations run 10-40% longer
 * than English), and fitting CJK and RTL text into boxes laid out for another
 * script is unsolved. Recorded as a future option, not a promise; the panel,
 * the package and this PDF all say "reflowed text, not the original layout".
 *
 * ── ONE BUILDER, TWO OUTPUTS ────────────────────────────────────────────────
 *
 * {@link translationHtml} and {@link typesetText} are the SAME walk: every text
 * run is recorded as it is escaped into the HTML, so the text the PDF should
 * carry is, by construction, the text the document contains. `./pdf-render`
 * compares that with what `pdftotext` reads back from the printed PDF, per job
 * — a block Chromium dropped is a refusal, not a shorter PDF.
 */
import {
  parseMarkdownBlocks,
  type MarkdownBlock,
} from "@/lib/pdf/markdown-to-pdf";
import {
  PT_PER_INCH,
  TEXT_PAGE_MARGIN_PT,
  US_LETTER_PT,
} from "@/lib/pdf/page-geometry";
import {
  LANGUAGE_NAMES,
  type TranslateLanguage,
} from "@/lib/jobs/translate-pdf";
import { TRANSLATE_RTL_LANGUAGES } from "@/lib/jobs/translate-pdf-render";
import type { DocumentPackage, PackageDocument } from "../html-render/engine";
import { HTML_DOCUMENT_URL } from "../html-render/document-url";
import { PRINT_TO_PDF_OPTIONS } from "../html-render/print-params";
import type { PageSpan } from "@/lib/pdf/page-spans";
import { gapMarkdown, type TranslationPart } from "./assembly";
import { pagesLabel } from "./page-labels";

export interface TypesetInput {
  readonly parts: readonly TranslationPart[];
  readonly target: TranslateLanguage;
  /** The uploaded file's display name, printed as the document's title. */
  readonly sourceName: string;
}

const RTL: ReadonlySet<string> = new Set(TRANSLATE_RTL_LANGUAGES);

/** The writing direction the document is laid out in, derived from the target. */
export function translationDirection(target: TranslateLanguage): "rtl" | "ltr" {
  return RTL.has(target) ? "rtl" : "ltr";
}

/** The line printed under the title, naming what this PDF is and is not. */
export function translationNote(target: TranslateLanguage): string {
  return `Translated to ${LANGUAGE_NAMES[target]} by an AI model — reflowed text, not the original layout`;
}

/**
 * Every face the page asks for is local (`fonts-noto-core`,
 * `fonts-noto-cjk`); there is no `@font-face` and no URL anywhere in the
 * document, and the renderer refuses any request off the document origin.
 *
 * The script faces are NAMED, not left to fontconfig's fallback: Chromium
 * walks this list per glyph, and an unnamed script falls to whatever
 * fontconfig prefers — DejaVu Sans draws Arabic too, and the language proof
 * (`./pdf-capability`, check (a)) asks for a Noto face for each script, so a
 * fallback to DejaVu would quietly cost Arabic its PDF.
 */
export function fontStack(target: TranslateLanguage): string {
  // The CJK faces share code points and differ in glyph shapes: the target's
  // own regional face goes first, so Japanese Han is drawn in Japanese forms.
  const cjk =
    target === "ja"
      ? ["JP", "SC", "KR"]
      : target === "ko"
        ? ["KR", "SC", "JP"]
        : ["SC", "JP", "KR"];
  return [
    "'Noto Sans'",
    "'Noto Sans Arabic'",
    "'Noto Sans Bengali'",
    "'Noto Sans Devanagari'",
    "'Noto Sans Thai'",
    ...cjk.map((r) => `'Noto Sans CJK ${r}'`),
    "sans-serif",
  ].join(", ");
}

const inches = (pt: number) => `${pt / PT_PER_INCH}in`;

/** The page CSS, derived from the geometry every text tool states. */
export function translationCss(target: TranslateLanguage): string {
  const FONT_STACK = fontStack(target);
  return [
    `@page { size: ${inches(US_LETTER_PT.width)} ${inches(US_LETTER_PT.height)}; margin: ${inches(TEXT_PAGE_MARGIN_PT)}; }`,
    `html { font-family: ${FONT_STACK}; font-size: 11pt; line-height: 1.45; color: #111; }`,
    "body { margin: 0; }",
    "h1 { font-size: 18pt; margin: 0 0 4pt; }",
    "h2 { font-size: 13pt; margin: 18pt 0 6pt; padding-bottom: 2pt; border-bottom: 0.5pt solid #999; }",
    "h3, h4, h5, h6 { font-size: 11.5pt; margin: 12pt 0 4pt; }",
    "p, li, td, th, blockquote, pre, aside, h1, h2, h3, h4, h5, h6 { overflow-wrap: anywhere; }",
    "p { margin: 0 0 6pt; }",
    ".note { color: #444; font-size: 9.5pt; margin-bottom: 14pt; }",
    ".li { margin: 0 0 3pt; }",
    ".mk { padding-inline-end: 0.4em; }",
    "blockquote { margin: 0 0 6pt; padding-inline-start: 8pt; border-inline-start: 2pt solid #bbb; color: #333; }",
    `pre { font-family: 'Noto Sans Mono', ${FONT_STACK}, monospace; font-size: 9.5pt; white-space: pre-wrap; background: #f3f3f3; padding: 6pt; margin: 0 0 6pt; }`,
    "hr { border: 0; border-top: 0.5pt solid #999; margin: 8pt 0; }",
    "table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 0 0 8pt; font-size: 10pt; }",
    "td, th { border: 0.5pt solid #999; padding: 3pt 4pt; vertical-align: top; text-align: start; }",
    "aside { margin: 8pt 0; padding: 6pt 8pt; border: 1pt solid #b45309; background: #fff7ed; font-size: 10pt; }",
  ].join("\n");
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

/**
 * "Page 4", "Pages 4–9" or, under a selection, "Pages 2, 4": a body's
 * heading, from its own pages and the job's chosen spans (`null` for a whole
 * document). `pagesLabel` is the one author (`./page-labels`): a fallen-back
 * chunk of chosen pages 2 and 4 is never headed "Pages 2–4", which would
 * claim page 3.
 */
export function pageRangeLabel(
  pages: readonly number[],
  chosen: readonly PageSpan[] | null,
): string {
  return pagesLabel(pages, chosen);
}

/**
 * A gap in words only: the ZIP's own marker (`./assembly`), with its Markdown
 * and its warning sign taken out. There is no emoji font in the worker image,
 * so U+26A0 U+FE0F would print as a box or nothing.
 */
export function gapWords(part: Extract<TranslationPart, { kind: "gap" }>) {
  return gapMarkdown(part)
    .split("\n")
    .map((line) =>
      line
        .replace(/^>\s?/, "")
        .replace(/\*\*/g, "")
        .replace(/[⚠️]/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

/**
 * Records every text run as it is escaped, so HTML and text are one walk.
 * FURNITURE runs (the title, the note, each page range and each gap's words)
 * are also kept apart: they are this document's own words, not the model's,
 * and the per-job check counts them ON TOP of the translation
 * (`./pdf-render` `carriesTranslation`).
 */
class Writer {
  readonly runs: string[] = [];
  readonly furniture: string[] = [];
  text(raw: string): string {
    this.runs.push(raw);
    return escapeHtml(raw).replace(/\n/g, "<br>");
  }
  fixed(raw: string): string {
    this.furniture.push(raw);
    return this.text(raw);
  }
}

/**
 * A stand-in for `<` while the Markdown parser runs: a Unicode noncharacter
 * (U+FDD0), built from its code so no tool on the way can turn an escape into
 * the raw character. The parser treats inline HTML as markup and DROPS it
 * (`a <script>x</script> b` parses as "a b"), which for a translation would
 * delete text the model returned; with `<` hidden it is ordinary text, and it
 * is restored before anything is escaped into the HTML. A body that already
 * holds the stand-in (it never occurs in real text) is parsed unprotected.
 */
const LT_STANDIN = String.fromCharCode(0xfdd0);

function restore(block: MarkdownBlock): MarkdownBlock {
  const back = (t: string) => t.split(LT_STANDIN).join("<");
  switch (block.kind) {
    case "rule":
      return block;
    case "table":
      return {
        ...block,
        header: block.header.map(back),
        rows: block.rows.map((row) => row.map(back)),
      };
    default:
      return { ...block, text: back(block.text) };
  }
}

function blocksOf(text: string): MarkdownBlock[] | null {
  try {
    if (text.includes(LT_STANDIN)) return parseMarkdownBlocks(text);
    return parseMarkdownBlocks(text.split("<").join(LT_STANDIN)).map(restore);
  } catch {
    return null;
  }
}

function blockHtml(block: MarkdownBlock, w: Writer): string {
  switch (block.kind) {
    case "heading": {
      // h1 is the document's title and h2 each section's page range.
      const level = Math.min(block.depth + 2, 6);
      return `<h${level}>${w.text(block.text)}</h${level}>`;
    }
    case "paragraph":
      return `<p>${w.text(block.text)}</p>`;
    case "list-item": {
      const indent = `margin-inline-start: ${(block.depth + 1) * 1.2}em`;
      const marker = block.continued
        ? ""
        : `<span class="mk">${w.text(block.ordered ? `${block.index ?? 1}.` : "•")}</span>`;
      return `<p class="li" style="${indent}">${marker}${w.text(block.text)}</p>`;
    }
    case "quote": {
      const indent = `margin-inline-start: ${((block.depth ?? 1) - 1) * 10}pt`;
      return `<blockquote style="${indent}">${w.text(block.text)}</blockquote>`;
    }
    case "code":
      // Escaped like every other run; `<br>` is harmless inside pre-wrap.
      return `<pre>${w.text(block.text)}</pre>`;
    case "rule":
      return "<hr>";
    case "table": {
      const head = block.header.map((cell) => `<th>${w.text(cell)}</th>`);
      const rows = block.rows.map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${w.text(cell)}</td>`).join("")}</tr>`,
      );
      return `<table><thead><tr>${head.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
    }
  }
}

function bodyHtml(text: string, w: Writer): string {
  const blocks = blocksOf(text);
  if (blocks === null) {
    // The parser threw: every line still prints, as plain escaped text.
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => `<p>${w.text(line)}</p>`)
      .join("\n");
  }
  return blocks.map((block) => blockHtml(block, w)).join("\n");
}

function build(input: TypesetInput): {
  html: string;
  text: string;
  furniture: string;
} {
  const w = new Writer();
  const out: string[] = [];
  out.push(`<h1>${w.fixed(input.sourceName)}</h1>`);
  out.push(`<p class="note">${w.fixed(translationNote(input.target))}</p>`);
  for (const part of input.parts) {
    if (part.kind === "body") {
      const heading =
        part.pages.length > 0
          ? `<h2>${w.fixed(pageRangeLabel(part.pages, part.chosen))}</h2>\n`
          : "";
      out.push(`<section>${heading}${bodyHtml(part.text, w)}</section>`);
    } else {
      out.push(
        `<aside>${gapWords(part)
          .map((line) => `<p>${w.fixed(line)}</p>`)
          .join("")}</aside>`,
      );
    }
  }
  const dir = translationDirection(input.target);
  const html = [
    "<!doctype html>",
    `<html lang="${escapeHtml(input.target)}" dir="${dir}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(input.sourceName)}</title>`,
    `<style>\n${translationCss(input.target)}\n</style>`,
    "</head>",
    "<body>",
    ...out,
    "</body>",
    "</html>",
  ].join("\n");
  return {
    html,
    text: w.runs.join("\n"),
    furniture: w.furniture.join("\n"),
  };
}

/** The HTML Chromium prints. Every text run in it is HTML-escaped. */
export function translationHtml(input: TypesetInput): string {
  return build(input).html;
}

/**
 * The text the printed PDF must carry: every run written into
 * {@link translationHtml}, in order — the title, the note, each section's page
 * range, each block's text after Markdown is stripped (list markers
 * included), and each gap's words. Whitespace is not meaningful here; the
 * conservation check compares non-whitespace code points.
 */
export function typesetText(input: TypesetInput): string {
  return build(input).text;
}

/**
 * The document's own words in {@link typesetText} (title, note, page ranges,
 * gap words), without the translation or the list markers.
 */
export function typesetFurnitureText(input: TypesetInput): string {
  return build(input).furniture;
}

/** One document at the synthetic origin, served from memory, printed once. */
export function translationDocument(input: TypesetInput): DocumentPackage {
  const body = new TextEncoder().encode(translationHtml(input));
  const document: PackageDocument = {
    url: HTML_DOCUMENT_URL,
    viewport: null,
    printParams: { ...PRINT_TO_PDF_OPTIONS },
  };
  return {
    documents: [document],
    serve(url) {
      return url === HTML_DOCUMENT_URL
        ? { body, contentType: "text/html; charset=utf-8" }
        : null;
    },
  };
}
