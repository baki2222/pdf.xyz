// @vitest-environment node
/**
 * Three sentences that were true when written and went stale when a feature
 * shipped underneath them (backlog status check, 2026-11-17).
 *
 *  1. Overlay PDF's drop zone said "Its first page is applied to every page of
 *     your base PDF", and its letterhead FAQ "its first page is drawn over
 *     every page of your document". The paging modes (OVERLAY_PAGINGS: cycle,
 *     repeat last page, once then stop) made that false of three modes of
 *     four, and the page choice made "every page" false of any run with
 *     Selected pages.
 *  2. Extract Tables' catalogue line ended "Scanned PDFs need OCR first." The
 *     panel has run OCR in the same job since 2026-11-08 (audit
 *     extract-tables#3), behind the switch PDF to Word has had since
 *     2026-10-24, and PDF to Excel has it too.
 *  3. Markdown to PDF's catalogue line listed "headings, lists, quotes, and
 *     code fences", under a comment saying there was no table kind. Tables and
 *     rules were drawn from L09, and links open since audit markdown-to-pdf#6.
 *
 * Each ban below carries its corpus in both directions (house rule 1): every
 * sentence that shipped is caught by some shape, every shape catches some
 * shipped sentence, and honest neighbours are not caught. The subjects are
 * DERIVED (rule 4): the copy walk (`copyFiles`), the catalogue through the
 * accessors the page renders (`page-copy`), and, for the OCR switch, the panels
 * the tool page dispatches to, read for whether they render the switch.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { guides } from "@/lib/guides";
import { OVERLAY_PAGINGS } from "@/lib/pdf/offered-kinds";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import { offersOfficeOcr } from "@/lib/jobs/office-export-ocr";
import {
  MARKDOWN_BLOCK_KINDS,
  blockRuns,
  parseMarkdownBlocks,
} from "@/lib/pdf/markdown-to-pdf";
import { panelDispatchArms } from "@/tests/worker-panel-dispatch";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";
import {
  cardSummary,
  pageContent,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { toolFacts } from "./tool-facts";

const ROOT = process.cwd();

/** Non-ASCII typography, from code points (house rule for test strings). */
const LDQ = String.fromCodePoint(0x201c);
const RDQ = String.fromCodePoint(0x201d);
const APOS = String.fromCodePoint(0x2019);
const DASH = String.fromCodePoint(0x2014);
/** How a description names the OCR switch: tick, then the label in curly quotes. */
const TICK_SWITCH = `tick ${LDQ}${WORD_OCR_LABEL}${RDQ}`;

/* ------------------------------------------------------------------ *
 *  The served copy, two ways: as composed by the accessors, and as
 *  written in every walked source file.
 * ------------------------------------------------------------------ */

interface Entry {
  readonly slug: string;
  readonly where: string;
  readonly text: string;
}

/** Every string a tool page or guide renders, through the page's accessors. */
function servedCopy(): Entry[] {
  const out: Entry[] = [];
  for (const tool of tools) {
    const at = (where: string, text: string) =>
      out.push({ slug: tool.slug, where, text });
    at("tagline", tool.tagline);
    at("description", tool.description);
    if (tool.cardSummary) at("cardSummary", cardSummary(tool));
    pageSteps(tool).forEach((s, i) => at(`how[${i}]`, stepText(s)));
    toolFacts(tool.slug).forEach((f, i) => at(`facts[${i}]`, f.value));
    pageFaq(tool).forEach((f, i) => {
      at(`faq[${i}].q`, f.question);
      at(`faq[${i}].a`, f.answer);
    });
    pageIntro(tool).forEach((p, i) => at(`intro[${i}]`, p));
    pageUseCases(tool).forEach((u, i) => at(`useCases[${i}]`, u.body));
    const content = pageContent(tool);
    if (content) at("metaDescription", content.metaDescription);
  }
  for (const guide of guides) {
    const at = (where: string, text: string) =>
      out.push({ slug: `guide:${guide.slug}`, where, text });
    at("description", guide.description);
    guide.intro.forEach((p, i) => at(`intro[${i}]`, p));
    guide.steps.forEach((s, i) => at(`steps[${i}]`, s));
    guide.sections.forEach((section, i) => {
      at(`sections[${i}].heading`, section.heading);
      section.body.forEach((p, j) => at(`sections[${i}].body[${j}]`, p));
    });
    guide.faq.forEach((f, i) => {
      at(`faq[${i}].q`, f.question);
      at(`faq[${i}].a`, f.answer);
    });
  }
  return out;
}

