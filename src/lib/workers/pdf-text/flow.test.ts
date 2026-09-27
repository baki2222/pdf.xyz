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
  HEADINGS_LEFT,
  HEADINGS_RIGHT,
  HIGHLIGHTS_LEFT,
  HIGHLIGHTS_RIGHT,
  LEFT_COLUMN,
  LETTER,
  LETTER_JUSTIFIED,
  LISTS_LEFT,
  LISTS_RIGHT,
  NEWSLETTER_LEFT,
  NEWSLETTER_RIGHT,
  paragraphsReadWhole,
  readColumnByColumn,
  RIGHT_COLUMN,
  rowsHeldTogether,
  SIDEBAR_LIST,
  SIDEBAR_MAIN,
  SKU_ROWS,
  STATEMENT_ROWS,
  TABLE_ROWS,
} from "@/tests/pdf-office-fixtures";
import {
  HEADINGS_BBOX,
  HIGHLIGHTS_BBOX,
  LETTER_BBOX,
  LISTS_BBOX,
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
import {
  flowParagraphs,
  flowText,
  LONG_CELL_WORDS,
  type FlowParagraph,
} from "./flow";

const LEFT = LEFT_COLUMN.join(" ");
const RIGHT = RIGHT_COLUMN.join(" ");

const prose = (paragraphs: FlowParagraph[]) =>
  paragraphs.map((p) => p.join("\t"));

const lineText = (line: FlowLine) => line.words.map((w) => w.text).join(" ");

/** poppler's reading order with no table rule: one paragraph per block. */
const blockOrder = (page: FlowPage) =>
  page.blocks.map((b) => b.lines.map(lineText).join(" "));

const pageOf = (xhtml: string) => parseBboxFlow(xhtml).pages[0]!;

/** `page` with the named printed lines removed, and any block left empty. */
const cutPage = (page: FlowPage, drop: readonly string[]): FlowPage => {
  const dropped = new Set(drop);
  return {
    ...page,
    blocks: page.blocks
      .map((b) => ({
        ...b,
        lines: b.lines.filter((l) => !dropped.has(lineText(l))),
      }))
      .filter((b) => b.lines.length > 0),
  };
};

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

  it("rule 5, top: a run that starts at a paragraph's lowercase tail is cut back to where the paragraph ends", () => {
    // The newsletter as poppler read it, with the right column's first two
    // lines and the closing paragraphs removed: the short last lines and the
    // headings are now a run of their own, bounded by one-cell bands, and
    // every cell in it is short. "it went well." has the rest of its
    // paragraph above it, outside the run, so that band is a paragraph's
    // tail and leaves the run — one band is left, and one band is no table.
    //
    // HISTORY: this was "rule 4, backwards" — a lowercase line after a long
    // one — until the capitalised tail below showed the same shape walking
    // past it. It also expected poppler's own order, the right column's tail
    // BEFORE the left column's heading; that order was the defect
    // `readColumnByColumn` now pins, so it is inverted, not deleted.
    const cut = cutPage(pageOf(NEWSLETTER_BBOX), [
      ...NEWSLETTER_RIGHT[0].slice(0, 2),
      ...NEWSLETTER_LEFT[2],
      ...NEWSLETTER_RIGHT[2],
    ]);
    // Health check: the derivation removed exactly what it names.
    expect(cut.blocks.flatMap((b) => b.lines.map(lineText))).toEqual([
      ...NEWSLETTER_LEFT[0],
      NEWSLETTER_RIGHT[0][2],
      ...NEWSLETTER_LEFT[1],
      ...NEWSLETTER_RIGHT[1],
    ]);
    expect(prose(flowParagraphs(cut))).toEqual([
      NEWSLETTER_LEFT[0].join(" "),
      NEWSLETTER_LEFT[1][0],
      NEWSLETTER_RIGHT[0][2],
      NEWSLETTER_RIGHT[1][0],
    ]);
  });

  it("rule 5 alone, top: a CAPITALISED paragraph tail is cut back too", () => {
    // Real poppler geometry (HEADINGS_BBOX), cut the same way. "Costs fell."
    // starts with a capital, so no line here continues a sentence and rule 4
    // is blind; every cell is short and the left edges line up, so rule 3
    // passes. At 9c73735 this wrote "Costs fell.\tAlso tariffs." and
    // "Outlook\tSummary". Only the long lines of its own block, above the run,
    // say "Costs fell." ends a paragraph.
    const cut = cutPage(pageOf(HEADINGS_BBOX), [
      ...HEADINGS_RIGHT[0].slice(0, 2),
      ...HEADINGS_LEFT[2],
      ...HEADINGS_RIGHT[2],
    ]);
    expect(cut.blocks.flatMap((b) => b.lines.map(lineText))).toEqual([
      ...HEADINGS_LEFT[0],
      HEADINGS_RIGHT[0][2],
      ...HEADINGS_LEFT[1],
      ...HEADINGS_RIGHT[1],
    ]);
    // Health check: nothing in the run starts in lowercase, and the tail's
    // block has a line of LONG_CELL_WORDS+ words outside it.
    expect(/^\p{Ll}/u.test(HEADINGS_LEFT[0][2])).toBe(false);
    expect(HEADINGS_LEFT[0][1].split(" ").length).toBeGreaterThanOrEqual(
      LONG_CELL_WORDS,
    );
    expect(prose(flowParagraphs(cut))).toEqual([
      HEADINGS_LEFT[0].join(" "),
      HEADINGS_LEFT[1][0],
      HEADINGS_RIGHT[0][2],
      HEADINGS_RIGHT[1][0],
    ]);
  });

  it("rule 5 alone, bottom: a run that ends on the first line of a paragraph is cut back too", () => {
    // Real lines from HEADINGS_BBOX, regrouped the way poppler groups a column
    // set in ONE font: "Costs fell.", "Outlook" and the paragraph under it in
    // one block. The run is the two short aligned bands; "Outlook" has a long
    // line after it in its block, outside the run.
    const page = pageOf(HEADINGS_BBOX);
    const byText = new Map(
      page.blocks.flatMap((b) => b.lines).map((l) => [lineText(l), l]),
    );
    const lines = (texts: readonly string[]) =>
      texts.map((t) => {
        const line = byText.get(t);
        if (!line) throw new Error(`no line ${t}`);
        return line;
      });
    const regrouped: FlowPage = {
      ...page,
      blocks: [
        {
          flow: 0,
          lines: lines([
            HEADINGS_LEFT[0][2],
            HEADINGS_LEFT[1][0],
            ...HEADINGS_LEFT[2],
          ]),
        },
        { flow: 1, lines: lines([HEADINGS_RIGHT[0][2]]) },
        { flow: 2, lines: lines([HEADINGS_RIGHT[1][0]]) },
      ],
    };
    expect(prose(flowParagraphs(regrouped))).toEqual([
      HEADINGS_LEFT[0][2],
      HEADINGS_LEFT[1][0],
      HEADINGS_LEFT[2].join(" "),
      HEADINGS_RIGHT[0][2],
      HEADINGS_RIGHT[1][0],
    ]);
  });
});

