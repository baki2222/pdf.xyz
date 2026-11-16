// @vitest-environment node
/**
 * #28 slice 3 (wraps) through the WHOLE PDF to Word engine, the flow fed the
 * PRODUCTION IMAGE's captures (`flowOf(IMAGE_*_BBOX)`): the outcomes below
 * are measured on that poppler, so they are asserted on it — never on the
 * stand-in or the Windows build, where a pin would fail for the wrong reason.
 *
 * The writer and readers are NOT changed by this slice: an absorbed cell is
 * one cell whose pieces span two or more poppler lines, written as ONE
 * `w:p` (decision D1) — `docxPageTexts` joins a cell's paragraphs with "\n"
 * while flow joins wrapped lines with a space, so a cell written as one
 * paragraph per line changes the page's text and the engine's own check
 * refuses the job (the D1 health check, mutation M9's red).
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import * as image from "@/tests/poppler-samples-image";
import { noPictures } from "@/tests/page-scan-stubs";
import { flowPageText, flowText, type PdfFlowText } from "../pdf-text/flow";
import { parseBboxFlow } from "../pdf-text/parse";
import type { DocxDocument } from "./docx-layout";
import { docxPackage } from "./docx-package";
import {
  asXmlCarries,
  docxPageTexts,
  docxStructureProblems,
  readDocxStructure,
  type DocxBodyBlock,
} from "./docx-structure";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
} from "./engine";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
type Tbl = Extract<DocxBodyBlock, { kind: "tbl" }>;

const flowOf = (xhtml: string) => flowText(parseBboxFlow(xhtml));
const deps = (flow: PdfFlowText): PdfOfficeExportDeps => ({
  extractFlow: async () => flow,
  scanPages: noPictures,
});

async function word(
  flow: PdfFlowText,
  extra: Partial<PdfOfficeExportDeps> = {},
) {
  const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, PDF, {
    ...deps(flow),
    ...extra,
  });
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  const structure = await readDocxStructure(run.output);
  return {
    problems: await docxStructureProblems(run.output),
    structure,
    tables: structure.blocks.filter((b): b is Tbl => b.kind === "tbl"),
    read: docxPageTexts(structure),
  };
}

const paragraphsOf = (c: Tbl["rows"][number]["cells"][number]) =>
  c.blocks.filter((b) => b.kind === "p");
const cellText = (c: Tbl["rows"][number]["cells"][number]) =>
  paragraphsOf(c)
    .map((b) => (b.kind === "p" ? b.runs.map((r) => r.text).join("") : ""))
    .join("\n");
const rowsOf = (t: Tbl) => t.rows.map((r) => r.cells.map(cellText));

/** Delivered, and the file reads back as the flow's own page text. */
const conserved = (
  out: Awaited<ReturnType<typeof word>>,
  flow: PdfFlowText,
) => {
  expect(out.problems).toEqual([]);
  expect(out.read.map(asXmlCarries)).toEqual(
    flow.pages.map((p) => asXmlCarries(flowPageText(p))),
  );
};

