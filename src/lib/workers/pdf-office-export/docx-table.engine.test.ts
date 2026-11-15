// @vitest-environment node
// @native-canvas
/**
 * #28 slice 2 (tables) through the WHOLE PDF to Word engine: the flow, the
 * layout, the writer, and the engine's own check before delivery (structure
 * and text conservation, `undeliverableDocx`) — every output read back with
 * `./docx-structure`. A job that delivers passed that check.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import * as popplerSamples from "@/tests/poppler-samples";
import { noPictures } from "@/tests/page-scan-stubs";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { TABLE_ROWS } from "@/tests/pdf-office-fixtures";
import { flowPageText, flowText, type PdfFlowText } from "../pdf-text/flow";
import { parseBboxFlow } from "../pdf-text/parse";
import { docxTablesProbePdf } from "./capability";
import { docxDocumentOf } from "./docx-layout";
import { docxPackage } from "./docx-package";
import {
  asXmlCarries,
  docxPageTexts,
  readDocxStructure,
  type DocxBodyBlock,
} from "./docx-structure";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
} from "./engine";
import { scanPdfPages } from "./page-scan";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
type Tbl = Extract<DocxBodyBlock, { kind: "tbl" }>;

async function word(deps: PdfOfficeExportDeps, pdf: Uint8Array = PDF) {
  const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, deps);
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  const structure = await readDocxStructure(run.output);
  return {
    run,
    structure,
    tables: structure.blocks.filter((b): b is Tbl => b.kind === "tbl"),
    read: docxPageTexts(structure),
  };
}

const served = (flow: PdfFlowText) => async (): Promise<PdfFlowText> => flow;
const flowOfXhtml = (xhtml: string) => flowText(parseBboxFlow(xhtml));
const cellText = (c: Tbl["rows"][number]["cells"][number]) =>
  c.blocks
    .map((b) => (b.kind === "p" ? b.runs.map((r) => r.text).join("") : ""))
    .join("");
const rowsOf = (t: Tbl) => t.rows.map((r) => r.cells.map(cellText));

/** Two aligned rows of `columns` short cells: a table at every width. */
const wideTable = (columns: number) => {
  const line = (y: number) =>
    `<line>${Array.from(
      { length: columns },
      (_, k) =>
        `<word xMin="${k * 40}" yMin="${y}" xMax="${k * 40 + 10}" yMax="${y + 10}">${k}</word>`,
    ).join("")}</line>`;
  return flowOfXhtml(
    `<doc><page width="3000" height="792"><flow><block>${line(100)}${line(116)}</block></flow></page></doc>`,
  );
};

