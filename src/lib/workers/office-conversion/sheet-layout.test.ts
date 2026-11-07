import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHEET_LAYOUT,
  ONE_PAGE_PER_SHEET_OPTION,
  parseSheetLayout,
} from "./sheet-layout";
import { officeJobOptions } from "../office-conversion-client";
import { CALC_SINGLE_PAGE_SHEETS_TARGET, pdfConvertTarget } from "./native";

const bytes = new Uint8Array();

describe("Excel to PDF's one-page-per-sheet option (audit excel-to-pdf#1)", () => {
  it("what the panel sends is what the worker reads back", () => {
    const bag = officeJobOptions({
      tool: "excel-to-pdf",
      filename: "wide.xlsx",
      bytes,
      layout: { onePagePerSheet: true },
    });
    expect(bag).toEqual({ [ONE_PAGE_PER_SHEET_OPTION]: true });
    expect(parseSheetLayout(bag)).toEqual({
      ok: true,
      value: { onePagePerSheet: true },
    });
    expect(pdfConvertTarget({ onePagePerSheet: true })).toBe(
      CALC_SINGLE_PAGE_SHEETS_TARGET,
    );
  });

  it("CONTROL: unticked, and on the other Office tools, the bag stays empty", () => {
    expect(
      officeJobOptions({
        tool: "excel-to-pdf",
        filename: "a.xlsx",
        bytes,
        layout: { onePagePerSheet: false },
      }),
    ).toEqual({});
    for (const tool of ["word-to-pdf", "powerpoint-to-pdf"] as const)
      expect(
        officeJobOptions({
          tool,
          filename: "a",
          bytes,
          layout: { onePagePerSheet: true },
        }),
      ).toEqual({});
    expect(parseSheetLayout({})).toEqual({
      ok: true,
      value: DEFAULT_SHEET_LAYOUT,
    });
    expect(pdfConvertTarget(DEFAULT_SHEET_LAYOUT)).toBe("pdf");
  });

  it("refuses a value that is not a boolean instead of coercing it", () => {
    for (const raw of ["false", 1, null, {}])
      expect(parseSheetLayout({ [ONE_PAGE_PER_SHEET_OPTION]: raw }).ok).toBe(
        false,
      );
  });
});