const SERVED = servedCopy();

/** Every walked source file, comments out and wraps flattened. */
const SOURCES: readonly { file: string; text: string }[] = copyFiles().map(
  (file) => ({
    file: path.relative(ROOT, file).replace(/\\/g, "/"),
    text: flattenForPhraseSearch(withoutComments(readFileSync(file, "utf8"))),
  }),
);

/** `name: [where...]` for each shape that matches, over both surfaces. */
function offenders(
  shapes: Record<string, RegExp>,
  served: readonly Entry[],
  sources: readonly { file: string; text: string }[],
): string[] {
  const out: string[] = [];
  for (const [name, re] of Object.entries(shapes)) {
    for (const e of served)
      if (re.test(e.text)) out.push(`${name}: ${e.slug} ${e.where}`);
    for (const s of sources)
      if (re.test(s.text)) out.push(`${name}: ${s.file}`);
  }
  return out;
}

/** Rule 1, both directions, plus the honest neighbours. */
function expectCorpus(
  shapes: Record<string, RegExp>,
  shipped: readonly string[],
  honest: readonly string[],
) {
  // Health: a corpus of nothing is vacuously caught.
  expect(shipped.length).toBeGreaterThan(0);
  expect(honest.length).toBeGreaterThan(0);
  for (const sentence of shipped)
    expect(
      Object.values(shapes).some((re) => re.test(sentence)),
      `no shape catches the shipped sentence: ${sentence}`,
    ).toBe(true);
  for (const [name, re] of Object.entries(shapes))
    expect(
      shipped.some((sentence) => re.test(sentence)),
      `the shape "${name}" catches no shipped sentence`,
    ).toBe(true);
  for (const sentence of honest)
    expect(
      Object.entries(shapes)
        .filter(([, re]) => re.test(sentence))
        .map(([name]) => name),
      `an honest sentence is caught: ${sentence}`,
    ).toEqual([]);
}

describe("the surfaces these bans read", () => {
  it("are implausibly small nowhere", () => {
    // Bounds, not counts: a walk that collapses, or a catalogue that stops
    // being read, reports the strongest possible pass.
    expect(SOURCES.length).toBeGreaterThan(300);
    expect(SERVED.length).toBeGreaterThan(3000);
    const files = new Set(SOURCES.map((s) => s.file));
    // The two files the overlay's stale sentences were in, found by the walk.
    expect(files).toContain("src/components/tools/runner/overlay-runner.tsx");
    expect(files).toContain("src/lib/tools/tool-facts.ts");
  });
});

/* ------------------------------------------------------------------ *
 *  1. Overlay PDF: "its first page … every page"
 * ------------------------------------------------------------------ */

const OVERLAY_SHAPES: Record<string, RegExp> = {
  // The first page, stated as what lands on every page, with no mode in it.
  "its first page is applied to every page": new RegExp(
    String.raw`\b(?:its|the overlay(?:['${APOS}]s)?)\s+first\s+page\s+is\s+(?:applied|drawn|placed|stamped|put|used)\s+(?:to|over|on|onto)\s+(?:every|each|all)\s+(?:of\s+the\s+)?pages?\b`,
    "i",
  ),
};

/** What shipped, verbatim. */
const OVERLAY_SHIPPED = [
  "Its first page is applied to every page of your base PDF",
  "Yes. Save it as a PDF and add it as the overlay: its first page is drawn over every page of your document.",
  // A respelling the shape must catch too (a synonym walks past a string).
  "The overlay's first page is placed on each page.",
];

