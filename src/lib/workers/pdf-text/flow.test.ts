// @vitest-environment node
/**
 * PDF to Word's paragraph rules, run over VERBATIM poppler output
 * (`src/tests/poppler-samples.ts`) for fixtures whose content is known
 * (`src/tests/pdf-office-fixtures.ts`).
 *
 * The defect this pins: PDF to Word wrote one paragraph per `-layout` line, so
 * a two-column page came out with each left-column line glued to its
 * right-column neighbour. The predicate below — "the left column's sentence is
 * one paragraph, before the right column's" — is run over the OLD shape too,
 * as the positive control: it must be able to go red on exactly that defect.
 */
import { describe, expect, it } from "vitest";
import {
  columnsReadInOrder,
  HIGHLIGHTS_LEFT,
  HIGHLIGHTS_RIGHT,
  LEFT_COLUMN,
  NEWSLETTER_LEFT,
  NEWSLETTER_RIGHT,
  paragraphsReadWhole,
  RIGHT_COLUMN,
  rowsHeldTogether,
  SIDEBAR_LIST,
  SIDEBAR_MAIN,
  SKU_ROWS,
  STATEMENT_ROWS,
  TABLE_ROWS,
} from "@/tests/pdf-office-fixtures";
import {
  HIGHLIGHTS_BBOX,
  NEWSLETTER_BBOX,
  SIDEBAR_BBOX,
  SKU_TABLE_BBOX,
  STATEMENT_BBOX,
  TABLE_BBOX,
  TWO_COLUMN_BBOX,
  TWO_COLUMN_LAYOUT,
} from "@/tests/poppler-samples";
import {
  parseLayoutText,
  parseBboxFlow,
  type FlowLine,
  type FlowPage,
} from "./parse";
import { flowParagraphs, flowText, type FlowParagraph } from "./flow";

const LEFT = LEFT_COLUMN.join(" ");
const RIGHT = RIGHT_COLUMN.join(" ");

const prose = (paragraphs: FlowParagraph[]) =>
  paragraphs.map((p) => p.join("\t"));

const lineText = (line: FlowLine) => line.words.map((w) => w.text).join(" ");

/** poppler's reading order with no table rule: one paragraph per block. */
const blockOrder = (page: FlowPage) =>
  page.blocks.map((b) => b.lines.map(lineText).join(" "));

const pageOf = (xhtml: string) => parseBboxFlow(xhtml).pages[0]!;

describe("parseBboxFlow — the corpus is the size it should be", () => {
  it("keeps poppler's page / block / line hierarchy on the real samples", () => {
    // Health check: a parser that silently dropped blocks would make every
    // assertion below pass or fail for the wrong reason.
    const two = parseBboxFlow(TWO_COLUMN_BBOX);
    expect(two.pageCount).toBe(1);
    expect(two.pages[0]!.blocks.map((b) => b.lines.length)).toEqual([1, 3, 3]);
    const table = parseBboxFlow(TABLE_BBOX);
    expect(table.pages[0]!.blocks.map((b) => b.lines.length)).toEqual([
      3, 3, 3, 3,
    ]);
    expect(
      table.pages[0]!.blocks.flatMap((b) => b.lines).flatMap((l) => l.words),
    ).toHaveLength(TABLE_ROWS.flat().length);
  });

  it("counts a page with no words as a page", () => {
    const layout = parseBboxFlow(
      `<doc><page width="612" height="792"></page><page width="612" height="792"><flow><block><line><word xMin="1" yMin="1" xMax="9" yMax="9">x</word></line></block></flow></page></doc>`,
    );
    expect(layout.pageCount).toBe(2);
    expect(layout.pages[0]!.blocks).toEqual([]);
  });
});

describe("flowParagraphs — two columns of prose", () => {
  it("reads the left column as one paragraph, then the right", () => {
    const paragraphs = prose(
      flowParagraphs(parseBboxFlow(TWO_COLUMN_BBOX).pages[0]!),
    );
    expect(paragraphs).toEqual(["Quarterly Report", LEFT, RIGHT]);
    expect(columnsReadInOrder(paragraphs)).toBe(true);
  });

  it("POSITIVE CONTROL: the old one-paragraph-per-layout-line shape fails the same predicate", () => {
    // What PDF to Word shipped: `-layout` lines, trimmed, one <w:p> each.
    const old = parseLayoutText(TWO_COLUMN_LAYOUT)
      .text.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(
      old.some(
        (l) => l.includes(LEFT_COLUMN[0]) && l.includes(RIGHT_COLUMN[0]),
      ),
    ).toBe(true);
    expect(columnsReadInOrder(old)).toBe(false);
  });
});

