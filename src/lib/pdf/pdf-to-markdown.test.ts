import { describe, expect, it } from "vitest";
import {
  markdownBlocks,
  type MarkdownBlock,
} from "../../../e2e/client-proof/fixtures";
import {
  extractedTextToMarkdown,
  HEADING_SIZE_RATIO,
  joinWrappedLines,
  markdownOutputName,
  normalizeMarkdownLine,
  PARAGRAPH_GAP_RATIO,
  type PdfToMarkdownInput,
} from "./pdf-to-markdown";
import {
  assembleExtraction,
  linePageFromItems,
  textItemsToPlainText,
  type TextItemLike,
} from "./text";

/**
 * Text-only input: `lines: null`, so the converter takes its no-geometry
 * fallback and splits on blank lines.
 *
 * HISTORY. Until the geometry path existed this was the ONLY fixture, and it is
 * why the tool shipped collapsing every real page into one paragraph: its
 * `\n\n` separators are a shape pdfjs never produces (`appendEOL` writes one
 * EOL however large the gap), so the test passed on input no user can send.
 * It is kept as the fallback's test; the pdfjs-shaped cases below, and the
 * real-pdfjs proof in pdf-to-markdown.pdfjs.test.ts, are the tool's.
 */
function extracted(
  overrides: Partial<PdfToMarkdownInput> = {},
): PdfToMarkdownInput {
  return {
    pageCount: 2,
    hasText: true,
    pages: [
      {
        pageNumber: 1,
        text: "Title\n\nFirst paragraph wraps\nacross lines.\n\n- existing bullet",
        characterCount: 63,
        lines: null,
      },
      {
        pageNumber: 2,
        text: "Second page\n1. numbered",
        characterCount: 23,
        lines: null,
      },
    ],
    text: "",
    characterCount: 86,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 *  pdfjs-shaped items
 * ------------------------------------------------------------------ */

/**
 * A text run the way pdfjs 6.1.200 returns it (measured on a pdf-lib PDF):
 * `transform` [size,0,0,size,x,y], `height` = size, and one `hasEOL` at the end
 * of each visual line.
 */
function run(str: string, x: number, y: number, size = 11, eol = true) {
  return {
    str,
    hasEOL: eol,
    height: size,
    transform: [size, 0, 0, size, x, y],
    fontName: size > 11 ? "g_d0_f1" : "g_d0_f2",
  };
}

/**
 * The empty item `appendEOL` pushes when a line ends without its own EOL flag.
 * It carries the NEXT line's transform and zero size — measured, not assumed:
 * after a 22pt title at y=740 pdfjs reported this item at y=704.
 */
function eolItem(nextX: number, nextY: number, nextSize = 11) {
  return {
    str: "",
    hasEOL: true,
    height: 0,
    width: 0,
    transform: [nextSize, 0, 0, nextSize, nextX, nextY],
    fontName: "g_d0_f2",
  };
}

/** A space pdfjs reports with height 0 (it does, between a bullet and its text). */
function space(x: number, y: number) {
  return {
    str: " ",
    hasEOL: false,
    height: 0,
    transform: [11, 0, 0, 11, x, y],
  };
}

function convert(pages: TextItemLike[][], sourceName = "report.pdf") {
  const built = pages.map((items, i) => linePageFromItems(items, i + 1));
  return extractedTextToMarkdown(assembleExtraction(built.length, built), {
    sourceName,
  });
}

/** The same pages with their geometry thrown away: what the tool did before. */
function convertWithoutGeometry(pages: TextItemLike[][]) {
  const built = pages.map((items, i) => ({
    ...linePageFromItems(items, i + 1),
    lines: null,
  }));
  return extractedTextToMarkdown(assembleExtraction(built.length, built), {
    sourceName: "report.pdf",
  });
}

const kinds = (blocks: MarkdownBlock[], kind: MarkdownBlock["kind"]) =>
  blocks.filter((b) => b.kind === kind).map((b) => b.text);

/** A Word-style page: title, heading, gap-separated paragraphs, a list. */
const WORD_PAGE: TextItemLike[] = [
  run("Quarterly Report", 72, 740, 22, false),
  eolItem(72, 704, 15),
  run("Introduction", 72, 704, 15, false),
  eolItem(72, 680),
  run("The first paragraph wraps across two lines of text in the", 72, 680),
  run("document body. It ends here.", 72, 666),
  run("A second paragraph begins after a gap and has an exam-", 72, 642),
  run("ple of hyphenation across the line break.", 72, 628),
  // Word's default bullet: U+F0B7 in the Symbol font, drawn as its own run,
  // then a tab, then the text at a hanging indent.
  run("\uF0B7", 72, 604, 11, false),
  { ...space(76, 604), str: "\t" },
  run("First bullet item", 90, 604),
  run("\u2022", 72, 590, 11, false),
  space(76, 590),
  run("Second bullet item that wraps onto a", 90, 590),
  run("hanging second line.", 90, 576),
  run("Back at the margin after the list.", 72, 552),
];

describe("pdf-to-markdown over pdfjs-shaped items", () => {
  it("HEALTH CHECK: the fixture has the shape pdfjs emits: no blank lines", () => {
    // If this fixture ever gained a blank line, the tests below could pass on
    // the blank-line fallback and prove nothing about geometry.
    const text = textItemsToPlainText(WORD_PAGE);
    expect(text.split("\n").length).toBeGreaterThanOrEqual(10);
    expect(text).not.toMatch(/\n\s*\n/);
  });

  it("recovers headings, paragraphs and list items from geometry", () => {
    const blocks = markdownBlocks(convert([WORD_PAGE]).markdown);
    expect(kinds(blocks, "heading")).toEqual([
      "report",
      "Quarterly Report",
      "Introduction",
    ]);
    expect(kinds(blocks, "paragraph")).toEqual([
      "The first paragraph wraps across two lines of text in the document body. It ends here.",
      "A second paragraph begins after a gap and has an example of hyphenation across the line break.",
      "Back at the margin after the list.",
    ]);
    expect(kinds(blocks, "item")).toEqual([
      "First bullet item",
      "Second bullet item that wraps onto a hanging second line.",
    ]);
  });

  it("CONTROL: the same page without geometry collapses, as the tool used to", () => {
    // The pre-fix behaviour, reproduced through today's fallback: with no
    // geometry there is no boundary between the title, the heading and both
    // paragraphs, so they arrive as one block. The assertion above must be
    // able to tell the two apart.
    const blocks = markdownBlocks(convertWithoutGeometry([WORD_PAGE]).markdown);
    expect(kinds(blocks, "heading")).toEqual(["report"]);
    const first = kinds(blocks, "paragraph")[0] ?? "";
    expect(first).toContain(
      "Quarterly Report Introduction The first paragraph",
    );
    expect(first).toContain("It ends here. A second paragraph");
  });

  it("ranks headings by size under the outline, never as a second H1 or ##", () => {
    const { markdown } = convert([WORD_PAGE, WORD_PAGE]);
    const headingLines = markdown
      .split("\n")
      .filter((line) => line.startsWith("#"));
    expect(headingLines).toEqual([
      "# report",
      "## Page 1",
      "### Quarterly Report",
      "#### Introduction",
      "## Page 2",
      "### Quarterly Report",
      "#### Introduction",
    ]);
    // A single page has no `## Page` level, so headings start at `##`.
    expect(convert([WORD_PAGE]).markdown).toContain("\n## Quarterly Report\n");
  });

  it("keeps each list tight and every other boundary a blank line", () => {
    const { markdown } = convert([WORD_PAGE]);
    expect(markdown).toContain(
      "- First bullet item\n- Second bullet item that wraps onto a hanging second line.\n\nBack at the margin",
    );
  });

  it("splits first-line-indented paragraphs that have no extra gap", () => {
    // LaTeX and book layouts: a constant pitch, the new paragraph indented.
    const page = [
      run("Body text at the margin that runs on to", 72, 700),
      run("a second line at the margin.", 72, 686),
      run("An indented first line starts the next", 87, 672),
      run("paragraph and continues at the margin.", 72, 658),
    ];
    expect(
      kinds(markdownBlocks(convert([page]).markdown), "paragraph"),
    ).toEqual([
      "Body text at the margin that runs on to a second line at the margin.",
      "An indented first line starts the next paragraph and continues at the margin.",
    ]);
  });

  it("breaks at a jump back up the page (a second column)", () => {
    const page = [
      run("Left column line one", 72, 700),
      run("left column line two.", 72, 686),
      run("Right column line one", 320, 700),
      run("right column line two.", 320, 686),
    ];
    expect(
      kinds(markdownBlocks(convert([page]).markdown), "paragraph"),
    ).toEqual([
      "Left column line one left column line two.",
      "Right column line one right column line two.",
    ]);
  });

  it("does not promote large body text that is long or ends a sentence", () => {
    const page = [
      run("A pull quote set large enough to look like a heading.", 72, 700, 16),
      run("Body text follows.", 72, 670),
      run("Body text continues on.", 72, 656),
    ];
    const blocks = markdownBlocks(convert([page]).markdown);
    expect(kinds(blocks, "heading")).toEqual(["report"]);
  });

  it("escapes source text that a renderer would read as Markdown or HTML", () => {
    // Two-line blocks set the 14pt pitch; the 24pt steps are then gaps.
    const page = [
      run("Use <div class=x> to wrap", 72, 700),
      run("it in a block.", 72, 686),
      run("---", 72, 662),
      run("> not a quote", 72, 638),
      run("```", 72, 614),
      run("plain **bold** stays", 72, 590),
      run("on two lines.", 72, 576),
    ];
    const { markdown } = convert([page]);
    expect(markdown).toContain("Use &lt;div class=x> to wrap it in a block.");
    expect(markdown).toContain("\n\n\\---\n\n");
    expect(markdown).toContain("\n\n\\> not a quote\n\n");
    expect(markdown).toContain("\n\n\\```\n\n");
    expect(markdown).toContain("plain **bold** stays on two lines.");
  });

  it("keeps a literal entity reference literal, and a bare & bare", () => {
    // A PDF that SHOWS `&lt;` (an HTML tutorial, say) must not render as `<`.
    const page = [
      run("Type &lt; or &#60; for a less-than", 72, 700),
      run("sign; R&D and A & B stay as written.", 72, 686),
    ];
    const { markdown } = convert([page]);
    expect(markdown).toContain(
      "Type &amp;lt; or &amp;#60; for a less-than sign; R&D and A & B stay as written.",
    );
  });
});

describe("pdf-to-markdown", () => {
  it("escapes Markdown-sensitive leading characters without destroying text", () => {
    expect(normalizeMarkdownLine("# not a heading")).toBe("\\# not a heading");
    expect(normalizeMarkdownLine("plain **bold** text")).toBe(
      "plain **bold** text",
    );
    expect(normalizeMarkdownLine("   spaced   ")).toBe("spaced");
  });

  it("escapes every thematic break, not only a lone marker", () => {
    // The pattern once read ^([-*_])\s*$: it escaped "-" and let "---", "***"
    // and "___" — the thematic breaks themselves — through.
    for (const rule of ["-", "---", "***", "___", "* * *", "- - -"]) {
      expect(normalizeMarkdownLine(rule)).toBe(`\\${rule}`);
    }
    expect(normalizeMarkdownLine("-- dash dash")).toBe("-- dash dash");
  });

  it("removes line-break hyphenation inside a block, and only there", () => {
    expect(joinWrappedLines(["an exam-", "ple"])).toBe("an example");
    expect(joinWrappedLines(["soft\u00AD", "hyphen"])).toBe("softhyphen");
    // A capital or a digit after the break: a real hyphen, and no space.
    expect(joinWrappedLines(["Jean-", "Paul"])).toBe("Jean-Paul");
    expect(joinWrappedLines(["2019-", "2020"])).toBe("2019-2020");
    // A spaced dash is punctuation between words, not part of either.
    expect(joinWrappedLines(["before -", "after"])).toBe("before - after");
  });

  it("converts extracted page text into clean, page-separated Markdown", () => {
    const result = extractedTextToMarkdown(extracted(), {
      sourceName: "sample.pdf",
    });
    expect(result.hasMarkdown).toBe(true);
    expect(result.pageCount).toBe(2);
    expect(result.characterCount).toBeGreaterThan(50);
    expect(result.markdown).toContain("# sample");
    expect(result.markdown).toContain("## Page 1");
    expect(result.markdown).toContain("First paragraph wraps across lines.");
    expect(result.markdown).toContain("- existing bullet");
    expect(result.markdown).toContain("## Page 2");
    expect(result.markdown).toContain("1. numbered");
  });

  it("does not fabricate Markdown for image-only/scanned PDFs", () => {
    const result = extractedTextToMarkdown(
      extracted({
        hasText: false,
        pages: [{ pageNumber: 1, text: "", characterCount: 0, lines: [] }],
      }),
    );
    expect(result.hasMarkdown).toBe(false);
    expect(result.markdown).toBe("");
    expect(result.characterCount).toBe(0);
  });

  it("names Markdown downloads from source PDFs", () => {
    expect(markdownOutputName("report.final.pdf")).toBe(
      "report.final-markdown.md",
    );
  });
});

/* ------------------------------------------------------------------ *
 *  Geometry measured from real generators
 * ------------------------------------------------------------------ */

type Row = [text: string, x: number, y: number, size: number];

/** One page of measured lines, as `extractPdfLines` would hand it over. */
function measuredPage(rows: Row[]): PdfToMarkdownInput {
  const text = rows.map(([t]) => t).join("\n");
  return {
    pageCount: 1,
    hasText: true,
    text,
    characterCount: text.length,
    pages: [
      {
        pageNumber: 1,
        text,
        characterCount: text.length,
        lines: rows.map(([t, x, y, size]) => ({
          text: t,
          x,
          y,
          size,
          fontName: null,
        })),
      },
    ],
  };
}

/**
 * Every visual line of a Word 16 "Save as PDF" export with the default styles
 * (Title, Heading 1, two Normal paragraphs, Heading 2, List Bullet, Normal,
 * List Number), read back through pdfjs 6.1.200 on 2026-09-27. The whole page,
 * not an excerpt: the gaps between the lines are the measurement.
 */
const WORD_16_EXPORT: Row[] = [
  ["Vendor Integration Guide", 72, 693.7, 27.96],
  ["Getting started", 72, 649.1, 20.04],
  [
    "This guide explains how to connect the vendor portal to your accounting system. It covers",
    72,
    624.2,
    12,
  ],
  [
    "authentication, the synchronisation schedule, and what happens when a record fails",
    72,
    607.3,
    12,
  ],
  [
    "validation. Read it once end to end before you configure anything.",
    72,
    590.3,
    12,
  ],
  [
    "The second paragraph is separated from the first by the default spacing Word applies after",
    72,
    565.3,
    12,
  ],
  [
    "every paragraph, and it is long enough to wrap across several lines on a standard page.",
    72,
    548.4,
    12,
  ],
  ["Requirements", 72, 519.7, 15.96],
  ["\u2022 An administrator account on the vendor portal", 72, 495.9, 12],
  [
    "\u2022 A service user in the accounting system with write access to the ledger and to every",
    72,
    478.1,
    12,
  ],
  [
    "cost centre you intend to synchronise, which makes this item wrap",
    90,
    461.2,
    12,
  ],
  ["\u2022 Network access to the API endpoint", 72, 443.5, 12],
  [
    "Once these are in place, continue with the configuration steps below. Use the <config>",
    72,
    418.5,
    12,
  ],
  ["block exactly as shown.", 72, 401.5, 12],
  ["1. Open the settings page.", 72, 376.5, 12],
  ["2. Paste the key.", 72, 359.6, 12],
  ["3.", 72, 342.6, 12],
];

/**
 * A Chrome "print to PDF" of justified book-style HTML: first-line-indented
 * paragraphs with NO extra vertical space, then a two-column section whose
 * middle paragraph flows across the column break mid-sentence.
 */
const CHROME_BOOK: Row[] = [
  ["Chapter One", 99.7, 678.8, 15],
  [
    "The ferry left the harbour an hour late, and nobody on the quay",
    116.2,
    653.3,
    10.99,
  ],
  [
    "seemed surprised. Crates of oranges were stacked along the rail, and a dog",
    99.7,
    641.3,
    10.99,
  ],
  [
    "slept on a coil of rope as though it had been paid to guard it.",
    99.7,
    629.3,
    10.99,
  ],
  [
    "By noon the wind had turned, and the grey water began to lift in long",
    116.2,
    617.3,
    10.99,
  ],
  [
    "slow swells. The passengers who had been reading put their books away",
    99.7,
    605.3,
    10.99,
  ],
  [
    "and watched the horizon instead, as if it might run off.",
    99.7,
    593.3,
    10.99,
  ],
  [
    "At the stern an old man counted the gulls aloud, losing his place every",
    116.2,
    581.3,
    10.99,
  ],
  ["few minutes and starting over again.", 99.7, 569.3, 10.99],
  ["Two columns", 99.7, 541.5, 15],
  ["The left column holds the first", 116.2, 516, 10.99],
  ["paragraph of a two column", 99.7, 504, 10.99],
  ["layout, long enough to wrap over", 99.7, 492, 10.99],
  ["several lines before it ends.", 99.7, 480, 10.99],
  ["A second paragraph in the", 116.2, 468, 10.99],
  ["flow continues and eventually", 99.7, 456, 10.99],
  ["moves into the right hand column", 294.2, 516, 10.99],
  ["of the page when it runs out of", 294.2, 504, 10.99],
  ["room here.", 294.2, 492, 10.99],
  ["And a third paragraph finishes", 310.7, 480, 10.99],
  ["the section in the right column", 294.2, 468, 10.99],
  ["with a few more words of text.", 294.2, 456, 10.99],
];

describe("pdf-to-markdown over geometry measured from real generators", () => {
  it("the thresholds sit inside what Word measured, not beside it", () => {
    // A second, independent bound on two constants nothing else constrains:
    // the paragraph ratio must fall between Word's line step and its
    // paragraph step, and the heading ratio must admit its smallest heading.
    const step = (a: number, b: number) =>
      WORD_16_EXPORT[a]![2] - WORD_16_EXPORT[b]![2];
    const lineStep = step(2, 3); // inside the first paragraph
    const paragraphStep = step(4, 5); // first paragraph -> second
    expect(lineStep).toBeGreaterThan(16);
    expect(paragraphStep / lineStep).toBeGreaterThan(PARAGRAPH_GAP_RATIO);
    expect(PARAGRAPH_GAP_RATIO).toBeGreaterThan(1.1);
    const heading2 = WORD_16_EXPORT.find(([t]) => t === "Requirements")!;
    expect(heading2[3] / 12).toBeGreaterThanOrEqual(HEADING_SIZE_RATIO);
  });

  it("recovers a Word export's outline, paragraphs and lists", () => {
    const { markdown } = extractedTextToMarkdown(measuredPage(WORD_16_EXPORT), {
      sourceName: "guide.pdf",
    });
    expect(markdown).toBe(
      [
        "# guide",
        "## Vendor Integration Guide",
        "### Getting started",
        "This guide explains how to connect the vendor portal to your accounting system. It covers authentication, the synchronisation schedule, and what happens when a record fails validation. Read it once end to end before you configure anything.",
        "The second paragraph is separated from the first by the default spacing Word applies after every paragraph, and it is long enough to wrap across several lines on a standard page.",
        "#### Requirements",
        "- An administrator account on the vendor portal\n- A service user in the accounting system with write access to the ledger and to every cost centre you intend to synchronise, which makes this item wrap\n- Network access to the API endpoint",
        "Once these are in place, continue with the configuration steps below. Use the &lt;config> block exactly as shown.",
        "1. Open the settings page.\n2. Paste the key.",
        // Word draws the number of the trailing empty List Number paragraph.
        "3.",
      ].join("\n\n"),
    );
  });

  it("splits indented paragraphs and joins a sentence across a column break", () => {
    const blocks = markdownBlocks(
      extractedTextToMarkdown(measuredPage(CHROME_BOOK), {
        sourceName: "b.pdf",
      }).markdown,
    );
    expect(kinds(blocks, "heading")).toEqual([
      "b",
      "Chapter One",
      "Two columns",
    ]);
    const paragraphs = kinds(blocks, "paragraph");
    expect(paragraphs.map((p) => p.slice(0, 24))).toEqual([
      "The ferry left the harbo",
      "By noon the wind had tur",
      "At the stern an old man ",
      "The left column holds th",
      "A second paragraph in th",
      "And a third paragraph fi",
    ]);
    expect(paragraphs[4]).toBe(
      "A second paragraph in the flow continues and eventually moves into the right hand column of the page when it runs out of room here.",
    );
  });

  /*
   * HISTORY. The page pitch was once `quantile(steps, 0.25)`. That fixed pages
   * of wrapped paragraphs and left the same collapse on pages of mostly
   * one-line paragraphs (letters, memos, meeting notes, FAQs): once no more
   * than a quarter of the steps are wraps, the lower quartile lands on the
   * paragraph GAP, nothing exceeds 1.3x it, and the page is one paragraph —
   * even though the page shows the real line pitch in its wrapped lines.
   */
  describe("pitch comes from the wrapped lines, however few", () => {
    // The two steps are read from the Word measurement, not typed.
    const wordStep = (a: number, b: number) =>
      WORD_16_EXPORT[a]![2] - WORD_16_EXPORT[b]![2];
    const lineStep = wordStep(2, 3);
    const paragraphStep = wordStep(4, 5);

    /** A Word page of Normal paragraphs with these line counts, top down. */
    function wordParagraphs(lineCounts: number[]): {
      rows: Row[];
      firstLines: string[];
    } {
      const rows: Row[] = [];
      const firstLines: string[] = [];
      let y = 700;
      lineCounts.forEach((count, p) => {
        for (let l = 0; l < count; l += 1) {
          // Every line ends in a full stop, so a wrongly joined page cannot
          // be told apart from a right one by its punctuation alone.
          const text = `Paragraph ${p + 1} line ${l + 1} of ${count}.`;
          if (l === 0) firstLines.push(text);
          rows.push([text, 72, y, 12]);
          y -= l === count - 1 ? paragraphStep : lineStep;
        }
      });
      return { rows, firstLines };
    }

    const paragraphsOf = (rows: Row[]) =>
      kinds(
        markdownBlocks(
          extractedTextToMarkdown(measuredPage(rows), { sourceName: "m.pdf" })
            .markdown,
        ),
        "paragraph",
      );

    it("HEALTH CHECK: the measured steps are a line and a paragraph gap", () => {
      expect(lineStep).toBeGreaterThan(16);
      expect(paragraphStep / lineStep).toBeGreaterThan(PARAGRAPH_GAP_RATIO);
    });

    it("the reviewer's page: two wrapped paragraphs, then five one-liners", () => {
      const { rows, firstLines } = wordParagraphs([2, 2, 1, 1, 1, 1, 1]);
      const paragraphs = paragraphsOf(rows);
      expect(paragraphs).toHaveLength(7);
      expect(paragraphs.map((p) => p.split(" line ")[0])).toEqual(
        firstLines.map((l) => l.split(" line ")[0]),
      );
      expect(paragraphs[0]).toBe(
        "Paragraph 1 line 1 of 2. Paragraph 1 line 2 of 2.",
      );
    });

    it("one wrapped paragraph is enough, however many one-liners follow", () => {
      // Every share of wrap steps from 1/2 down to 1/13: the quartile failed
      // from 1/4 down, so the sweep crosses the old failure boundary.
      for (let oneLiners = 1; oneLiners <= 12; oneLiners += 1) {
        const counts = [2, ...Array<number>(oneLiners).fill(1)];
        const { rows, firstLines } = wordParagraphs(counts);
        const paragraphs = paragraphsOf(rows);
        expect(
          paragraphs.map((p) => p.split(" line ")[0]),
          `${oneLiners} one-line paragraphs`,
        ).toEqual(firstLines.map((l) => l.split(" line ")[0]));
      }
    });

    it("the wrapped paragraph may come last, or sit in the middle", () => {
      for (const counts of [
        [1, 1, 1, 1, 1, 2],
        [1, 1, 3, 1, 1, 1],
      ]) {
        const { rows, firstLines } = wordParagraphs(counts);
        expect(paragraphsOf(rows)).toHaveLength(firstLines.length);
      }
    });

    it("POSITIVE CONTROL: wrapped lines still join into one paragraph", () => {
      const { rows } = wordParagraphs([4, 1, 3]);
      expect(paragraphsOf(rows)).toEqual([
        "Paragraph 1 line 1 of 4. Paragraph 1 line 2 of 4. Paragraph 1 line 3 of 4. Paragraph 1 line 4 of 4.",
        "Paragraph 2 line 1 of 1.",
        "Paragraph 3 line 1 of 3. Paragraph 3 line 2 of 3. Paragraph 3 line 3 of 3.",
      ]);
    });

    it("LIMITATION: a page with no wrapped line at all has no pitch to find", () => {
      // Every step is a paragraph gap, so the smallest step IS the gap and
      // nothing exceeds 1.3x it. The page shows no line pitch to measure.
      // If this goes red because it was fixed, invert it; do not delete it.
      const { rows } = wordParagraphs([1, 1, 1, 1]);
      expect(paragraphsOf(rows)).toHaveLength(1);
    });
  });
});
