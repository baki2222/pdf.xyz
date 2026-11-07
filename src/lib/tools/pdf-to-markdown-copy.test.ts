// @vitest-environment node
/**
 * PDF to Markdown's page, held to the converter the runner calls.
 *
 * Until 2026-10-06 the page served five false descriptions of structure at
 * once: line breaks "become spaces", a new paragraph starts "only" at an empty
 * line, "nothing becomes a heading", the only headings are the title and the
 * page headings, and • bullets "merge into the paragraph". Every one had been
 * true of the text-only chain, and every one went false underneath when the
 * runner moved to `extractPdfLines` and the converter began building each page
 * from its lines' geometry (ed6a206c, e59b2f01): paragraphs split on the gap
 * and the first-line indent, short large lines become headings, and glyph
 * bullets become list items. `derived-tool-copy.test.ts` checked the facts
 * panel against the converter and stayed green, because each fact it checked
 * was true and incomplete; it never asked what the rest of the page served.
 *
 * So this reads everything the page SERVES (the accessors the page renders,
 * not the content module's fields) and holds it to the converter both ways:
 *
 *   - the sentences that shipped are the corpus of a ban list, in both
 *     directions (house rule 1): each is caught by a pattern, and each pattern
 *     catches one of them;
 *   - the numbers the page states are interpolated from the converter's own
 *     constants, and the converter is run either side of each one, so a page
 *     that names a threshold names the one the code applies;
 *   - every bullet character the page names is fed through the converter and
 *     must come out a list item.
 */
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { toolFacts } from "./tool-facts";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import {
  BULLET_GLYPHS,
  extractedTextToMarkdown,
  HEADING_MAX_CHARS,
  HEADING_SIZE_RATIO,
  PARAGRAPH_GAP_RATIO,
} from "@/lib/pdf/pdf-to-markdown";
import type { ExtractedPdfLines } from "@/lib/pdf/text";
import {
  DEFAULT_PAGE_HEADINGS,
  DEFAULT_REMOVE_REPEATED_LINES,
  EDGE_LINES,
  MARKDOWN_LINK_SCHEMES,
  REPEATED_LINE_MIN_PAGES,
  REPEATED_LINE_SHARE,
} from "@/lib/pdf/pdf-to-markdown";
import {
  PAGE_HEADINGS_HINT,
  REPEATED_LINES_HINT,
} from "./pdf-to-markdown-options";

import { linksFromPage } from "@/lib/pdf/pdf-to-markdown-read";

/** The tool the pdf-to-markdown runner mounts on, through the page's dispatch. */
const SLUGS = supportedToolSlugs.filter(
  (s) => getRunnerKind(s) === "pdf-to-markdown",
);

/** Everything the tool page renders, as the page renders it. */
function served(slug: string): string[] {
  const tool = getToolBySlug(slug)!;
  return [
    tool.tagline,
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...toolFacts(slug).map((f) => f.value),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

const sentences = (texts: readonly string[]) =>
  texts.flatMap((t) => t.split(/(?<=[.!?])\s+/));

/** One page of lines, laid out as `extractPdfLines` reports them. */
type Line = { text: string; y: number; size?: number; x?: number };
function pdf(lines: Line[]): ExtractedPdfLines {
  const text = lines.map((l) => l.text).join("\n");
  return {
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        text,
        characterCount: text.length,
        lines: lines.map((l) => ({
          text: l.text,
          x: l.x ?? 72,
          y: l.y,
          size: l.size ?? 11,
          fontName: null,
        })),
      },
    ],
    text,
    characterCount: text.length,
    hasText: true,
  };
}
const md = (lines: Line[]) =>
  extractedTextToMarkdown(pdf(lines), { sourceName: "report.pdf" }).markdown;

/** A body paragraph that wraps, so the page has a line pitch to measure. */
const BODY = [
  { text: "The first line of a paragraph that wraps onto", y: 700 },
  { text: "a second line at the body pitch, and then a", y: 686 },
  { text: "third, which ends it.", y: 672 },
];
const PITCH = 14;

