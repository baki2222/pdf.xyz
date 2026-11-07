/**
 * The spreadsheet inputs the production proof sends Excel to PDF (XLSX and
 * CSV), and the verdict it reads the returned PDF with.
 *
 * Added 2026-11-06 (audit #50): those two proofs asserted only that a PDF
 * came back, so a blank page passed. The cells below are the sentinels the
 * verdict requires in the PDF's text; one is non-ASCII, so a mis-decoded CSV
 * (UTF-8 read as Latin-1) fails too. Moved out of
 * scripts/worker-prove-tools.ts so the verdict has a test.
 */
import JSZip from "jszip";

/** Every cell both fixtures carry, each required in the converted PDF's text. */
export const SHEET_PROOF_CELLS = [
  "Region",
  "Q1",
  "Q2",
  "North",
  "1350",
  "Zürich",
  "1020",
] as const;

/** A CSV of {@link SHEET_PROOF_CELLS}, UTF-8. */
export function csvProofFile(): Buffer {
  return Buffer.from(
    "Region,Q1,Q2\nNorth,1200,1350\nZürich,980,1020\n",
    "utf8",
  );
}

const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const ODOC_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const rootRels = (target: string, type: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;

/** A real XLSX: one inline-string worksheet of the same rows as the CSV. */
export async function xlsxProofFile(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    rootRels("xl/workbook.xml", `${ODOC_NS}/officeDocument`),
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ODOC_NS}"><sheets><sheet name="Proof" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    rootRels("worksheets/sheet1.xml", `${ODOC_NS}/worksheet`),
  );
  const cols = ["A", "B", "C"];
  const rows = [
    ["Region", "Q1", "Q2"],
    ["North", "1200", "1350"],
    ["Zürich", "980", "1020"],
  ];
  const sheetRows = rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells
          .map(
            (text, c) =>
              `<c r="${cols[c]}${r + 1}" t="inlineStr"><is><t>${text}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("\n");
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
${sheetRows}
</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * The returned PDF has a page and every sentinel cell in its text. `text` is
 * the PDF's text as pdf.js reads it, `pages` its page count.
 */
export function sheetProofVerdict(
  text: string,
  pages: number,
): { ok: boolean; detail: string } {
  const missing = SHEET_PROOF_CELLS.filter((cell) => !text.includes(cell));
  return {
    ok: pages >= 1 && missing.length === 0,
    detail: `${pages} page(s); ${
      missing.length === 0
        ? `all ${SHEET_PROOF_CELLS.length} cells in the text`
        : `missing ${missing.join(", ")}`
    }`,
  };
}
