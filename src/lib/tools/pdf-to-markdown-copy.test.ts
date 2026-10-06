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
