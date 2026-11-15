// @vitest-environment node
/**
 * #28 slice 2 (tables): a table flow.ts recognises is written as a real Word
 * table — `./docx-layout` gathers its rows into one `DocxTableBlock`, each
 * cell in the grid column its position falls in, and `./docx-package`
 * writes it as `w:tbl`. Every test reads the .docx back with
 * `./docx-structure`, which shares nothing with the writer.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import * as popplerSamples from "@/tests/poppler-samples";
import { flowPageText, flowText, type PdfFlowText } from "../pdf-text/flow";
import { parseBboxFlow } from "../pdf-text/parse";
import {
  docxDocumentOf,
  type DocxDocument,
  type DocxTableBlock,
} from "./docx-layout";
import { docxPackage } from "./docx-package";
import {
  docxPageTexts,
  docxStructureProblems,
  readDocxStructure,
  type DocxBodyBlock,
} from "./docx-structure";
import type { PdfPageScan, ScannedPage, ScannedPicture } from "./page-scan";
import { encodePngImage } from "./png-encode";

const NO_SCAN: PdfPageScan = {
  pageCount: 0,
  pages: [],
  undecodedImages: 0,
  tooLargeImages: 0,
};

const flowOf = (xhtml: string): PdfFlowText => flowText(parseBboxFlow(xhtml));

async function documentXml(bytes: Uint8Array): Promise<string> {
  return (await JSZip.loadAsync(bytes))
    .file("word/document.xml")!
    .async("string");
}

type Tbl = Extract<DocxBodyBlock, { kind: "tbl" }>;
const cellTexts = (tbl: Tbl) =>
  tbl.rows.map((r) =>
    r.cells.map((c) =>
      c.blocks
        .map((b) => (b.kind === "p" ? b.runs.map((x) => x.text).join("") : ""))
        .join("\n"),
    ),
  );
const tablesOf = (blocks: DocxBodyBlock[]) =>
  blocks.filter((b): b is Tbl => b.kind === "tbl");

/** The whole chain: flow → layout → writer → reader, and conservation. */
async function written(flow: PdfFlowText, scan: PdfPageScan = NO_SCAN) {
  const doc = docxDocumentOf(flow, scan);
  const { bytes } = await docxPackage(doc);
  const structure = await readDocxStructure(bytes);
  return {
    doc,
    bytes,
    structure,
    xml: await documentXml(bytes),
    problems: await docxStructureProblems(bytes),
    read: docxPageTexts(structure),
    want: flow.pages.map(flowPageText),
  };
}

describe("docx-layout: a recognised table is one DocxTableBlock", () => {
  it("the quarterly table: one block, four columns, every value in its column", () => {
    const doc = docxDocumentOf(flowOf(popplerSamples.TABLE_BBOX), NO_SCAN);
    const tables = doc.pages[0]!.filter(
      (b): b is DocxTableBlock => b.kind === "table",
    );
    expect(tables).toHaveLength(1);
    const [table] = tables;
    expect(table!.columns).toHaveLength(4);
    expect(
      table!.rows.map((r) =>
        r.slots.map((s) => s?.map((runs) => runs.map((x) => x.text).join(""))),
      ),
    ).toEqual([
      [["Region"], ["Q1"], ["Q2"], ["Q3"]],
      [["North"], ["1200"], ["1350"], ["1410"]],
      [["South"], ["980"], ["1020"], ["1100"]],
    ]);
    expect(doc.tables).toEqual({ written: 1, asTabs: 0 });
  });

  it("column widths are the spans' starts apart, scaled into the text area, whole twips", () => {
    const doc = docxDocumentOf(flowOf(popplerSamples.TABLE_BBOX), NO_SCAN);
    const table = doc.pages[0]!.find(
      (b): b is DocxTableBlock => b.kind === "table",
    )!;
    // Derived from the flow's own spans, never typed: each column is from
    // its start to the next one's (the last, its own span), x 20 twips —
    // the quarterly table is narrower than the text area, so unscaled.
    const spans = flowOf(popplerSamples.TABLE_BBOX).pages[0]!.tables![0]!.spans;
    const want = spans.map((s, k) =>
      Math.round(((spans[k + 1]?.[0] ?? s[1]) - s[0]) * 20),
    );
    expect(want.every((w) => w > 0)).toBe(true);
    expect(table.columns).toEqual(want);
  });

  it("with tables off (the size fallback), every table is tabbed rows and counted", () => {
    const flow = flowOf(popplerSamples.STACKED_TABLES_BBOX);
    const doc = docxDocumentOf(flow, NO_SCAN, { tables: false });
    expect(doc.pages[0]!.some((b) => b.kind === "table")).toBe(false);
    expect(doc.tables).toEqual({ written: 0, asTabs: 2 });
  });
});