describe("flowParagraphs — a table keeps its rows", () => {
  it("rebuilds rows from the per-column blocks poppler splits a grid into", () => {
    const paragraphs = flowParagraphs(parseBboxFlow(TABLE_BBOX).pages[0]!);
    expect(paragraphs).toEqual(TABLE_ROWS.map((row) => [...row]));
  });

  it("splits a whole row printed as one wide-gapped line into cells", () => {
    // The shape the table-extract parser's own sample uses: one <line> per row.
    const xhtml = `<doc><page width="595" height="842">
      <flow><block><line>
        <word xMin="60" yMin="94.1" xMax="97.3" yMax="104.3">Region</word>
        <word xMin="200" yMin="94.1" xMax="214.7" yMax="104.3">Q1</word>
      </line></block></flow>
      <flow><block><line>
        <word xMin="60" yMin="118.1" xMax="95" yMax="128.3">North</word>
        <word xMin="200" yMin="118.1" xMax="222" yMax="128.3">1200</word>
      </line></block></flow>
    </page></doc>`;
    expect(flowParagraphs(parseBboxFlow(xhtml).pages[0]!)).toEqual([
      ["Region", "Q1"],
      ["North", "1200"],
    ]);
  });

  it("does not read two columns of SHORT prose-free lines as prose (and vice versa)", () => {
    // Alignment alone decides nothing: both samples share baselines across
    // columns. A column of short values does. Swapping them swaps the verdicts.
    const table = flowParagraphs(parseBboxFlow(TABLE_BBOX).pages[0]!);
    const two = flowParagraphs(parseBboxFlow(TWO_COLUMN_BBOX).pages[0]!);
    expect(table.every((p) => p.length > 1)).toBe(true);
    expect(two.every((p) => p.length === 1)).toBe(true);
  });
});

/**
 * The first table rule counted long cells PER BAND and gave up at half. A
 * label/amount row with a four-word label is exactly half, so a statement never
 * formed a run of rows and poppler's reading order — every label, then every
 * amount — went into the DOCX. Measured on these same samples.
 */
describe("flowParagraphs — tables with a text column keep their rows", () => {
  const cases = [
    ["a label / amount statement", STATEMENT_BBOX, STATEMENT_ROWS],
    ["a SKU table with a description column", SKU_TABLE_BBOX, SKU_ROWS],
  ] as const;

  for (const [what, xhtml, rows] of cases) {
    it(`health check: ${what} has a cell of four or more words, and poppler splits it into one block per column`, () => {
      // Without a long cell this sample could not tell the rules apart; and
      // if poppler kept rows together, reading order would already be right.
      expect(
        rows.some((row) => row.some((c) => c.split(" ").length >= 4)),
      ).toBe(true);
      expect(pageOf(xhtml).blocks.map((b) => b.lines.length)).toEqual([
        rows.length,
        rows.length,
      ]);
    });

    it(`keeps each row of ${what} in one paragraph`, () => {
      const paragraphs = flowParagraphs(pageOf(xhtml));
      expect(paragraphs).toEqual(rows.map((row) => [...row]));
      expect(rowsHeldTogether(prose(paragraphs), rows)).toBe(true);
    });

    it(`POSITIVE CONTROL: reading order alone fails the same predicate on ${what}`, () => {
      const paragraphs = blockOrder(pageOf(xhtml));
      expect(paragraphs).toHaveLength(2);
      expect(rowsHeldTogether(paragraphs, rows)).toBe(false);
    });
  }
});

/**
 * Two columns of prose must come out one whole paragraph at a time, however
 * their lines happen to line up. The last three fixtures are each defended by
 * ONE table rule alone, so removing that rule turns exactly its test red.
 */
