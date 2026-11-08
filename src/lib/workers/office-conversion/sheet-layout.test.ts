import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHEET_LAYOUT,
  FIT_COLUMNS_TO_WIDTH_OPTION,
  ONE_PAGE_PER_SHEET_OPTION,
  ORIENTATION_OPTION,
  SHEET_ORIENTATIONS,
  acceptsPageSetup,
  parseSheetLayout,
  type SheetLayout,
} from "./sheet-layout";
import { officeJobOptions } from "../office-conversion-client";
import { CALC_SINGLE_PAGE_SHEETS_TARGET, pdfConvertTarget } from "./native";

const bytes = new Uint8Array();
const layout = (over: Partial<SheetLayout>): SheetLayout => ({
  ...DEFAULT_SHEET_LAYOUT,
  ...over,
});

describe("Excel to PDF's one-page-per-sheet option (audit excel-to-pdf#1)", () => {
  it("what the panel sends is what the worker reads back", () => {
    const bag = officeJobOptions({
      tool: "excel-to-pdf",
      filename: "wide.xlsx",
      bytes,
      layout: layout({ onePagePerSheet: true }),
    });
    expect(bag).toEqual({ [ONE_PAGE_PER_SHEET_OPTION]: true });
    expect(parseSheetLayout(bag)).toEqual({
      ok: true,
      value: layout({ onePagePerSheet: true }),
    });
    expect(pdfConvertTarget(layout({ onePagePerSheet: true }))).toBe(
      CALC_SINGLE_PAGE_SHEETS_TARGET,
    );
  });

  it("CONTROL: unticked, and on the other Office tools, the bag stays empty", () => {
    expect(
      officeJobOptions({
        tool: "excel-to-pdf",
        filename: "a.xlsx",
        bytes,
        layout: DEFAULT_SHEET_LAYOUT,
      }),
    ).toEqual({});
    for (const tool of ["word-to-pdf", "powerpoint-to-pdf"] as const)
      expect(
        officeJobOptions({
          tool,
          filename: "a.xlsx",
          bytes,
          layout: layout({
            onePagePerSheet: true,
            orientation: "landscape",
            fitColumnsToWidth: true,
          }),
        }),
      ).toEqual({});
    expect(parseSheetLayout({})).toEqual({
      ok: true,
      value: DEFAULT_SHEET_LAYOUT,
    });
    expect(pdfConvertTarget(DEFAULT_SHEET_LAYOUT)).toBe("pdf");
  });

  it("refuses a value that is not a boolean instead of coercing it", () => {
    for (const raw of ["false", 1, null, {}]) {
      expect(parseSheetLayout({ [ONE_PAGE_PER_SHEET_OPTION]: raw }).ok).toBe(
        false,
      );
      expect(parseSheetLayout({ [FIT_COLUMNS_TO_WIDTH_OPTION]: raw }).ok).toBe(
        false,
      );
    }
  });
});

describe("Excel to PDF's orientation and fit-to-width (review 2026-11-08)", () => {
  it("every orientation the select offers round-trips, with fit, for an .xlsx", () => {
    for (const { value } of SHEET_ORIENTATIONS)
      for (const fit of [false, true]) {
        const chosen = layout({ orientation: value, fitColumnsToWidth: fit });
        const bag = officeJobOptions({
          tool: "excel-to-pdf",
          filename: "Budget.XLSX",
          bytes,
          layout: chosen,
        });
        expect(parseSheetLayout(bag)).toEqual({ ok: true, value: chosen });
      }
    expect(
      officeJobOptions({
        tool: "excel-to-pdf",
        filename: "b.xlsx",
        bytes,
        layout: layout({ orientation: "landscape", fitColumnsToWidth: true }),
      }),
    ).toEqual({
      [ORIENTATION_OPTION]: "landscape",
      [FIT_COLUMNS_TO_WIDTH_OPTION]: true,
    });
  });

  it("sends neither for a file whose page setup cannot be rewritten", () => {
    for (const filename of ["a.xls", "a.ods", "a.csv"]) {
      expect(acceptsPageSetup(filename)).toBe(false);
      expect(
        officeJobOptions({
          tool: "excel-to-pdf",
          filename,
          bytes,
          layout: layout({ orientation: "portrait", fitColumnsToWidth: true }),
        }),
      ).toEqual({});
    }
  });

  it("one page per sheet wins in the panel, and the worker refuses the mix", () => {
    expect(
      officeJobOptions({
        tool: "excel-to-pdf",
        filename: "a.xlsx",
        bytes,
        layout: layout({
          onePagePerSheet: true,
          orientation: "landscape",
          fitColumnsToWidth: true,
        }),
      }),
    ).toEqual({ [ONE_PAGE_PER_SHEET_OPTION]: true });
    expect(
      parseSheetLayout({
        [ONE_PAGE_PER_SHEET_OPTION]: true,
        [ORIENTATION_OPTION]: "landscape",
      }).ok,
    ).toBe(false);
  });

  it("refuses an orientation it does not offer", () => {
    for (const raw of ["auto", "Landscape", 90, null])
      expect(parseSheetLayout({ [ORIENTATION_OPTION]: raw }).ok).toBe(false);
  });
});