/**
 * The strict property: one output paragraph per source paragraph, the left
 * column's before the right's — over the verbatim poppler output of pages
 * whose every row lines up across the gutter.
 */
describe("flowParagraphs — two columns come out column by column", () => {
  it("short capitalised last lines above aligned headings: each paragraph whole, the left column first", () => {
    const paragraphs = prose(flowParagraphs(pageOf(HEADINGS_BBOX)));
    expect(
      readColumnByColumn(paragraphs, [HEADINGS_LEFT, HEADINGS_RIGHT]),
    ).toBe(true);
  });

  it("two bulleted lists under headings: one paragraph per item, never tabbed together", () => {
    // Health check: every line is short and each column's lines share their
    // left edge, so neither rule 3's length test nor the alignment test can
    // tell these from a table's column of values. Only the list markers can.
    const page = pageOf(LISTS_BBOX);
    const lines = page.blocks.flatMap((b) => b.lines);
    expect(lines).toHaveLength([...LISTS_LEFT, ...LISTS_RIGHT].length);
    expect(lines.every((l) => l.words.length < LONG_CELL_WORDS)).toBe(true);
    for (const x of new Set(lines.map((l) => l.xMin)))
      expect(lines.filter((l) => l.xMin === x)).toHaveLength(LISTS_LEFT.length);
    expect(
      readColumnByColumn(prose(flowParagraphs(page)), [
        LISTS_LEFT,
        LISTS_RIGHT,
      ]),
    ).toBe(true);
  });

  it("POSITIVE CONTROL: what PDF to Word wrote for these pages fails the same predicate", () => {
    // Verbatim flow.ts output on HEADINGS_BBOX at f508646 (tabbed rows) and
    // at 9c73735 (whole paragraphs, but the right column's heading before the
    // left column's body), and on LISTS_BBOX at 9c73735 (items interleaved).
    const headingsAtF508646 = [
      "Sales rose in every region this year and the new stores opened on time and on budget.",
      "Costs fell.\tAlso tariffs.",
      "Outlook\tSummary",
      "Prices for raw materials stayed high all year and cut margins in the second half again.",
      "We expect growth to continue next year as the second factory comes online in spring.",
      "The board will review the dividend in March once the audited accounts are complete.",
    ];
    const headingsAt9c73735 = [
      "Sales rose in every region this year and the new stores opened on time and on budget. Costs fell.",
      "Prices for raw materials stayed high all year and cut margins in the second half again. Also tariffs.",
      "Outlook",
      "Summary",
      "We expect growth to continue next year as the second factory comes online in spring.",
      "The board will review the dividend in March once the audited accounts are complete.",
    ];
    const listsAt9c73735 = [
      "Strengths\tRisks",
      "• Strong cash\t- Currency swings",
      "• Low debt\t- Supplier delays",
      "• Loyal customers\t- New rivals",
    ];
    for (const shipped of [headingsAtF508646, headingsAt9c73735])
      expect(readColumnByColumn(shipped, [HEADINGS_LEFT, HEADINGS_RIGHT])).toBe(
        false,
      );
    expect(readColumnByColumn(listsAt9c73735, [LISTS_LEFT, LISTS_RIGHT])).toBe(
      false,
    );
    // …and the predicate is not blind: the right answer passes it.
    expect(
      readColumnByColumn(
        [...HEADINGS_LEFT, ...HEADINGS_RIGHT].map((p) => p.join(" ")),
        [HEADINGS_LEFT, HEADINGS_RIGHT],
      ),
    ).toBe(true);
  });
});

