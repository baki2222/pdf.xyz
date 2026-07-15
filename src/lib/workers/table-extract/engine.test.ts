import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  buildTablesZip,
  detectTablesOnPage,
  EXTRACT_TABLES_ENGINE,
  runTableExtract,
  toCsv,
  type PdfLayout,
  type PdfLayoutPage,
  type PositionedTextItem,
} from "./engine";

/** A positioned text item with sane defaults for width/height. */
function item(text: string, x: number, y: number, width = text.length * 5, height = 10): PositionedTextItem {
  return { text, x, y, width, height };
}

/** A 2-column, 3-row table laid out in PDF points (y grows upward). */
function tablePage(pageNumber = 1): PdfLayoutPage {
  return {
    pageNumber,
    width: 400,
    height: 300,
    items: [
      item("Name", 50, 100),
      item("Age", 200, 100),
      item("Alice", 50, 80),
      item("30", 200, 80),
      item("Bob", 50, 60),
      item("25", 200, 60),
    ],
  };
}

/** A prose page: one text item per line, never tabular. */
function prosePage(pageNumber = 1): PdfLayoutPage {
  return {
    pageNumber,
    width: 400,
    height: 300,
    items: [
      item("This is a single paragraph of running text.", 50, 100),
      item("It has no columns whatsoever, only prose.", 50, 85),
    ],
  };
}

function layout(pages: PdfLayoutPage[]): PdfLayout {
  return { pageCount: pages.length, pages };
}

describe("detectTablesOnPage", () => {
  it("recovers a 2-column, 3-row grid from aligned items", () => {
    const tables = detectTablesOnPage(tablePage());
    expect(tables).toHaveLength(1);
    expect(tables[0]!.pageNumber).toBe(1);
    expect(tables[0]!.rows).toEqual([
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  it("orders rows top-to-bottom regardless of item order", () => {
    const shuffled: PdfLayoutPage = {
      ...tablePage(),
      items: [
        item("25", 200, 60),
        item("Name", 50, 100),
        item("30", 200, 80),
        item("Bob", 50, 60),
        item("Age", 200, 100),
        item("Alice", 50, 80),
      ],
    };
    expect(detectTablesOnPage(shuffled)[0]!.rows).toEqual([
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  it("finds no tables in prose", () => {
    expect(detectTablesOnPage(prosePage())).toEqual([]);
  });

  it("ignores a single-column list (needs >= 2 columns)", () => {
    const list: PdfLayoutPage = {
      pageNumber: 1,
      width: 400,
      height: 300,
      items: [item("first", 50, 100), item("second", 50, 85), item("third", 50, 70)],
    };
    expect(detectTablesOnPage(list)).toEqual([]);
  });
});

describe("toCsv", () => {
  it("emits RFC-4180 rows with CRLF endings", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("quotes cells with commas, quotes, or newlines and doubles inner quotes", () => {
    expect(toCsv([["b,c", 'd"e'], ["f\ng", "h"]])).toBe('"b,c","d""e"\r\n"f\ng",h');
  });
});

describe("buildTablesZip", () => {
  it("packages one CSV per table plus a combined XLSX", async () => {
    const zipBytes = await buildTablesZip([
      { pageNumber: 1, rows: [["Name", "Age"], ["Alice", "30"]] },
      { pageNumber: 2, rows: [["City"], ["Paris"]] },
    ]);
    const zip = await JSZip.loadAsync(zipBytes);
    expect(zip.file("table-1.csv")).not.toBeNull();
    expect(zip.file("table-2.csv")).not.toBeNull();
    expect(zip.file("tables.xlsx")).not.toBeNull();
    expect(await zip.file("table-1.csv")!.async("string")).toBe("Name,Age\r\nAlice,30");
  });
});

describe("runTableExtract", () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

  it("fails honestly without a layout extractor", async () => {
    const run = await runTableExtract(PDF, {});
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("fails as no_text when the PDF has no selectable text", async () => {
    const extractLayout = vi.fn(async () => layout([{ pageNumber: 1, width: 400, height: 300, items: [] }]));
    const run = await runTableExtract(PDF, { extractLayout });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("no_text");
  });

  it("fails as no_tables when text has no tabular structure", async () => {
    const extractLayout = vi.fn(async () => layout([prosePage()]));
    const run = await runTableExtract(PDF, { extractLayout });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("no_tables");
  });

  it("rejects input over the size limit before extracting", async () => {
    const extractLayout = vi.fn(async () => layout([tablePage()]));
    const run = await runTableExtract(new Uint8Array(50), { extractLayout, limits: { maxInputBytes: 10 } });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
    expect(extractLayout).not.toHaveBeenCalled();
  });

  it("produces a ZIP artifact with real detected tables", async () => {
    const extractLayout = vi.fn(async () => layout([tablePage()]));
    const run = await runTableExtract(PDF, { extractLayout });
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.filenameExt).toBe("zip");
      expect(run.contentType).toBe("application/zip");
      expect(run.meta).toMatchObject({ engine: EXTRACT_TABLES_ENGINE, tool: "extract-tables", tableCount: 1, pageCount: 1 });
      const zip = await JSZip.loadAsync(run.output);
      expect(await zip.file("table-1.csv")!.async("string")).toBe("Name,Age\r\nAlice,30\r\nBob,25");
    }
  });

  it("fails honestly if the extractor throws", async () => {
    const extractLayout = vi.fn(async () => {
      throw new Error("pdfjs blew up");
    });
    const run = await runTableExtract(PDF, { extractLayout });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});
