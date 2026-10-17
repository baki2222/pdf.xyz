// @native-canvas
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collapsedStructuredProse,
  makeStructuredProsePdf,
  structuredProseProblems,
} from "../../../e2e/client-proof/fixtures";
import { extractedTextToMarkdown } from "./pdf-to-markdown";
import {
  assembleExtraction,
  linePageFromItems,
  textItemsToLines,
  textItemsToPlainText,
  type TextItemLike,
} from "./text";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * The composed chain, on a PDF pdfjs really parsed: pdf-lib draws the
 * e2e proof's own fixture, pdfjs (the legacy build — the browser build needs
 * DOMMatrix and cannot load in Node) returns its text items, and the SAME
 * per-page builder `extractPdfLines` uses turns them into the converter's
 * input. The assertion is the e2e proof's, read from the Markdown text.
 *
 * Why this exists: the converter's only unit test fed it `\n\n`-separated
 * text, which pdfjs never produces, so the tool shipped turning every real page
 * into one paragraph while that test stayed green. The item shapes here are
 * not typed by hand — pdfjs makes them.
 */

const LABEL = "notes.pdf";
const PAGES = 2;

async function pdfjsItems(bytes: Uint8Array): Promise<TextItemLike[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    useWorkerFetch: false,
    disableFontFace: true,
    standardFontDataUrl: `${pathToFileURL(join(dir, "standard_fonts")).href}/`,
  });
  try {
    const doc = await task.promise;
    const pages: TextItemLike[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // The options `extractPdfLines` passes.
      const content = await page.getTextContent({
        includeMarkedContent: false,
      });
      pages.push(content.items as TextItemLike[]);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function convertFixture() {
  const items = await pdfjsItems(
    await makeStructuredProsePdf(LABEL, { pages: PAGES }),
  );
  const pages = items.map((pageItems, i) =>
    linePageFromItems(pageItems, i + 1),
  );
  const extracted = assembleExtraction(items.length, pages);
  return {
    items,
    extracted,
    result: extractedTextToMarkdown(extracted, { sourceName: LABEL }),
  };
}

describe("pdf-to-markdown on text pdfjs extracted from a real PDF", () => {
  it("HEALTH CHECK: pdfjs hands back one EOL per line and no blank lines", async () => {
    // The defect's precondition, observed rather than assumed. If a pdfjs
    // upgrade started emitting blank lines this would go red, and the
    // proof below would no longer be the thing that tells geometry apart
    // from the blank-line fallback.
    const { items, extracted } = await convertFixture();
    expect(items).toHaveLength(PAGES);
    for (const page of extracted.pages) {
      expect(page.text.split("\n").length).toBeGreaterThanOrEqual(10);
      expect(page.text).not.toMatch(/\n\s*\n/);
      const visible = page.lines.filter((l) => l.text.trim().length > 0);
      expect(visible.length).toBeGreaterThanOrEqual(10);
      for (const line of visible) {
        expect(line.y, `no geometry for "${line.text}"`).not.toBeNull();
        expect(line.size).toBeGreaterThan(0);
      }
    }
  });

  it("every heading, paragraph and list item of every page is its own block", async () => {
    const { result } = await convertFixture();
    expect(result.hasMarkdown).toBe(true);
    expect(structuredProseProblems(result.markdown, LABEL, PAGES)).toEqual([]);
  });

  it("CONTROL: the proof rejects the collapsed output the tool used to produce", () => {
    const problems = structuredProseProblems(
      collapsedStructuredProse(LABEL, PAGES),
      LABEL,
      PAGES,
    );
    // Every expected block is missing — not just one — so a partial collapse
    // is visible too.
    expect(problems.length).toBeGreaterThanOrEqual(6);
  });

  it("the lines are pdf-to-text's text, split: no word gained or lost", async () => {
    const { items } = await convertFixture();
    for (const pageItems of items) {
      const joined = textItemsToLines(pageItems)
        .map((line) => line.text)
        .join("\n");
      expect(textItemsToPlainText([{ str: joined }])).toBe(
        textItemsToPlainText(pageItems),
      );
    }
  });
});