describe("PDF to Word keeps a wrapped cell in its row (#28 slice 3), on the image's poppler", () => {
  it("S1 the probe: one table, 5 x 3, both absorbed cells ONE paragraph each, the total outside", async () => {
    const flow = flowOf(image.IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX);
    const out = await word(flow);
    conserved(out, flow);
    expect(out.tables).toHaveLength(1);
    const t = out.tables[0]!;
    expect(t.gridCols).toHaveLength(3);
    expect(rowsOf(t)).toEqual([
      ["Item", "Description", "Amount"],
      ["A-100", "Filter cartridge", "12.50"],
      ["B-200", "Replacement pump and housing assembly for model X", "48.00"],
      ["C-300", "Service visit Labour and parts Callout fee included", "95.00"],
      ["D-400", "Gasket", "3.25"],
    ]);
    expect(paragraphsOf(t.rows[2]!.cells[1]!)).toHaveLength(1);
    expect(paragraphsOf(t.rows[3]!.cells[1]!)).toHaveLength(1);
    expect(t.rows.every((r) => r.cells.every((c) => c.span === 1))).toBe(true);
    expect(out.read.join("\n")).toContain("158.75");
  });

  it("S2 long and short: one table of 5 rows each", async () => {
    for (const x of [
      image.IMAGE_WRAPPED_LONG_BBOX,
      image.IMAGE_WRAPPED_SHORT_BBOX,
    ]) {
      const flow = flowOf(x);
      const out = await word(flow);
      conserved(out, flow);
      expect(out.tables.map((t) => t.rows.length)).toEqual([5]);
    }
  });

  it("S3 invoice: the item table of 6 rows and the totals of 3; stain-less as one word", async () => {
    const flow = flowOf(image.IMAGE_WRAPPED_INVOICE_BBOX);
    const out = await word(flow);
    conserved(out, flow);
    expect(out.tables.map((t) => t.rows.length)).toEqual([6, 3]);
    expect(rowsOf(out.tables[0]!)[3]![1]).toBe(
      "Coffee dripper, stain-less steel, two cups",
    );
  });

  it("S5 statement: references in their rows, the empty Debit/Credit slots empty", async () => {
    const flow = flowOf(image.IMAGE_BANK_STATEMENT_BBOX);
    const out = await word(flow);
    conserved(out, flow);
    expect(out.tables).toHaveLength(1);
    const rows = rowsOf(out.tables[0]!);
    expect(rows[1]).toEqual([
      "01/03",
      "Card payment Tesco Stores REF 88231 CARD 4421",
      "42.10",
      "",
      "1,957.90",
    ]);
    expect(rows[2]![2]).toBe("");
  });

  it("S6 first-column wrap and S13 page break: as slice 2 (one table of 3 rows; nothing joined across pages)", async () => {
    const s6 = flowOf(image.IMAGE_ACADEMIC_LABEL_WRAP_BBOX);
    const out6 = await word(s6);
    conserved(out6, s6);
    expect(out6.tables.map((t) => t.rows.length)).toEqual([3]);
    const s13 = flowOf(image.IMAGE_WRAP_ACROSS_PAGES_BBOX);
    const out13 = await word(s13);
    conserved(out13, s13);
    expect(out13.tables.map((t) => t.rows.length)).toEqual([4]);
  });

  it("S14 Bengali: absorbed, and read back through docxPageTexts as the flow's text", async () => {
    const flow = flowOf(image.IMAGE_WRAPPED_BENGALI_TABLE_BBOX);
    const out = await word(flow);
    conserved(out, flow);
    expect(out.tables.map((t) => t.rows.length)).toEqual([5]);
  });

  it("D1 health (M9): an absorbed cell written as one paragraph per line is REFUSED by the engine as incomplete_output", async () => {
    // CHANGED 2026-11-16 (the copy part's mutation pass). Until then the
    // split was made in the DocxDocument: the cell became two run lists in
    // one slot, which the writer joins with a TAB inside ONE w:p — so the
    // job was refused for a tab, and nothing here wrote two paragraphs
    // (found by the probe part; its negative (e) edits the XML the same
    // way). Now the writer's own bytes are edited before the engine's check,
    // and the file is read back to show the cell really holds two w:p.
    const flow = flowOf(image.IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX);
    const twoParagraphs = (xml: string) =>
      xml.replace(
        ">Service visit Labour and parts Callout fee included</w:t></w:r></w:p>",
        '>Service visit</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Labour and parts Callout fee included</w:t></w:r></w:p>',
      );
    let written: Uint8Array | null = null;
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, PDF, {
      ...deps(flow),
      writeDocx: async (doc: DocxDocument) => {
        const out = await docxPackage(doc);
        const zip = await JSZip.loadAsync(out.bytes);
        const xml = await zip.file("word/document.xml")!.async("string");
        const changed = twoParagraphs(xml);
        if (changed === xml) throw new Error("the edit did not land");
        zip.file("word/document.xml", changed);
        written = new Uint8Array(
          await zip.generateAsync({ type: "uint8array" }),
        );
        return { ...out, bytes: written };
      },
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("incomplete_output");
    // Health of the edit: the refused file's C-300 Description is TWO w:p.
    expect(written).not.toBeNull();
    const refused = (await readDocxStructure(written!)).blocks.filter(
      (b): b is Tbl => b.kind === "tbl",
    );
    expect(
      refused[0]!.rows[3]!.cells[1]!.blocks.filter((b) => b.kind === "p"),
    ).toHaveLength(2);
    // Health: the same seam without the split delivers.
    const fine = await runPdfOfficeExport(PDF_TO_WORD_TOOL, PDF, {
      ...deps(flow),
      writeDocx: (doc) => docxPackage(doc),
    });
    expect(fine.ok).toBe(true);
  });
});
