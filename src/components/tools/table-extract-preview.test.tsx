// @vitest-environment jsdom
/**
 * Extract Tables' result preview (competitor audit #22, 2026-11-17), drawn
 * from ZIPs the REAL engine writes. The panel tests drive it through a whole
 * job; this file reaches the shapes a job from the test layout cannot make:
 * an empty header cell, non-Latin text, a wide table, and more tables than
 * the preview shows.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { buildTablesZip } from "@/lib/workers/table-extract/engine";
import {
  MAX_PREVIEW_TABLES,
  TABLE_PREVIEW_ROWS,
} from "@/lib/jobs/extract-tables-options";
import TableExtractPreview, {
  noTablesPreviewSentence,
  previewSelectionNote,
} from "./table-extract-preview";

/** Built from code points (house rule). */
const cp = (...points: number[]) => String.fromCodePoint(...points);
const BN_NAME = cp(0x09a8, 0x09be, 0x09ae);
const BN_CITY = cp(0x09a2, 0x09be, 0x0995, 0x09be);
const CJK = cp(0x8868, 0x683c);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TableExtractPreview", () => {
  it("draws text cells: an empty header named for a reader, Bengali and CJK as written, a wide table whole", async () => {
    const zip = await buildTablesZip([
      {
        pageNumber: 2,
        rows: [
          [BN_NAME, CJK, ""],
          [BN_CITY, "", "<b>7</b>"],
        ],
      },
      {
        pageNumber: 3,
        rows: [Array.from({ length: 28 }, (_, c) => `H${c}`)],
      },
    ]);
    render(<TableExtractPreview zip={zip} ocrRan={false} />);
    const first = await screen.findByRole("table", {
      name: "Table 1, page 2: all 2 rows",
    });
    const heads = within(first).getAllByRole("columnheader");
    expect(heads.map((h) => h.textContent)).toEqual([BN_NAME, CJK, "Column 3"]);
    // The empty one is named only for a screen reader.
    expect(heads[2]!.querySelector(".sr-only")).not.toBeNull();
    const cells = within(first).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual([BN_CITY, "", "<b>7</b>"]);
    // Text, never markup.
    expect(first.querySelector("b")).toBeNull();
    const wide = screen.getByRole("table", {
      name: "Table 2, page 3: 1 row",
    });
    expect(within(wide).getAllByRole("columnheader")).toHaveLength(28);
    // Its box is focusable and named, so a keyboard can scroll it.
    const region = screen.getByRole("region", {
      name: "Table 2, page 3: 1 row",
    });
    expect(region.tabIndex).toBe(0);
    expect(region.contains(wide)).toBe(true);
  });

  it("past the cap: the sentence says which tables are shown, and the count matches", async () => {
    const pages = [1, 1, 2, 2, 3, 3, 4, 5, 6, 7];
    const zip = await buildTablesZip(
      pages.map((pageNumber, i) => ({
        pageNumber,
        rows: Array.from({ length: TABLE_PREVIEW_ROWS + 2 }, (_, r) => [
          `t${i}r${r}`,
        ]),
      })),
    );
    render(<TableExtractPreview zip={zip} ocrRan={false} />);
    expect(
      await screen.findByText(
        `There are ${pages.length} tables, so this shows the first table on each of the first ${MAX_PREVIEW_TABLES} pages that have one. Every table is in the ZIP.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(MAX_PREVIEW_TABLES);
    expect(
      screen.getByText(
        `Table 1, page 1: first ${TABLE_PREVIEW_ROWS} of ${TABLE_PREVIEW_ROWS + 2} rows`,
      ),
    ).toBeInTheDocument();
  });

  it("the selection sentences, each shape", () => {
    const base = { combined: false, tables: [], pagesWithTables: 0 };
    const shown = (n: number) => Array.from({ length: n }, () => ({}) as never);
    expect(
      previewSelectionNote({
        ...base,
        tables: shown(3),
        tableFiles: 3,
        perPage: false,
      }),
    ).toBeNull();
    expect(
      previewSelectionNote({
        ...base,
        tables: shown(3),
        tableFiles: 8,
        perPage: true,
        pagesWithTables: 3,
      }),
    ).toBe(
      "There are 8 tables, so this shows the first table on each page. Every table is in the ZIP.",
    );
    expect(
      previewSelectionNote({
        ...base,
        tables: shown(MAX_PREVIEW_TABLES),
        tableFiles: 9,
        perPage: false,
      }),
    ).toBe(
      `There are 9 tables; this shows the first ${MAX_PREVIEW_TABLES}. Every table is in the ZIP.`,
    );
  });

  it("no table: after OCR, the OCR switch is not offered again", async () => {
    render(<TableExtractPreview zip={await buildTablesZip([])} ocrRan />);
    expect(
      await screen.findByText(noTablesPreviewSentence(true)),
    ).toBeInTheDocument();
    expect(noTablesPreviewSentence(true)).not.toMatch(/OCR/);
    expect(noTablesPreviewSentence(false)).toMatch(/OCR/);
  });
});
