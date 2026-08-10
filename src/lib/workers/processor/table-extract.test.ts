import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  createTableExtractProcessor,
  tableExtractOutputName,
} from "./table-extract";
import type { PdfLayout } from "../table-extract/engine";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

function tableLayout(): PdfLayout {
  return {
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        width: 400,
        height: 300,
        items: [
          { text: "Name", x: 50, y: 100, width: 20, height: 10 },
          { text: "Age", x: 200, y: 100, width: 15, height: 10 },
          { text: "Alice", x: 50, y: 80, width: 25, height: 10 },
          { text: "30", x: 200, y: 80, width: 10, height: 10 },
        ],
      },
    ],
  };
}

const extractLayout = vi.fn(async () => tableLayout());

describe("table-extract processor", () => {
  it("owns extract-tables and reports readiness", () => {
    const processor = createTableExtractProcessor({ extractLayout });
    expect(processor.tools).toEqual(["extract-tables"]);
    expect(processor.supports("extract-tables")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "table-extract",
      ready: true,
    });
  });

  it("fails honestly without a layout extractor", async () => {
    const result = await createTableExtractProcessor({}).process({
      tool: "extract-tables",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "report.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("extracts one PDF input to a ZIP artifact of real tables", async () => {
    const processor = createTableExtractProcessor({
      extractLayout,
      limits: {},
    });
    const result = await processor.process({
      tool: "extract-tables",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "annual.report.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts[0]).toMatchObject({
        filename: "annual.report-tables.zip",
        contentType: "application/zip",
      });
      expect(result.meta).toMatchObject({
        engine: "pdfjs-layout-tables",
        tool: "extract-tables",
        tableCount: 1,
      });
      const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
      expect(await zip.file("table-1.csv")!.async("string")).toBe(
        "Name,Age\r\nAlice,30",
      );
    }
  });

  it("fails as unprocessable when no tables are present", async () => {
    const prose = vi.fn(async () => ({
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          width: 400,
          height: 300,
          items: [
            {
              text: "Just running prose here.",
              x: 50,
              y: 100,
              width: 120,
              height: 10,
            },
          ],
        },
      ],
    }));
    const result = await createTableExtractProcessor({
      extractLayout: prose,
    }).process({
      tool: "extract-tables",
      options: {},
      inputs: [
        {
          fileId: "f",
          filename: "essay.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("rejects malformed input count", async () => {
    const result = await createTableExtractProcessor({ extractLayout }).process(
      { tool: "extract-tables", options: {}, inputs: [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(tableExtractOutputName("annual.report.pdf", "zip")).toBe(
      "annual.report-tables.zip",
    );
  });
});
