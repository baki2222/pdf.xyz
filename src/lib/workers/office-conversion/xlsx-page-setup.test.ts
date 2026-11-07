import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { applyXlsxPageSetup, rewriteWorksheetXml } from "./xlsx-page-setup";

const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DATA = '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>';
const MARGINS =
  '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>';
const FIT = { orientation: "landscape", fitColumnsToWidth: true } as const;

/** The elements of a worksheet in document order, by local name. */
const order = (xml: string) =>
  [...xml.matchAll(/<(?:\w+:)?(\w+)\b/g)].map((m) => m[1]);

async function xlsxWith(sheets: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/workbook.xml", "<workbook/>");
  zip.file("xl/styles.xml", "<styleSheet/>");
  for (const [name, xml] of Object.entries(sheets))
    zip.file(`xl/worksheets/${name}`, xml);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

describe("rewriting a worksheet's page setup (audit excel-to-pdf#1)", () => {
  it("adds sheetPr first and pageSetup after pageMargins when neither exists", () => {
    const out = rewriteWorksheetXml(
      `<worksheet ${NS}>${DATA}${MARGINS}</worksheet>`,
      FIT,
    )!;
    expect(out).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(out).toContain(
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
    );
    expect(order(out)).toEqual([
      "worksheet",
      "sheetPr",
      "pageSetUpPr",
      "sheetData",
      "row",
      "c",
      "v",
      "pageMargins",
      "pageSetup",
    ]);
  });

  it("edits an existing pageSetup in place, keeping its other attributes", () => {
    const out = rewriteWorksheetXml(
      `<worksheet ${NS}><sheetPr><tabColor rgb="FF00FF00"/></sheetPr>${DATA}${MARGINS}<pageSetup paperSize="9" orientation="portrait" fitToWidth="2" r:id="rId1"/><drawing r:id="rId2"/></worksheet>`,
      FIT,
    )!;
    expect(out).toContain(
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" r:id="rId1" fitToHeight="0"/>',
    );
    // pageSetUpPr is sheetPr's LAST child, after tabColor.
    expect(out).toContain(
      '<sheetPr><tabColor rgb="FF00FF00"/><pageSetUpPr fitToPage="1"/></sheetPr>',
    );
  });

  it("sets fitToPage on an existing pageSetUpPr and opens a self-closed sheetPr", () => {
    expect(
      rewriteWorksheetXml(
        `<worksheet ${NS}><sheetPr><pageSetUpPr fitToPage="0" autoPageBreaks="0"/></sheetPr>${DATA}</worksheet>`,
        FIT,
      ),
    ).toContain('<pageSetUpPr fitToPage="1" autoPageBreaks="0"/>');
    expect(
      rewriteWorksheetXml(
        `<worksheet ${NS}><sheetPr codeName="Sheet1"/>${DATA}</worksheet>`,
        FIT,
      ),
    ).toContain(
      '<sheetPr codeName="Sheet1"><pageSetUpPr fitToPage="1"/></sheetPr>',
    );
  });

  it("inserts a new pageSetup before the elements that must follow it", () => {
    const out = rewriteWorksheetXml(
      `<worksheet ${NS}>${DATA}${MARGINS}<headerFooter/><drawing r:id="rId2"/></worksheet>`,
      { orientation: "portrait", fitColumnsToWidth: false },
    )!;
    expect(order(out).slice(-3)).toEqual([
      "pageSetup",
      "headerFooter",
      "drawing",
    ]);
    // Orientation alone does not switch scaling on.
    expect(out).not.toContain("sheetPr");
    expect(out).not.toContain("fitTo");
  });

  it("follows a namespace prefix on the root element", () => {
    const out = rewriteWorksheetXml(
      `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData/></x:worksheet>`,
      FIT,
    )!;
    expect(out).toContain(
      '<x:sheetPr><x:pageSetUpPr fitToPage="1"/></x:sheetPr>',
    );
    expect(out).toContain(
      '<x:pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></x:worksheet>',
    );
  });

  it("returns null for XML that is not a worksheet", () => {
    expect(rewriteWorksheetXml("<chartsheet/>", FIT)).toBeNull();
  });
});

describe("applying it to an .xlsx package", () => {
  it("rewrites every worksheet and leaves every other entry as it was", async () => {
    const input = await xlsxWith({
      "sheet1.xml": `<worksheet ${NS}>${DATA}${MARGINS}</worksheet>`,
      "sheet2.xml": `<worksheet ${NS}>${DATA}</worksheet>`,
    });
    const result = await applyXlsxPageSetup(input, FIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets).toBe(2);
    const zip = await JSZip.loadAsync(result.bytes);
    for (const name of ["sheet1.xml", "sheet2.xml"]) {
      const xml = await zip.file(`xl/worksheets/${name}`)!.async("string");
      expect(xml, name).toContain('fitToPage="1"');
      expect(xml, name).toContain('orientation="landscape"');
    }
    expect(await zip.file("xl/styles.xml")!.async("string")).toBe(
      "<styleSheet/>",
    );
  });

  it("refuses what is not an .xlsx workbook, and a ZIP with no worksheet", async () => {
    expect(
      (await applyXlsxPageSetup(new TextEncoder().encode("a,b\n1,2\n"), FIT))
        .ok,
    ).toBe(false);
    const zip = new JSZip();
    zip.file("content.xml", "<office:document/>");
    expect(
      (
        await applyXlsxPageSetup(
          await zip.generateAsync({ type: "uint8array" }),
          FIT,
        )
      ).ok,
    ).toBe(false);
  });
});