describe("flowParagraphs — a table's columns line up", () => {
  /** Two rows of two short cells; row 2's cells `shift` points to the right. */
  const twoRows = (shift: number) => {
    const word = (text: string, x: number, y: number) =>
      `<flow><block><line><word xMin="${x}" yMin="${y}" xMax="${x + 40}" yMax="${y + 10}">${text}</word></line></block></flow>`;
    return `<doc><page width="612" height="792">${[
      word("North", 60, 100),
      word("East", 300, 100),
      word("South", 60 + shift, 114),
      word("West", 300 + shift, 114),
    ].join("")}</page></doc>`;
  };

  it("reads short words that overlap but share no edge in reading order, not as rows", () => {
    // Labels scattered over a diagram: each lower word overlaps the one above
    // it, so they chain into "columns", but no edge is shared.
    expect(prose(flowParagraphs(pageOf(twoRows(15))))).toEqual([
      "North",
      "South",
      "East",
      "West",
    ]);
  });

  it("POSITIVE CONTROL: the same words on shared edges are a table", () => {
    expect(prose(flowParagraphs(pageOf(twoRows(0))))).toEqual([
      "North\tEast",
      "South\tWest",
    ]);
  });
});

/**
 * One block, one font, one size, one pitch: poppler hands over the whole
 * letter as a single block (checked below), so every paragraph break in the
 * DOCX is decided from the lines alone. 9c73735 joined every line of a block
 * with a space, and wrote this letter as ONE paragraph.
 */
