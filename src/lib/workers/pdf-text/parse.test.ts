// @vitest-environment node
/**
 * The pure `pdftotext` output parsers. The samples below are real poppler output
 * shapes, so a change in how we read them shows up here rather than as a job that
 * fails only on the worker.
 */
import { describe, expect, it } from "vitest";
import { normalizeExtractedText, textItemsToPlainText } from "@/lib/pdf/text";
import { decodeXmlEntities, parseBboxLayout, parseLayoutText } from "./parse";

/** One page, two rows of two aligned columns — poppler's `-bbox-layout` shape. */
const BBOX = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><doc>
  <page width="595.000000" height="842.000000">
    <flow><block><line>
      <word xMin="60.000000" yMin="94.102000" xMax="97.279000" yMax="104.277000">Region</word>
      <word xMin="200.000000" yMin="94.102000" xMax="214.674000" yMax="104.277000">Q1</word>
    </line></block></flow>
    <flow><block><line>
      <word xMin="60.000000" yMin="118.102000" xMax="95.000000" yMax="128.277000">North</word>
      <word xMin="200.000000" yMin="118.102000" xMax="222.000000" yMax="128.277000">1200</word>
    </line></block></flow>
  </page>
</doc></body></html>`;

describe("parseBboxLayout", () => {
  it("reads page geometry and every word", () => {
    const layout = parseBboxLayout(BBOX);
    expect(layout.pageCount).toBe(1);
    expect(layout.pages[0]).toMatchObject({
      pageNumber: 1,
      width: 595,
      height: 842,
    });
    expect(layout.pages[0]!.items.map((i) => i.text)).toEqual([
      "Region",
      "Q1",
      "North",
      "1200",
    ]);
  });

  it("flips poppler's top-down y into PDF-native y-up, or rows invert", () => {
    // poppler measures yMax down from the page top; PositionedTextItem.y is the
    // baseline measured up from the bottom. 842 - 104.277 = 737.723.
    const [region, , north] = parseBboxLayout(BBOX).pages[0]!.items;
    expect(region!.y).toBeCloseTo(737.723, 3);
    expect(north!.y).toBeCloseTo(713.723, 3);
    // The header row must sort ABOVE the data row, which is what the table
    // engine's descending-y row ordering depends on.
    expect(region!.y).toBeGreaterThan(north!.y);
  });

  it("derives width and height from the bounding box", () => {
    const region = parseBboxLayout(BBOX).pages[0]!.items[0]!;
    expect(region.x).toBe(60);
    expect(region.width).toBeCloseTo(37.279, 3);
    expect(region.height).toBeCloseTo(10.175, 3);
  });

  it("keeps each page's words on that page", () => {
    const twoPages = BBOX.replace(
      "</page>\n</doc>",
      `</page>
  <page width="200.000000" height="400.000000">
    <flow><block><line><word xMin="1" yMin="2" xMax="3" yMax="4">second</word></line></block></flow>
  </page>
