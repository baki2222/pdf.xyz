import { describe, expect, it } from "vitest";
import {
  LITTLE_TEXT_CHARS,
  MAX_LISTED_PAGES,
  measureOfficeExportPages,
  type OfficeExportResultMeta,
} from "./office-export-results";
import { sanitizeJobResults } from "./results";

describe("measureOfficeExportPages", () => {
  it("splits pages into none / little / enough text", () => {
    const enough = "x".repeat(LITTLE_TEXT_CHARS);
    const little = "x".repeat(LITTLE_TEXT_CHARS - 1);
    expect(
      measureOfficeExportPages(4, [
        { pageNumber: 1, text: enough },
        { pageNumber: 2, text: little },
        { pageNumber: 4, text: "  \n\t " },
      ]),
    ).toEqual({
      pageCount: 4,
      textPageCount: 2,
      pagesWithoutText: [3, 4],
      littleTextPageCount: 1,
      pagesWithLittleText: [2],
    });
  });

  it("does not let layout padding make a stamp look like a page of text", () => {
    const padded = `RECEIVED${" ".repeat(80)}BATES 000123`;
    expect(
      measureOfficeExportPages(1, [{ pageNumber: 1, text: padded }])
        .littleTextPageCount,
    ).toBe(1);
  });

  it("keeps the counts exact when the lists are capped", () => {
    const meta = measureOfficeExportPages(MAX_LISTED_PAGES + 25, []);
    expect(meta.textPageCount).toBe(0);
    expect(meta.pagesWithoutText).toHaveLength(MAX_LISTED_PAGES);
    expect(meta.pageCount - meta.textPageCount).toBe(MAX_LISTED_PAGES + 25);
  });
});

describe("sanitizeJobResults — the officeExport block", () => {
  it("carries a real block through to the job record", () => {
    const block = measureOfficeExportPages(3, [
      { pageNumber: 1, text: "a sentence that is comfortably long enough" },
    ]);
    expect(sanitizeJobResults({ officeExport: block })?.officeExport).toEqual(
      block,
    );
  });

  it("re-bounds a hostile block: counts clamped, impossible pages dropped", () => {
    const hostile = {
      pageCount: 3.7,
      textPageCount: 99,
      pagesWithoutText: [0, 2, 2, 7, -1, 1.5, "3"],
      littleTextPageCount: -4,
      pagesWithLittleText: "nope",
    } as unknown as OfficeExportResultMeta;
    expect(sanitizeJobResults({ officeExport: hostile })?.officeExport).toEqual(
      {
        pageCount: 3,
        textPageCount: 3,
        pagesWithoutText: [2],
        littleTextPageCount: 0,
        pagesWithLittleText: [],
      },
    );
  });

  it("drops a block that did not come from the contract", () => {
    expect(
      sanitizeJobResults({
        officeExport: { pagesWithoutText: [1] } as never,
      }),
    ).toBeUndefined();
  });
});

/*
 * 2026-10-11: PDF to PowerPoint rebuilds a PDF its page reader cannot read,
 * the way Repair PDF does, before converting it — and says so. The flag
 * travels only as `true`: anything else is no claim at all, and must not
 * turn into one on the way to the panel.
 */
describe("sanitizeJobResults — a PDF rebuilt before conversion", () => {
  const base = measureOfficeExportPages(1, [
    { pageNumber: 1, text: "a sentence that is comfortably long enough" },
  ]);

  it("carries `repairedBeforeConversion: true` to the job record", () => {
    expect(
      sanitizeJobResults({
        officeExport: { ...base, repairedBeforeConversion: true },
      })?.officeExport?.repairedBeforeConversion,
    ).toBe(true);
  });

  it("drops any other value, and adds nothing where the worker said nothing", () => {
    for (const value of [false, 1, "true", null])
      expect(
        sanitizeJobResults({
          officeExport: {
            ...base,
            repairedBeforeConversion: value,
          } as unknown as OfficeExportResultMeta,
        })?.officeExport,
        String(value),
      ).not.toHaveProperty("repairedBeforeConversion");
    expect(
      sanitizeJobResults({ officeExport: base })?.officeExport,
    ).not.toHaveProperty("repairedBeforeConversion");
  });
});
