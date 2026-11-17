import JSZip from "jszip";
import {
  SheetStyles,
  STYLES_CONTENT_TYPE_OVERRIDE,
  stylesRelationship,
  worksheetXml,
  xmlEscape,
} from "./sheet-cells";

/*
 * The XLSX package around `./sheet-cells`: content types, relationships, the
 * workbook and one worksheet per sheet. Moved here from
 * table-extract/engine.ts on 2026-11-17, unchanged, so AI Data Extraction can
 * build its workbook IN THE BROWSER with the writer Extract Tables uses on our
 * server: one writer, so a fix to either output is a fix to both. Browser-safe
 * by construction: JSZip and the cell module, no node imports.
 *
 * Text cells are inline strings (`sheetCell`), and an inline string is never a
 * formula, so the `=`/`+`/`-`/`@` neutralising the CSV and TSV need does not
 * apply here: the cell holds the text as printed (tsv-and-workbook.test.ts).
 */

/** One worksheet of the workbook: its tab name and its rows. */
export interface WorkbookSheet {
  name: string;
  rows: string[][];
}

/** Build a single XLSX workbook, one worksheet per entry of `sheets`. */
export async function buildWorkbook(
  sheetsIn: readonly WorkbookSheet[],
): Promise<Uint8Array> {
  // Cells, column letters and number rules are shared with PDF to Excel —
  // see `./sheet-cells`. Sheets first: they register the formats that
  // `xl/styles.xml` must declare.
  const styles = new SheetStyles();
  const sheets = sheetsIn.map((sheet) => worksheetXml(sheet.rows, styles));
  const zip = new JSZip();
  const sheetOverrides = sheetsIn
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}${STYLES_CONTENT_TYPE_OVERRIDE}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetsIn
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join(
        "",
      )}${stylesRelationship(`rId${sheetsIn.length + 1}`)}</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetsIn
      .map(
        (sheet, i) =>
          `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  sheets.forEach((sheet, i) =>
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheet),
  );
  zip.file("xl/styles.xml", styles.xml());
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