describe("flowParagraphs — a block's lines become its paragraphs", () => {
  it("health check: poppler reads the letter as one block of every printed line", () => {
    const page = pageOf(LETTER_BBOX);
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0]!.lines.map(lineText)).toEqual(LETTER.flat());
  });

  it("writes a letter's salutation, paragraph, heading, list items and closing as separate paragraphs", () => {
    expect(prose(flowParagraphs(pageOf(LETTER_BBOX)))).toEqual(
      LETTER.map((p) => p.join(" ")),
    );
  });

  it("POSITIVE CONTROL: a justified paragraph with a full line ending in a full stop stays ONE paragraph", () => {
    // Health check that the letter holds the case: inside a justified
    // paragraph, a line that ends a sentence, is set to the full measure, and
    // is followed by a capital. A rule that broke on the full stop alone would
    // split it.
    const page = pageOf(LETTER_BBOX);
    const width = (text: string) => {
      const line = page.blocks[0]!.lines.find((l) => lineText(l) === text)!;
      return line.xMax - line.xMin;
    };
    const widest = Math.max(...LETTER.flat().map(width));
    const inner = [...LETTER_JUSTIFIED].flatMap((p) =>
      LETTER[p]!.slice(0, -1).filter(
        (line, i) => /[.!?]$/.test(line) && /^\p{Lu}/u.test(LETTER[p]![i + 1]!),
      ),
    );
    expect(inner.length).toBeGreaterThan(0);
    for (const line of inner)
      expect(width(line)).toBeGreaterThan(0.95 * widest);
    const paragraphs = prose(flowParagraphs(page));
    for (const p of LETTER_JUSTIFIED)
      expect(paragraphs).toContain(LETTER[p]!.join(" "));
  });

  it("starts a paragraph after a gap wider than the block's line spacing, and not without one", () => {
    // Full-measure lines, each starting with a capital, so nothing but the
    // gap can separate them.
    const block = (gapAfter: number) =>
      `<doc><page width="612" height="792"><flow><block>${[
        "Alpha beta gamma delta epsilon zeta eta.",
        "Theta iota kappa lambda mu nu xi omicron.",
        "Pi rho sigma tau upsilon phi chi psi.",
        "Omega alpha beta gamma delta epsilon zeta.",
      ]
        .map((text, i) => {
          const y = 100 + i * 14 + (i > gapAfter ? 20 : 0);
          return `<line>${text
            .split(" ")
            .map(
              (w, j) =>
                `<word xMin="${50 + j * 60}" yMin="${y}" xMax="${50 + j * 60 + 50}" yMax="${y + 10}">${w}</word>`,
            )
            .join("")}</line>`;
        })
        .join("")}</block></flow></page></doc>`;
    const split = prose(flowParagraphs(pageOf(block(1))));
    expect(split).toHaveLength(2);
    expect(split[1]!.startsWith("Pi rho")).toBe(true);
    expect(prose(flowParagraphs(pageOf(block(99))))).toHaveLength(1);
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
    expect(one(block("opera\u00AD", "ting"))).toEqual(["operating"]);
  });
});

describe("flowText", () => {
  it("returns every page, with its number", () => {
    const text = flowText(parseBboxFlow(TWO_COLUMN_BBOX));
    expect(text.pageCount).toBe(1);
    expect(text.pages[0]!.pageNumber).toBe(1);
  });
});