describe("PDF to Word writes recognised tables as Word tables (#28 slice 2)", () => {
  it("the gapped table (the probe's page, real page reader): one table, the price in column 3 on the row with no quantity", async () => {
    const out = await word(
      { extractFlow: flowStandIn, scanPages: scanPdfPages },
      await docxTablesProbePdf(),
    );
    expect(out.tables).toHaveLength(1);
    const [tbl] = out.tables;
    expect(tbl!.gridCols).toHaveLength(3);
    expect(rowsOf(tbl!)).toEqual([
      ["Item", "Qty", "Price"],
      ["Widget", "2", "9.50"],
      ["Gadget", "", "12.00"],
      ["Gizmo", "5", "3.25"],
    ]);
    expect(tbl!.rows[2]!.cells[1]!.blocks).toEqual([
      { kind: "p", runs: [], drawing: false, pageBreak: false },
    ]);
  });

  it("the quarterly table and the statement each come out as one table", async () => {
    for (const xhtml of [
      popplerSamples.TABLE_BBOX,
      popplerSamples.STATEMENT_BBOX,
    ]) {
      const flow = flowOfXhtml(xhtml);
      const out = await word({
        extractFlow: served(flow),
        scanPages: noPictures,
      });
      expect(out.tables).toHaveLength(1);
      expect(out.read).toEqual(flow.pages.map(flowPageText));
    }
    const out = await word({
      extractFlow: served(flowOfXhtml(popplerSamples.TABLE_BBOX)),
      scanPages: noPictures,
    });
    expect(rowsOf(out.tables[0]!)).toEqual(TABLE_ROWS.map((r) => [...r]));
  });

  it("63 columns is a Word table; 64 stays tabbed rows, and both are delivered with their text", async () => {
    const at = await word({
      extractFlow: served(wideTable(63)),
      scanPages: noPictures,
    });
    expect(at.tables.map((t) => t.gridCols.length)).toEqual([63]);
    const over = await word({
      extractFlow: served(wideTable(64)),
      scanPages: noPictures,
    });
    expect(over.tables).toEqual([]);
    expect(over.read).toEqual(wideTable(64).pages.map(flowPageText));
    expect(
      docxDocumentOf(wideTable(64), {
        pageCount: 0,
        pages: [],
        undecodedImages: 0,
        tooLargeImages: 0,
      }).tables,
    ).toEqual({ written: 0, asTabs: 1 });
  });

  it("two stacked tables: two Word tables with a paragraph between", async () => {
    const flow = flowOfXhtml(popplerSamples.STACKED_TABLES_BBOX);
    const out = await word({
      extractFlow: served(flow),
      scanPages: noPictures,
    });
    expect(out.tables.map((t) => t.gridCols.length)).toEqual([3, 2]);
    const kinds = out.structure.blocks.map((b) => b.kind);
    const first = kinds.indexOf("tbl");
    expect(kinds[first + 1]).toBe("p");
    expect(out.read).toEqual(flow.pages.map(flowPageText));
  });

  it("a table on each of two pages: two tables with the page break between, no header repeated", async () => {
    const page = flowOfXhtml(popplerSamples.TABLE_BBOX).pages[0]!;
    const flow: PdfFlowText = {
      pageCount: 2,
      pages: [
        { ...page, pageNumber: 1 },
        {
          ...page,
          pageNumber: 2,
          paragraphs: page.paragraphs.slice(1),
          boxes: page.boxes!.slice(1),
          pieces: page.pieces!.slice(1),
          tables: page.tables!.slice(1),
        },
      ],
    };
    const out = await word({
      extractFlow: served(flow),
      scanPages: noPictures,
    });
    expect(out.tables).toHaveLength(2);
    expect(rowsOf(out.tables[1]!)[0]).toEqual([...TABLE_ROWS[1]!]);
    expect(out.read).toEqual(flow.pages.map(flowPageText));
    const breakAt = out.structure.blocks.findIndex(
      (b) => b.kind === "p" && b.pageBreak,
    );
    const firstTbl = out.structure.blocks.findIndex((b) => b.kind === "tbl");
    const lastTbl = out.structure.blocks.map((b) => b.kind).lastIndexOf("tbl");
    expect(firstTbl).toBeLessThan(breakAt);
    expect(breakAt).toBeLessThan(lastTbl);
  });

  it("a cell made only of characters XML cannot carry keeps its tab: delivered, its run empty", async () => {
    const xhtml = `<doc><page width="612" height="792"><flow><block>
      <line><word xMin="50" yMin="100" xMax="70" yMax="110">a</word><word xMin="150" yMin="100" xMax="160" yMax="110">&#1;</word><word xMin="250" yMin="100" xMax="270" yMax="110">b</word></line>
      <line><word xMin="50" yMin="116" xMax="70" yMax="126">c</word><word xMin="150" yMin="116" xMax="160" yMax="126">d</word><word xMin="250" yMin="116" xMax="270" yMax="126">e</word></line>
    </block></flow></page></doc>`;
    const flow = flowOfXhtml(xhtml);
    expect(flow.pages[0]!.tables).toBeDefined();
    const out = await word({
      extractFlow: served(flow),
      scanPages: noPictures,
    });
    expect(out.tables).toHaveLength(1);
    expect(out.read.map(asXmlCarries)).toEqual(["a\t\tb\nc\td\te"]);
    const middle = out.tables[0]!.rows[0]!.cells[1]!.blocks[0]!;
    expect(middle.kind === "p" && middle.runs).toEqual([{ text: "" }]);
  });

  it("a table of Bengali cells reads back as the page's text", async () => {
    const words = [
      ["নাম", "দাম"],
      ["চাল", "৫০"],
      ["ডাল", "৮০"],
    ];
    const xhtml = `<doc><page width="612" height="792"><flow><block>${words
      .map(
        (row, r) =>
          `<line>${row
            .map(
              (w, c) =>
                `<word xMin="${50 + c * 150}" yMin="${100 + r * 16}" xMax="${80 + c * 150}" yMax="${110 + r * 16}">${w}</word>`,
            )
            .join("")}</line>`,
      )
      .join("")}</block></flow></page></doc>`;
    const flow = flowOfXhtml(xhtml);
    const out = await word({
      extractFlow: served(flow),
      scanPages: noPictures,
    });
    expect(out.tables).toHaveLength(1);
    expect(rowsOf(out.tables[0]!)).toEqual(words);
    expect(out.read).toEqual(flow.pages.map(flowPageText));
  });

  it("a table file over the size limit whose tabbed form fits is delivered TABBED, not refused", async () => {
    const flow = flowOfXhtml(popplerSamples.SURROUNDED_INVOICE_BBOX);
    const scan = {
      pageCount: 0,
      pages: [],
      undecodedImages: 0,
      tooLargeImages: 0,
    };
    const withTables = (await docxPackage(docxDocumentOf(flow, scan))).bytes
      .byteLength;
    const tabbed = (
      await docxPackage(docxDocumentOf(flow, scan, { tables: false }))
    ).bytes.byteLength;
    // Health: the table form costs bytes the tabbed form does not.
    expect(withTables).toBeGreaterThan(tabbed);
    const limit = tabbed + Math.floor((withTables - tabbed) / 2);
    const out = await word({
      extractFlow: served(flow),
      scanPages: noPictures,
      limits: { maxOutputBytes: limit },
    });
    expect(out.run.output.byteLength).toBeLessThanOrEqual(limit);
    expect(out.tables).toEqual([]);
    expect(out.read).toEqual(flow.pages.map(flowPageText));
    // Control: with room for the tables, they are written.
    const roomy = await word({
      extractFlow: served(flow),
      scanPages: noPictures,
      limits: { maxOutputBytes: withTables },
    });
    expect(roomy.tables).toHaveLength(1);
  });

  it("tables and a picture inside the limit: both are kept", async () => {
    const doc = await PDFDocument.load(await docxTablesProbePdf());
    const { encodePngImage } = await import("./png-encode");
    const png = await doc.embedPng(
      encodePngImage(40, 30, "gray8", new Uint8Array(40 * 30).fill(90)),
    );
    doc.getPage(0).drawImage(png, { x: 72, y: 400, width: 160, height: 120 });
    const pdf = await doc.save();
    const free = await word(
      { extractFlow: flowStandIn, scanPages: scanPdfPages },
      pdf,
    );
    expect(free.tables).toHaveLength(1);
    const pictures = free.structure.blocks.filter(
      (b) => b.kind === "p" && b.drawing,
    ).length;
    expect(pictures).toBe(1);
    // The pictures' budget is what the text WITH its tables leaves; at the
    // file's own size plus one picture's charged overhead, nothing goes.
    const limited = await word(
      {
        extractFlow: flowStandIn,
        scanPages: scanPdfPages,
        limits: { maxOutputBytes: free.run.output.byteLength + 1_536 },
      },
      pdf,
    );
    expect(limited.tables).toHaveLength(1);
    expect(
      limited.structure.blocks.filter((b) => b.kind === "p" && b.drawing),
    ).toHaveLength(1);
  });
});