describe("pdf-to-markdown: the page describes the structure the converter builds", () => {
  it("finds the one tool, and the page it serves is not empty (health)", () => {
    expect(SLUGS).toEqual(["pdf-to-markdown"]);
    expect(sentences(served(SLUGS[0]!)).length).toBeGreaterThan(30);
  });

  /*
   * The sentences that shipped, verbatim, and the shapes that ban them.
   */
  const GLYPHS = `[${BULLET_GLYPHS}]`;
  const SHIPPED = [
    "Within a page, line breaks become spaces so that sentences wrapped across lines read as one again, while lines that already look like Markdown list items stay on lines of their own.",
    "A new paragraph starts only where the extracted text holds an empty line or a list line; the white space you see between paragraphs on the page is not measured.",
    "In practice, a page often arrives as one long paragraph with its headings run into the sentences around them, ready for you to split where you want.",
    "Font size and weight are ignored, so nothing becomes a heading, bold or italic; table cells run together as plain text; images and the web addresses behind links are dropped.",
    "The only headings in the output are the # title made from the file name and the ## Page headings.",
    "Heading levels, the table grid, bold and italic, link targets and images are all lost.",
    'The rule reads characters, not layout, so bullets typed as • or ▪, or drawn as small shapes rather than stored as characters, merge into the paragraph, while a line such as "2023. Revenue grew" is split out as if it were numbered.',
    "No. A PDF stores text as positioned lines, not as headings or tables, and this converter does not guess at them.",
    'The file\'s name becomes the title, each page gets a "Page N" heading when there is more than one, lines are joined into paragraphs, and lines that begin with a bullet (-, * or +) or a number stay list items.',
    "Lines that wrap are joined into paragraphs; a line that starts with a list marker (-, *, + or a number) stays a list item.",
    // Until 2026-11-08 (audit pdf-to-markdown#3): the reader now keeps a
    // web link's address, so each of these went false.
    "Font weight and style are not read, so nothing becomes bold or italic; table cells run together as plain text; images and the web addresses behind links are dropped.",
    "The table grid, bold and italic, link targets and images are lost; table cells come through as words.",
    "Images are dropped, and so are the web addresses behind links.",
    // Until 2026-11-08 (audit pdf-to-markdown#4): a detected table is now a
    // Markdown table.
    "Font weight and style are not read, so nothing becomes bold or italic; table cells run together as plain text; images are dropped.",
    "The table grid, bold and italic and images are lost; table cells come through as words.",
    "Tables, images and text styling are not recreated — table rows come through as plain text.",
    "Not as Markdown tables.",
    "A table's cells run together as plain words, without its grid.",
    // Until 2026-11-08 (audit pdf-to-markdown#5): the runner has an option.
    "There is nothing to set first.",
    "It takes one PDF at a time, up to 50 MB, and there are no settings to choose.",
  ];
  const BANNED: RegExp[] = [
    // Every line break, not only a wrap, said to become a space.
    /\bline breaks become spaces\b/i,
    // Paragraph breaks said to come only from the text, never the page.
    /\bnew paragraph starts only\b/i,
    /\bwhite space\b[^.]*\bnot measured\b/i,
    /\bone long paragraph\b/i,
    // Headings said never to be detected.
    /\bfont size\b[^.;]*\bignored\b/i,
    /\bnothing becomes a heading\b/i,
    /\bonly headings\b/i,
    /\bheading levels\b[^.]*\blost\b/i,
    /\bdoes not guess\b/i,
    // Links said to lose their address.
    /\b(web addresses behind links|link targets)\b/i,
    // Tables said never to become Markdown tables.
    /\btable(?:'s)? (cells|rows) (run together|come through)\b/i,
    /\bnot as Markdown tables\b/i,
    // A runner with an option said to have none.
    /\b(nothing to set|no settings)\b/i,
    // A glyph bullet said to merge into the paragraph.
    new RegExp(`${GLYPHS}[^.]*\\bmerge`),
    // A list of markers that stops at the ASCII ones.
    new RegExp(`\\((?=[^)]*-, \\*)(?![^)]*${GLYPHS})[^)]*\\)`),
  ];

  it("the banned shapes and the sentences that shipped catch each other (both directions)", () => {
    const uncaught = SHIPPED.filter((s) => !BANNED.some((p) => p.test(s)));
    expect(uncaught).toEqual([]);
    const idle = BANNED.filter((p) => !SHIPPED.some((s) => p.test(s))).map(
      String,
    );
    expect(idle).toEqual([]);
  });

  it("each banned claim is false of the converter (the ban's licence)", () => {
    // A heading, at the first size the converter promotes.
    const heading = md([
      { text: "Quarterly results", y: 730, size: 11 * HEADING_SIZE_RATIO },
      ...BODY,
    ]);
    expect(heading).toMatch(/^#{2,6} Quarterly results$/m);
    // A paragraph break from the gap alone, with no empty line in the text.
    const gap = md([
      ...BODY,
      { text: "A second paragraph after a wider gap.", y: 672 - PITCH * 2 },
    ]);
    expect(gap).toMatch(/ends it\.\n\nA second paragraph/);
    // A glyph bullet, which is a list item, not paragraph text.
    expect(md([...BODY, { text: "• a bullet", y: 658 }])).toMatch(
      /^- a bullet$/m,
    );
  });

  it("no served sentence matches a banned shape", () => {
    const offenders = SLUGS.flatMap((slug) =>
      sentences(served(slug))
        .filter((s) => BANNED.some((p) => p.test(s)))
        .map((s) => `${slug}: "${s}"`),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  /*
   * The thresholds the page states, interpolated from the converter's own
   * constants, and the converter run either side of each.
   */
  const HEADING_PERCENT = Math.round((HEADING_SIZE_RATIO - 1) * 100);

  it(`the page names the heading threshold the converter applies (${HEADING_PERCENT}% larger)`, () => {
    const text = served(SLUGS[0]!).join(" ");
    expect(text).toContain(`${HEADING_PERCENT}% larger than the body text`);
    const at = (size: number, line = "Quarterly results") =>
      md([{ text: line, y: 730, size }, ...BODY]);
    expect(at(11 * (1 + HEADING_PERCENT / 100))).toMatch(
      /^#{2,6} Quarterly results$/m,
    );
    expect(at(11 * (1 + (HEADING_PERCENT - 5) / 100))).not.toMatch(
      /^#{2,6} Quarterly results$/m,
    );
    // The other limits the FAQ names: length, and a closing full stop.
    expect(text).toContain(`longer than ${HEADING_MAX_CHARS} characters`);
    const long = "Q".repeat(HEADING_MAX_CHARS + 1);
    expect(at(11 * HEADING_SIZE_RATIO, long)).not.toMatch(/^#{2,6} Q/m);
    expect(at(11 * HEADING_SIZE_RATIO, "Results.")).not.toMatch(/^#{2,6} /m);
  });

  it("the numbered-heading and mid-sentence-wrap claims hold in the converter (audit #8)", () => {
    // Added 2026-11-06 with the fix: the page now names both cases, so each
    // claim is run through the converter, with the opposite case as a control.
    const text = served(SLUGS[0]!).join(" ");
    expect(text).toContain('A numbered heading such as "1. Introduction"');
    expect(
      md([
        { text: "1. Introduction", y: 730, size: 11 * HEADING_SIZE_RATIO },
        ...BODY,
      ]),
    ).toMatch(/^#{2,6} 1\. Introduction$/m);
    expect(md([...BODY, { text: "1. Introduction", y: 658 }])).toMatch(
      /^1\. Introduction$/m,
    );
    expect(text).toContain("in the middle of a sentence");
    const wrap = (first: string) =>
      md([
        { text: first, y: 700 },
        { text: "2023. Revenue grew", y: 686 },
      ]);
    expect(wrap("Sales were flat until")).toMatch(
      /until 2023\. Revenue grew$/m,
    );
    expect(wrap("Sales were flat.")).toMatch(/^2023\. Revenue grew$/m);
    // Review of audit #8: the two clauses that bound the rules above.
    expect(text).toContain("each numbered line is a heading of its own");
    const big = 11 * HEADING_SIZE_RATIO;
    const headings = md([
      ...BODY,
      { text: "1. First point", y: 640, size: big },
      { text: "2. Second point", y: 620, size: big },
    ]);
    expect(headings).toMatch(/^#{2,6} 1\. First point$/m);
    expect(headings).toMatch(/^#{2,6} 2\. Second point$/m);
    expect(text).toContain("carries the next number or the same dash");
    expect(
      md([
        { text: "Sales were flat until", y: 700 },
        { text: "1. Open the page", y: 686 },
        { text: "2. Paste the key", y: 672 },
      ]),
    ).toMatch(/until\n\n1\. Open the page\n2\. Paste the key$/);
  });

  it(`the page names the paragraph gap the converter applies (${PARAGRAPH_GAP_RATIO} times)`, () => {
    const text = served(SLUGS[0]!).join(" ");
    expect(text).toContain(`more than ${PARAGRAPH_GAP_RATIO} times`);
    const after = (step: number) =>
      md([...BODY, { text: "Next line here.", y: 672 - step }]);
    expect(after(PITCH * PARAGRAPH_GAP_RATIO * 1.05)).toMatch(
      /ends it\.\n\nNext line here\./,
    );
    expect(after(PITCH * PARAGRAPH_GAP_RATIO * 0.95)).toMatch(
      /ends it\. Next line here\./,
    );
  });

  it("the page names the link schemes the reader keeps, and each is kept (audit pdf-to-markdown#3)", () => {
    const text = served(SLUGS[0]!).join(" ");
    const named = `${MARKDOWN_LINK_SCHEMES.slice(0, -1).join(", ")} or ${MARKDOWN_LINK_SCHEMES.at(-1)}`;
    expect(text).toContain(`starts with ${named}`);
    const linked = (url: string) => {
      const input = pdf([{ text: "Read the setup guide first.", y: 700 }]);
      // 27 characters over 270pt: "setup guide" is x 162..272, and the box
      // covers its letters' centres.
      const links = linksFromPage(
        [
          {
            str: "Read the setup guide first.",
            transform: [11, 0, 0, 11, 72, 700],
            width: 270,
            height: 11,
          },
        ],
        [{ subtype: "Link", url, rect: [162, 696, 272, 712] }],
      );
      return extractedTextToMarkdown(
        { ...input, pages: input.pages.map((p) => ({ ...p, links })) },
        { sourceName: "r.pdf" },
      ).markdown;
    };
    for (const scheme of MARKDOWN_LINK_SCHEMES) {
      const url =
        scheme === "mailto:"
          ? "mailto:a@example.com"
          : `${scheme}//example.com/g`;
      expect(linked(url)).toContain(`Read the [setup guide](${url}) first.`);
    }
    // CONTROL: a scheme the page does not name keeps its words only.
    expect(linked("ftp://example.com/g")).toContain(
      "Read the setup guide first.",
    );
  });

  it("the page's table claim holds in the converter (audit pdf-to-markdown#4)", () => {
    const text = served(SLUGS[0]!).join(" ");
    expect(text).toContain(
      "A table whose cells line up in columns becomes a Markdown table with its first row as the header",
    );
    const rows = ["Item Qty", "Apples 3"];
    const input = pdf(rows.map((row, i) => ({ text: row, y: 700 - i * 14 })));
    const table = {
      rows: [
        ["Item", "Qty"],
        ["Apples", "3"],
      ],
      top: 700,
      bottom: 686,
    };
    const withTable = extractedTextToMarkdown(
      { ...input, pages: input.pages.map((p) => ({ ...p, tables: [table] })) },
      { sourceName: "r.pdf" },
    ).markdown;
    expect(withTable).toContain(
      "| Item | Qty |\n| --- | --- |\n| Apples | 3 |",
    );
    // CONTROL: "one that shares its rows with other text ... stays as plain
    // lines" — a line on its rows holding more than its cells.
    const shared = pdf([
      { text: "Item Qty and a note", y: 700 },
      { text: "Apples 3", y: 686 },
    ]);
    expect(
      extractedTextToMarkdown(
        {
          ...shared,
          pages: shared.pages.map((p) => ({ ...p, tables: [table] })),
        },
        { sourceName: "r.pdf" },
      ).markdown,
    ).not.toContain("| --- |");
  });

  it("the page names the header-and-footer option and its rule, from the converter's constants (audit pdf-to-markdown#5)", () => {
    const text = served(SLUGS[0]!).join(" ");
    // The label is the runner's JSX text; tick-label-claims.test.ts holds the
    // quoted name after "Untick" to a checkbox that exists.
    expect(text).toContain(
      '"Leave out repeated headers and footers" starts ticked',
    );
    expect(text).toContain(REPEATED_LINES_HINT);
    // The hint states the converter's own numbers.
    expect(REPEATED_LINES_HINT).toContain(`${EDGE_LINES} lines`);
    expect(REPEATED_LINES_HINT).toContain(
      `${Math.round(REPEATED_LINE_SHARE * 100)}% of the pages that have text`,
    );
    expect(REPEATED_LINES_HINT).toContain(
      `${REPEATED_LINE_MIN_PAGES} or more pages have text`,
    );
    expect(DEFAULT_REMOVE_REPEATED_LINES).toBe(true);
  });

  it("the page-heading option does what the page says (audit pdf-to-markdown#6)", () => {
    const text = served(SLUGS[0]!).join(" ");
    expect(text).toContain(
      'unless you untick "Start each page with a Page heading"',
    );
    expect(text).toContain(PAGE_HEADINGS_HINT);
    expect(DEFAULT_PAGE_HEADINGS).toBe(true);
    const twoPages = (includePageHeadings?: boolean) => {
      const one = pdf([
        { text: "Results", y: 740, size: 11 * HEADING_SIZE_RATIO },
        ...BODY.slice(0, 2),
      ]);
      const two = pdf([{ text: "carried on over the break.", y: 740 }]);
      const pages = [one.pages[0]!, { ...two.pages[0]!, pageNumber: 2 }];
      return extractedTextToMarkdown(
        { ...one, pageCount: 2, pages },
        { sourceName: "r.pdf", includePageHeadings },
      ).markdown;
    };
    // On (the default): a ## Page heading per page, detected headings below.
    expect(twoPages()).toMatch(/^## Page 2$/m);
    expect(twoPages()).toMatch(/^### Results$/m);
    // Off: no page headings, headings "start at ##", and the sentence the
    // page break cut "is joined back up".
    const off = twoPages(false);
    expect(off).not.toContain("## Page");
    expect(off).toMatch(/^## Results$/m);
    expect(off).toContain("and then a carried on over the break.");
  });

  it("every bullet character the page names becomes a list item", () => {
    // Any non-ASCII symbol in a served sentence about bullets: the page's own
    // examples, read off the page rather than off the converter's list.
    const named = new Set(
      sentences(served(SLUGS[0]!))
        .filter((s) => /\bbullet/i.test(s))
        .flatMap((s) => [...s.matchAll(/[^\p{L}\p{N}\p{Z}\x00-\x7F‘-‟–—…]/gu)])
        .map((m) => m[0]),
    );
    // Health: the page names glyph bullets at all.
    expect(named.size).toBeGreaterThanOrEqual(2);
    for (const glyph of named) {
      expect(
        md([...BODY, { text: `${glyph} an item`, y: 658 }]),
        `"${glyph}" is named as a bullet but does not become a list item`,
      ).toMatch(/^- an item$/m);
    }
    // CONTROL: the same line without the glyph is not a list item.
    expect(md([...BODY, { text: "an item", y: 658 }])).not.toMatch(/^- /m);
  });
});
