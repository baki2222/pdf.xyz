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

  it("places a new pageSetup among worksheet's own children, not inside a data bar's extLst", () => {
    // Excel 2010+ data bars nest <extLst> inside <cfRule>, which comes
    // BEFORE pageMargins; a search of the whole document found that one.
    const dataBar =
      '<conditionalFormatting sqref="A1:A3"><cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:id>{00000000-0000-0000-0000-000000000001}</x14:id></ext></extLst></cfRule></conditionalFormatting>';
    const topExt =
      '<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"><x14:conditionalFormattings xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"/></ext></extLst>';
    const out = rewriteWorksheetXml(
      `<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><extLst><ext uri="{x}"/></extLst></sheetView></sheetViews>${DATA}${dataBar}${MARGINS}${topExt}</worksheet>`,
      FIT,
    )!;
    const tag =
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
    expect(out).toContain(`${MARGINS}${tag}${topExt}</worksheet>`);
    expect(out.split(tag)).toHaveLength(2);
    expect(out).toContain(dataBar);
  });

  it("edits the worksheet's own pageSetup, not a custom view's, and adds one when only a view has it", () => {
    const view =
      '<customSheetViews><customSheetView guid="{1}"><pageMargins left="1" right="1" top="1" bottom="1" header="0" footer="0"/><pageSetup orientation="portrait"/><headerFooter/></customSheetView></customSheetViews>';
    // Only the custom view has a pageSetup: the sheet gets its own.
    const added = rewriteWorksheetXml(
      `<worksheet ${NS}>${DATA}${view}${MARGINS}</worksheet>`,
      FIT,
    )!;
    expect(added).toContain(view);
    expect(added).toContain(
      `${MARGINS}<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`,
    );
    // Both have one: the sheet's is edited, the view's is left alone.
    const edited = rewriteWorksheetXml(
      `<worksheet ${NS}>${DATA}${view}${MARGINS}<pageSetup paperSize="1"/></worksheet>`,
      FIT,
    )!;
    expect(edited).toContain(view);
    expect(edited).toContain(
      `${MARGINS}<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`,
    );
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