/** Honest sentences beside it: a MODE's own hint, a one-page overlay. */
const OVERLAY_HONEST = [
  OVERLAY_PAGINGS.find((p) => p.id === "repeat")!.hint,
  "A one-page overlay is drawn over every page of your document, or only the pages you list.",
  "Under Pages, choose Selected pages and type 1: only the first page gets the letterhead.",
];

describe("Overlay PDF does not say its first page goes on every page", () => {
  it("the shapes catch every sentence that shipped, and no honest one", () => {
    expect(OVERLAY_PAGINGS.find((p) => p.id === "repeat")).toBeDefined();
    expectCorpus(OVERLAY_SHAPES, OVERLAY_SHIPPED, OVERLAY_HONEST);
  });

  it("no served string or walked file says it", () => {
    expect(offenders(OVERLAY_SHAPES, SERVED, SOURCES)).toEqual([]);
  });

  it("positive control: the old sentence, planted in a source and in a page, is found", () => {
    const plantedSource = [
      {
        file: "planted.tsx",
        text: flattenForPhraseSearch(
          withoutComments(
            'hint="Its first page is applied to every page of your base PDF"',
          ),
        ),
      },
    ];
    const plantedPage = [
      { slug: "overlay-pdf", where: "faq[0].a", text: OVERLAY_SHIPPED[1]! },
    ];
    expect(offenders(OVERLAY_SHAPES, [], plantedSource)).toHaveLength(1);
    expect(offenders(OVERLAY_SHAPES, plantedPage, [])).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 *  2. The OCR switch: "scans need OCR first" on a page whose panel
 *     runs OCR in the same job
 * ------------------------------------------------------------------ */

/**
 * The tools whose panel renders the OCR switch, DERIVED: every worker panel
 * the tool page dispatches to, read for `<OcrFirstSwitch`; a panel that gates
 * it per tool with `offersOfficeOcr` keeps only the tools that pass.
 */
function switchTools(): { slugs: string[]; panels: string[] } {
  const slugs: string[] = [];
  const panels: string[] = [];
  for (const arm of panelDispatchArms()) {
    const source = readFileSync(path.join(ROOT, arm.file), "utf8");
    if (!/<OcrFirstSwitch\b/.test(source)) continue;
    panels.push(arm.file);
    const gated = /\boffersOfficeOcr\(/.test(source);
    for (const slug of arm.slugs)
      if (!gated || offersOfficeOcr(slug)) slugs.push(slug);
  }
  return { slugs, panels };
}

const SWITCH = switchTools();

const OCR_ELSEWHERE_SHAPES: Record<string, RegExp> = {
  "scans need OCR first":
    /\b(?:scans|scanned(?:\/image-only)?\s+(?:pages|PDFs|files))\s+needs?\s+OCR\s+first\b/i,
  "run OCR first to include them":
    /\brun\s+OCR\s+first\s+to\s+(?:include|have)\b/i,
};

/** What shipped on these pages and panels before the switch, verbatim from git. */
const OCR_ELSEWHERE_SHIPPED = [
  // Extract Tables' catalogue line, until 2026-11-17.
  "Detect aligned tables inside a PDF's selectable text and export them to clean CSV files plus a combined Excel workbook. Scanned PDFs need OCR first.",
  // PDF to Word's, until audit #41 (claims-vs-capability.test.ts keeps it).
  "Turn a PDF's selectable text into editable Word (DOCX) paragraphs, in reading order. Images, fonts, tables and layout are not recreated; scans need OCR first.",
  // PDF to Word's, the last version before the switch (bbc41d5e).
  "Turn a PDF's text into editable Word (DOCX) paragraphs in reading order, its pictures placed between them. Fonts and layout are not recreated; scans need OCR first.",
  // The export panel's PDF to Excel blurb and note, until 04f3c04b.
  "Our server extracts selectable PDF text and packages it into a real XLSX file. Pages without selectable text (scans) are not included; run OCR first to include them.",
  "Running this uses a private secure-server job. Only selectable text is exported; scanned/image-only PDFs need OCR first.",
  // Its PDF to PowerPoint blurb and note, until b85f1b9a.
  "Our server reads each page and builds a real PPTX file: pictures where the page shows them, text in text boxes at their places, other drawing as pictures. A scanned page comes through as a picture; run OCR first to have its words as text too.",
  "Running this uses a private secure-server job. A scanned page comes through as a picture on its slide; run OCR first to have its words as text.",
];

/**
 * Honest neighbours: what the page says the no-text ERROR says (true of a run
 * with the switch off), and a scan's TEXT needing OCR on a tool without it.
 */
const OCR_ELSEWHERE_HONEST = [
  "A PDF with no selectable text stops here, with an error asking you to run OCR first and a link to OCR PDF, unless the switch was ticked.",
  "A file with no text on any page stops with a message telling you to run OCR PDF first.",
  "A scan with no text layer can be compared this way; its text needs OCR first.",
  `For a scan, ${TICK_SWITCH}.`,
];

describe("a page whose panel runs OCR in the same job does not send scans to OCR first", () => {
  it("the switch's tools are derived from the panels, and are plausible", () => {
    // Bounds: Word, Excel, PowerPoint and Extract Tables had it on
    // 2026-11-17. Fewer means the derivation broke, not that pages shrank.
    expect(SWITCH.panels.length).toBeGreaterThanOrEqual(2);
    expect(SWITCH.slugs.length).toBeGreaterThanOrEqual(4);
    for (const slug of SWITCH.slugs)
      expect(
        tools.some((t) => t.slug === slug),
        slug,
      ).toBe(true);
    expect(SWITCH.slugs).toContain("extract-tables");
    expect(SWITCH.slugs).toContain("pdf-to-excel");
  });

  it("the shapes catch every sentence that shipped, and no honest one", () => {
    expectCorpus(
      OCR_ELSEWHERE_SHAPES,
      OCR_ELSEWHERE_SHIPPED,
      OCR_ELSEWHERE_HONEST,
    );
  });

  it("no served string of those tools, their guides or their panels says it", () => {
    const own = new Set(SWITCH.slugs);
    const guideSlugs = new Set(
      guides.filter((g) => own.has(g.tools[0]!)).map((g) => `guide:${g.slug}`),
    );
    const served = SERVED.filter(
      (e) => own.has(e.slug) || guideSlugs.has(e.slug),
    );
    const panels = SOURCES.filter((s) => SWITCH.panels.includes(s.file));
    // Health: the pages and their panels were read.
    expect(served.length).toBeGreaterThan(100);
    expect(guideSlugs.size).toBeGreaterThanOrEqual(3);
    expect(panels.length).toBe(SWITCH.panels.length);
    expect(offenders(OCR_ELSEWHERE_SHAPES, served, panels)).toEqual([]);
  });

  it("a description that talks about scans names the switch by its label", () => {
    const scanLines = tools.filter(
      (t) => SWITCH.slugs.includes(t.slug) && /\bscan/i.test(t.description),
    );
    // Health: Word, Excel and Extract Tables say what to do with a scan.
    expect(scanLines.length).toBeGreaterThanOrEqual(3);
    for (const tool of scanLines)
      expect(tool.description, tool.slug).toContain(TICK_SWITCH);
    // Control: the line that shipped talks about scans and fails this.
    expect(OCR_ELSEWHERE_SHIPPED[0]).toMatch(/\bscan/i);
    expect(OCR_ELSEWHERE_SHIPPED[0]).not.toContain(TICK_SWITCH);
  });

  it("positive control: the old line, planted on Extract Tables' page, is found", () => {
    const planted = [
      {
        slug: "extract-tables",
        where: "description",
        text: OCR_ELSEWHERE_SHIPPED[0]!,
      },
    ];
    expect(offenders(OCR_ELSEWHERE_SHAPES, planted, [])).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 *  3. Markdown to PDF: every claim on its catalogue line, run
 * ------------------------------------------------------------------ */

const MARKDOWN_STALE_SHAPES: Record<string, RegExp> = {
  "headings, lists, quotes and code (and nothing else)":
    /\bheadings,\s+lists,\s+quotes,?\s+and\s+code(?:\s+(?:fences|blocks))?\b/i,
};

const MARKDOWN_STALE_SHIPPED = [
  `Convert Markdown into a styled PDF ${DASH} headings, lists, quotes, and code fences, typeset right in your browser from sources up to 2 MB.`,
  `Turn a .md file or pasted Markdown into a clean PDF with headings, lists, quotes and code blocks ${DASH} typeset in your browser, never uploaded.`,
  `Paste Markdown or pick a .md file and get a typeset PDF ${DASH} headings, lists, quotes and code ${DASH} made in your browser, so nothing leaves your device.`,
];

const MARKDOWN_HONEST = [
  "Turn Markdown into a styled PDF in your browser: headings, lists, quotes, code and tables.",
  "Headings, lists, quotes, code blocks and tables are typeset into pages right in your browser.",
];

/** The source every claim on the line is asked of. */
const SAMPLE = [
  "# Title with [a link](https://example.com/h)",
  "",
  "Plain **bold** and *italic* and `code` with [a link](https://example.com/p).",
  "",
  "- an item",
  "",
  "> a quote",
  "",
  "```",
  "code block",
  "```",
  "",
  "| A | B |",
  "| - | - |",
  "| [cell link](https://example.com/c) | x |",
].join("\n");

describe("Markdown to PDF's catalogue line says what the renderer draws", () => {
  const line = tools.find((t) => t.slug === "markdown-to-pdf")!.description;
  const blocks = parseMarkdownBlocks(SAMPLE);
  const kinds = new Set(blocks.map((b) => b.kind));

  it("the shapes catch every undersold list that shipped, and not the new ones", () => {
    expectCorpus(
      MARKDOWN_STALE_SHAPES,
      MARKDOWN_STALE_SHIPPED,
      MARKDOWN_HONEST,
    );
    expect(offenders(MARKDOWN_STALE_SHAPES, SERVED, SOURCES)).toEqual([]);
  });

  it("each block it names is a kind the renderer has, and parses from Markdown", () => {
    // The words the line uses, each to the kind it promises.
    const named: Record<string, (typeof MARKDOWN_BLOCK_KINDS)[number]> = {
      headings: "heading",
      lists: "list-item",
      quotes: "quote",
      code: "code",
      tables: "table",
    };
    for (const [word, kind] of Object.entries(named)) {
      expect(line, `the line names ${word}`).toMatch(
        new RegExp(`\\b${word}\\b`),
      );
      expect(MARKDOWN_BLOCK_KINDS).toContain(kind);
      expect(kinds.has(kind), `the parser made no ${kind}`).toBe(true);
    }
  });

  it("web links open outside tables and only print inside them, as the line says", () => {
    expect(line).toMatch(/\bWeb links open when clicked, except in tables\b/);
    const paragraph = blocks.find((b) => b.kind === "paragraph")!;
    const heading = blocks.find((b) => b.kind === "heading")!;
    const table = blocks.find((b) => b.kind === "table")!;
    const hrefs = (b: (typeof blocks)[number]) =>
      (blockRuns(b) ?? []).map((r) => r.href).filter(Boolean);
    expect(hrefs(paragraph)).toEqual(["https://example.com/p"]);
    expect(hrefs(heading)).toEqual(["https://example.com/h"]);
    // The day a cell's link opens, "except in tables" is the stale claim.
    expect(hrefs(table)).toEqual([]);
  });

  it("does not promise bold or italics, which a non-Western document loses", () => {
    // The parser does style them (positive control on the reason)...
    const paragraph = blocks.find((b) => b.kind === "paragraph")!;
    const styled = (blockRuns(paragraph) ?? []).filter((r) => r.style !== 0);
    expect(styled.length).toBeGreaterThanOrEqual(3);
    // ...but the line stays clear of them: one character outside Western
    // European text sets the whole PDF in one Noto face, no bold, no oblique.
    expect(line).not.toMatch(/\bbold\b|\bitalic/i);
  });
});