</doc>`,
    );
    const layout = parseBboxLayout(twoPages);
    expect(layout.pageCount).toBe(2);
    expect(layout.pages[0]!.items).toHaveLength(4);
    expect(layout.pages[1]!.items.map((i) => i.text)).toEqual(["second"]);
    expect(layout.pages[1]).toMatchObject({ width: 200, height: 400 });
  });

  it("drops whitespace-only and unpositioned words rather than inventing runs", () => {
    const layout = parseBboxLayout(`<page width="10" height="10">
      <word xMin="1" yMin="1" xMax="2" yMax="2">   </word>
      <word xMax="2" yMax="2">no-origin</word>
      <word xMin="1" yMin="1" xMax="2" yMax="2">kept</word>
    </page>`);
    expect(layout.pages[0]!.items.map((i) => i.text)).toEqual(["kept"]);
  });

  it("returns an empty layout for output with no pages", () => {
    expect(parseBboxLayout("<html><body></body></html>")).toEqual({
      pageCount: 0,
      pages: [],
    });
  });

  it("decodes the entities poppler escapes in word text", () => {
    const layout = parseBboxLayout(
      `<page width="10" height="10"><word xMin="1" yMin="1" xMax="2" yMax="2">R&amp;D &lt;1&gt;</word></page>`,
    );
    expect(layout.pages[0]!.items[0]!.text).toBe("R&D <1>");
  });
});

describe("decodeXmlEntities", () => {
  it("handles named, decimal, and hex references", () => {
    expect(decodeXmlEntities("a&amp;b &#65; &#x42;")).toBe("a&b A B");
  });

  it("leaves an unknown entity verbatim instead of dropping characters", () => {
    expect(decodeXmlEntities("50&nbsp;%")).toBe("50&nbsp;%");
  });
});

describe("parseLayoutText", () => {
  it("splits pages on the form feed and numbers them from 1", () => {
    const out = parseLayoutText("page one\f page two\f");
    expect(out.pageCount).toBe(2);
    expect(out.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(out.pages[1]!.text).toBe("page two");
  });

  it("does not count the empty chunk after a trailing page break", () => {
    expect(parseLayoutText("only page\f").pageCount).toBe(1);
  });

  it("reports hasText:false for an image-only PDF instead of a blank document", () => {
    const out = parseLayoutText("\f\f");
    expect(out.hasText).toBe(false);
    expect(out.characterCount).toBe(0);
  });

  it("preserves the run-of-spaces column alignment -layout produces", () => {
    // PDF to Excel places each cell by its position on the padded line, so
    // collapsing the padding here would silently merge columns.
    const out = parseLayoutText("North               1200   1350");
    expect(out.text).toBe("North               1200   1350");
  });
});

/**
 * The two extractors do not agree, executably.
 *
 * The module docblock used to promise they did. Nothing tested it, and on
 * production one document measured 13,530 characters in the browser and 13,678
 * here. These tests pin the MECHANISM rather than those two numbers, so they
 * cannot go stale with a fixture: whatever the magnitudes, the worker counts
 * inter-column padding and the browser structurally cannot.
 */
describe("the browser and worker extractors count different things", () => {
  /** One table row, as each extractor really receives it. */
  const PADDING = 15;
  const workerLine = `North${" ".repeat(PADDING)}1200`;
  // pdfjs hands over text ITEMS. The friendliest realistic case is given here —
  // a genuine space glyph between the columns — because the point survives it.
  const browserItems = [
    { str: "North" },
    { str: " " },
    { str: "1200", hasEOL: true },
  ];

  it("the worker's count includes column padding the browser never sees", () => {
    const browser = textItemsToPlainText(browserItems);
    const worker = parseLayoutText(workerLine).text;

    expect(browser).toBe("North 1200");
    expect(worker).toBe(workerLine);
    expect(
      worker.length - browser.length,
      "if these ever agree, the extractors have been unified and the ceiling " +
        "comparison in translate-limits.ts stops being a unit mismatch — go " +
        "delete the warning there rather than leaving it to mislead",
    ).toBe(PADDING - 1);
  });

  it("shared normalization does not close the gap, because the padding is interior", () => {
    // `normalizeExtractedText` is shared by both paths and strips only TRAILING
    // whitespace. Sharing it makes the paths agree on line endings and blank
    // lines — never on the text.
    expect(normalizeExtractedText(workerLine)).toBe(workerLine);
  });

  it("the surplus tracks geometry, not text length", () => {
    // Which is why no constant factor can convert one count into the other.
    // Same four characters of real text; the gap is set by where they sit.
    const near = parseLayoutText(`ab${" ".repeat(2)}cd`).text.length;
    const far = parseLayoutText(`ab${" ".repeat(60)}cd`).text.length;
    expect(near).toBe(6);
    expect(far).toBe(64);
    expect(
      far / near,
      "a ratio this far apart for identical text is the reason " +
        "TRANSLATE_MAX_INPUT_CHARS cannot be corrected by a measured margin",
    ).toBeGreaterThan(10);
  });
});