describe("docx-package: the Word table as written", () => {
  it("tblPr in schema order, thin grey borders, fixed layout, widths that sum", async () => {
    const out = await written(flowOf(popplerSamples.TABLE_BBOX));
    expect(out.problems).toEqual([]);
    const border = (side: string) =>
      `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    expect(out.xml).toContain(
      `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"]
        .map(border)
        .join(
          "",
        )}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>`,
    );
    expect(out.xml).toMatch(
      /<w:tblPr><w:tblW w:w="\d+" w:type="dxa"\/><w:tblBorders>/,
    );
    const [tbl] = tablesOf(out.structure.blocks);
    expect(tbl!.width).toBe(tbl!.gridCols.reduce((s, w) => s + w, 0));
    expect(tbl!.rows.every((r) => r.cells.every((c) => c.span === 1))).toBe(
      true,
    );
  });

  it("an invoice row missing its description: that cell is EMPTY (no run), the values after it stay in their columns", async () => {
    const out = await written(flowOf(popplerSamples.SURROUNDED_INVOICE_BBOX));
    expect(out.problems).toEqual([]);
    expect(out.read).toEqual(out.want);
    const [tbl] = tablesOf(out.structure.blocks);
    const row = tbl!.rows.find(
      (r) =>
        r.cells[0]!.blocks[0]!.kind === "p" &&
        r.cells[0]!.blocks[0]!.runs[0]?.text === "1002",
    )!;
    expect(cellTexts({ ...tbl!, rows: [row] })).toEqual([
      ["1002", "2026-01-06", "", "5", "$3,400.50"],
    ]);
    const description = row.cells[2]!.blocks;
    expect(description).toEqual([
      { kind: "p", runs: [], drawing: false, pageBreak: false },
    ]);
  });

  it("never writes a self-closing <w:p/>: an empty slot is <w:p></w:p>", async () => {
    const out = await written(flowOf(popplerSamples.SURROUNDED_INVOICE_BBOX));
    expect(out.xml).not.toMatch(/<w:p\/>|<w:p [^>]*\/>/);
    expect(out.xml).toContain("<w:p></w:p></w:tc>");
  });

  it("two stacked tables: two w:tbl with an empty paragraph between, and one before the section", async () => {
    const out = await written(flowOf(popplerSamples.STACKED_TABLES_BBOX));
    expect(out.problems).toEqual([]);
    expect(out.read).toEqual(out.want);
    const tables = tablesOf(out.structure.blocks);
    expect(tables.map((t) => t.gridCols.length)).toEqual([3, 2]);
    expect(out.xml).toContain("</w:tbl><w:p></w:p><w:tbl>");
    expect(out.xml).toMatch(/<\/w:tbl><w:p><\/w:p><w:sectPr>/);
  });

  it("a header spanning sub-columns: its combined slot is ONE paragraph with a tab run between the cells", async () => {
    const out = await written(flowOf(popplerSamples.SPANNING_TABLE_BBOX));
    expect(out.problems).toEqual([]);
    expect(out.read).toEqual(out.want);
    const [tbl] = tablesOf(out.structure.blocks);
    expect(cellTexts(tbl!)[1]).toEqual(["", "Q1\tQ2", "Q3"]);
    expect(tbl!.rows[1]!.cells[1]!.blocks).toHaveLength(1);
  });

  it("runs inside cells keep their rPr", async () => {
    const flow = flowOf(popplerSamples.TABLE_BBOX);
    const doc = docxDocumentOf(flow, NO_SCAN);
    const table = doc.pages[0]!.find(
      (b): b is DocxTableBlock => b.kind === "table",
    )!;
    const bold: DocxDocument = {
      ...doc,
      pages: [
        [
          {
            ...table,
            rows: table.rows.map((r, k) =>
              k === 0
                ? {
                    slots: r.slots.map(
                      (s) =>
                        s?.map((runs) =>
                          runs.map((x) => ({
                            ...x,
                            style: { bold: true as const, halfPoints: 24 },
                          })),
                        ) ?? null,
                    ),
                  }
                : r,
            ),
          },
        ],
      ],
    };
    const bytes = (await docxPackage(bold)).bytes;
    expect(await docxStructureProblems(bytes)).toEqual([]);
    const [tbl] = tablesOf((await readDocxStructure(bytes)).blocks);
    const runsOf = (r: number) =>
      tbl!.rows[r]!.cells.flatMap((c) =>
        c.blocks.flatMap((b) => (b.kind === "p" ? b.runs : [])),
      );
    expect(runsOf(0).every((x) => x.b && x.bCs && x.sz === 24)).toBe(true);
    expect(runsOf(1).some((x) => x.b)).toBe(false);
  });

  it("a page of prose has no table and no empty paragraph", async () => {
    const out = await written(flowOf(popplerSamples.LETTER_BBOX));
    expect(tablesOf(out.structure.blocks)).toEqual([]);
    expect(out.xml).not.toContain("<w:p></w:p>");
    expect(out.read).toEqual(out.want);
  });
});

describe("docx-layout: pictures never land inside a table", () => {
  it("a picture beside the table's middle row goes after the table's last row", async () => {
    const flow = flowOf(popplerSamples.TABLE_BBOX);
    const media = {
      key: "m",
      bytes: encodePngImage(4, 4, "gray8", new Uint8Array(16).fill(200)),
      ext: "png" as const,
      pixelWidth: 4,
      pixelHeight: 4,
      passthrough: false,
    };
    // The North row spans y 100-110; the picture starts at its top, beside
    // the table, overlapping the Q3 column (380-404).
    const picture: ScannedPicture = {
      kind: "picture",
      role: "image",
      media,
      x: 390,
      y: 100,
      width: 40,
      height: 20,
      rotation: 0,
      flipH: false,
      flipV: false,
    };
    const page: ScannedPage = {
      pageNumber: 1,
      width: 612,
      height: 792,
      items: [picture],
      picturesTooLarge: 0,
      picturesUndecoded: 0,
      picturesUnverified: false,
      flattened: false,
    };
    const scan: PdfPageScan = { ...NO_SCAN, pageCount: 1, pages: [page] };
    const doc = docxDocumentOf(flow, scan);
    expect(doc.pages[0]!.map((b) => b.kind)).toEqual(["table", "picture"]);
    const out = await written(flow, scan);
    expect(out.problems).toEqual([]);
    expect(out.read).toEqual(out.want);
  });
});
