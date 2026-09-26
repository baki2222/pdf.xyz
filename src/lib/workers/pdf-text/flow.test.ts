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
  LEFT_COLUMN,
  RIGHT_COLUMN,
  TABLE_ROWS,
} from "@/tests/pdf-office-fixtures";
import {
  TABLE_BBOX,
  TWO_COLUMN_BBOX,
  TWO_COLUMN_LAYOUT,
} from "@/tests/poppler-samples";
import { parseLayoutText, parseBboxFlow } from "./parse";
import { flowParagraphs, flowText, type FlowParagraph } from "./flow";

const LEFT = LEFT_COLUMN.join(" ");
const RIGHT = RIGHT_COLUMN.join(" ");

const prose = (paragraphs: FlowParagraph[]) =>
  paragraphs.map((p) => p.join("\t"));

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
    // The discriminator is cell length, not alignment: both samples share
    // baselines across columns. Swapping them must swap the verdicts.
    const table = flowParagraphs(parseBboxFlow(TABLE_BBOX).pages[0]!);
    const two = flowParagraphs(parseBboxFlow(TWO_COLUMN_BBOX).pages[0]!);
    expect(table.every((p) => p.length > 1)).toBe(true);
    expect(two.every((p) => p.length === 1)).toBe(true);
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
