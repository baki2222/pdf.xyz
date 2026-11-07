/**
 * AI Data Extraction's CSV (audit ai-extract#3): extraction.json, as the REAL
 * engine writes it, read back and laid out as rows.
 *
 * The packages come from `runAiExtract` with a fixed provider, not from a
 * hand-built ZIP, so the chain under test is worker package -> CSV; a
 * hand-built ZIP would certify an entry name and a shape the worker does not
 * write.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { ExtractOptions } from "@/lib/jobs/ai-extract";
import { runAiExtract } from "./ai-extract/engine";
import { CSV_BOM } from "./ooxml/csv";
import {
  AI_EXTRACT_CSV_SHAPE,
  CSV_LIST_SEPARATOR,
  extractionCsv,
  extractionCsvName,
  extractionRows,
  readExtractionCsv,
} from "./ai-extract-package";

async function packageFor(options: ExtractOptions, reply: unknown) {
  const text = "Invoice INV-7. Total 120.50. Items: Widget, Gadget.";
  const extracted: ExtractedPdfText = {
    pageCount: 1,
    pages: [],
    text,
    characterCount: text.length,
    hasText: true,
  };
  const run = await runAiExtract(new Uint8Array([1, 2, 3]), options, {
    extract: async () => extracted,
    provider: {
      id: "anthropic",
      model: "claude-sonnet-5",
      async complete() {
        return {
          ok: true,
          text: JSON.stringify(reply),
          model: "claude-sonnet-5",
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      },
    },
  });
  if (!run.ok) throw new Error(`engine refused the fixture: ${run.kind}`);
  return run.output;
}

const SCHEMA: ExtractOptions = {
  mode: "schema",
  schema: [
    { name: "invoice_number", type: "string" },
    { name: "total", type: "number" },
    { name: "items", type: "array" },
    { name: "due_date", type: "date" },
  ],
};

describe("readExtractionCsv — a field schema is one row, in your order", () => {
  it("header = your field names in order; a list is joined; a missing field is an empty cell", async () => {
    // The model answers out of order and leaves due_date out entirely.
    const output = await packageFor(SCHEMA, {
      items: ["Widget", "Gadget"],
      total: 120.5,
      invoice_number: "INV-7",
    });
    const csv = await readExtractionCsv(output);
    expect(csv).toBe(
      `${CSV_BOM}invoice_number,total,items,due_date\r\nINV-7,120.5,Widget${CSV_LIST_SEPARATOR}Gadget,`,
    );
  });

  it("a value that would run as a spreadsheet formula is neutralised, as in Extract Tables", async () => {
    const output = await packageFor(SCHEMA, {
      invoice_number: '=HYPERLINK("http://x.test","pay")',
      total: -4,
      items: [],
      due_date: null,
    });
    const csv = await readExtractionCsv(output);
    // Health check: the formula really reached extraction.json's row.
    expect(csv).toContain("HYPERLINK");
    expect(csv).toContain(`"'=HYPERLINK(""http://x.test"",""pay"")"`);
    // A negative NUMBER is a number, not a formula.
    expect(csv).toContain(",-4,");
  });
});

describe("readExtractionCsv — a prompt's reply", () => {
  it("a list of objects is one row per object, every key in the order first seen", async () => {
    const output = await packageFor(
      { mode: "prompt", prompt: "List every line item." },
      [
        { sku: "A1", qty: 2 },
        { sku: "B2", price: 9.5 },
      ],
    );
    expect(await readExtractionCsv(output)).toBe(
      `${CSV_BOM}sku,qty,price\r\nA1,2,\r\nB2,,9.5`,
    );
  });

  it("a reply with no table shape (a list of plain values) gives no CSV", async () => {
    const output = await packageFor(
      { mode: "prompt", prompt: "List the product codes." },
      { codes: ["A1", "B2"] },
    );
    // Positive control: an object reply IS a row...
    expect(await readExtractionCsv(output)).toBe(
      `${CSV_BOM}codes\r\nA1${CSV_LIST_SEPARATOR}B2`,
    );
    // ...and a bare list of values is not.
    expect(extractionRows(["A1", "B2"])).toBeNull();
    expect(extractionRows({})).toBeNull();
    expect(extractionRows([])).toBeNull();
  });
});

describe("readExtractionCsv — not a package", () => {
  it("bytes that are not an extraction package give null, never an empty CSV", async () => {
    expect(await readExtractionCsv(new Uint8Array([9, 9, 9]))).toBeNull();
    expect(extractionCsv(null)).toBeNull();
  });

  it("names the CSV after the ZIP", () => {
    expect(extractionCsvName("invoice-extraction.zip")).toBe(
      "invoice-extraction.csv",
    );
  });
});

describe("AI_EXTRACT_CSV_SHAPE — the sentence every surface renders", () => {
  it("names the separator the code joins lists with", () => {
    // The behaviours behind the other clauses (one row per record, your
    // names in order, null as an empty cell) are the tests above; this one
    // holds the only figure the sentence quotes to the constant.
    expect(AI_EXTRACT_CSV_SHAPE).toContain(`"${CSV_LIST_SEPARATOR.trim()}"`);
    expect(CSV_LIST_SEPARATOR.trim()).toBe(";");
  });
});