describe("flowParagraphs — aligned prose is never read as a table", () => {
  it("newsletter: paragraphs ending on short aligned lines, above aligned headings, stay whole", () => {
    // What the first rule wrote: the two short last lines, then the headings,
    // as tabbed rows cut out of their paragraphs.
    const paragraphs = prose(flowParagraphs(pageOf(NEWSLETTER_BBOX)));
    expect(
      paragraphsReadWhole(paragraphs, [NEWSLETTER_LEFT, NEWSLETTER_RIGHT]),
    ).toBe(true);
    expect(paragraphs.every((p) => !p.includes("\t"))).toBe(true);
  });

  it("POSITIVE CONTROL: the newsletter as the first rule wrote it fails the predicate", () => {
    // Verbatim output of flow.ts at 2e76d92 on NEWSLETTER_BBOX.
    const shipped = [
      "Our team spent the last quarter rebuilding the upload flow from the ground up, and",
      "it went well.\tfeedback was great.",
      "Next steps\tOpen issues",
      "Customers noticed the faster uploads within days, the support queue shrank, and the",
      "We will ship the new editor in two phases and measure how people use each one.",
      "Search inside very large files is still slow and the fix needs a new kind of index.",
    ];
    expect(
      paragraphsReadWhole(shipped, [NEWSLETTER_LEFT, NEWSLETTER_RIGHT]),
    ).toBe(false);
  });

  it("rule 3 alone: two columns of capitalised one-line sentences have no column of values", () => {
    // No line here starts in lowercase, so rule 4 sees nothing; only the
    // absence of a short-valued column keeps these from being tabbed rows.
    const paragraphs = prose(flowParagraphs(pageOf(HIGHLIGHTS_BBOX)));
    expect(
      paragraphsReadWhole(paragraphs, [[HIGHLIGHTS_LEFT], [HIGHLIGHTS_RIGHT]]),
    ).toBe(true);
  });

  it("rule 4 alone: a paragraph beside a list of short names is running text, not a table", () => {
    // The list IS a column of short values (rule 3 passes); only the
    // paragraph's lowercase continuations say its lines are one sentence.
    const paragraphs = prose(flowParagraphs(pageOf(SIDEBAR_BBOX)));
    expect(
      paragraphsReadWhole(paragraphs, [[SIDEBAR_MAIN], [SIDEBAR_LIST]]),
    ).toBe(true);
  });

  it("rule 4, backwards: a run that starts at a paragraph's tail is rejected even when the paragraph is outside the run", () => {
    // The newsletter as poppler read it, with the right column's first two
    // lines and the closing paragraphs removed: the short last lines and the
    // headings are now a run of their own, bounded by one-cell bands, and
    // every cell in it is short. Only "it went well." following a wrapped
    // line of its own block says the run starts mid-sentence.
    const page = pageOf(NEWSLETTER_BBOX);
    const dropped = new Set<string>([
      ...NEWSLETTER_RIGHT[0].slice(0, 2),
      ...NEWSLETTER_LEFT[2],
      ...NEWSLETTER_RIGHT[2],
    ]);
    const cut: FlowPage = {
      ...page,
      blocks: page.blocks
        .map((b) => ({
          ...b,
          lines: b.lines.filter((l) => !dropped.has(lineText(l))),
        }))
        .filter((b) => b.lines.length > 0),
    };
    // Health check: the derivation removed exactly what it names.
    expect(cut.blocks.flatMap((b) => b.lines.map(lineText))).toEqual([
      ...NEWSLETTER_LEFT[0],
      NEWSLETTER_RIGHT[0][2],
      ...NEWSLETTER_LEFT[1],
      ...NEWSLETTER_RIGHT[1],
    ]);
    expect(prose(flowParagraphs(cut))).toEqual([
      NEWSLETTER_LEFT[0].join(" "),
      NEWSLETTER_RIGHT[0][2],
      NEWSLETTER_LEFT[1][0],
      NEWSLETTER_RIGHT[1][0],
    ]);
  });
});

describe("flowParagraphs — joining lines", () => {
  const block = (...lines: string[]) =>
    `<doc><page width="612" height="792"><flow><block>${lines
      .map(
        (text, i) =>
          `<line>${text
            .split(" ")
            .map(
              (w, j) =>
                `<word xMin="${50 + j * 40}" yMin="${100 + i * 14}" xMax="${50 + j * 40 + 30}" yMax="${110 + i * 14}">${w}</word>`,
            )
            .join("")}</line>`,
      )
      .join("")}</block></flow></page></doc>`;
  const one = (xhtml: string) =>
    prose(flowParagraphs(parseBboxFlow(xhtml).pages[0]!));

  it("joins a line-final hyphen to a lowercase continuation, keeping the hyphen", () => {
    expect(one(block("a well-", "known result"))).toEqual([
      "a well-known result",
    ]);
  });

  it("keeps the space when the next line starts a new word in capitals", () => {
    expect(one(block("see section 4 -", "Results"))).toEqual([
      "see section 4 - Results",
    ]);
  });

  it("drops a soft hyphen, which is only ever a line-break artefact", () => {
    expect(one(block("opera­", "ting"))).toEqual(["operating"]);
  });
});

describe("flowText", () => {
  it("returns every page, with its number", () => {
    const text = flowText(parseBboxFlow(TWO_COLUMN_BBOX));
    expect(text.pageCount).toBe(1);
    expect(text.pages[0]!.pageNumber).toBe(1);
  });
});
