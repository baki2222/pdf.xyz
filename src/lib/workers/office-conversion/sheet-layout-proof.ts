/**
 * The deployment proof's input and verdict for Excel to PDF's Orientation and
 * "Fit all columns on the page width" (audit excel-to-pdf#1, 2026-11-08).
 *
 * The options change two properties of the PDF a person downloads, and this
 * reads both from it: every page is A4 LANDSCAPE (`./xlsx-page-setup` writes
 * the orientation and paperSize 9 into each worksheet), and the LAST column
 * is on every page (fit-to-width; `fitToHeight="0"` lets rows run on).
 * Measured on the production image (that module's header): a 40 x 400 sheet
 * with no page setup prints on 32 portrait pages with the last column on 8
 * of them; fit + landscape prints 4 landscape pages, the last column on all.
 * A worker older than the options ignores them and converts the plain file:
 * a valid PDF, so `isPdf` passes it, and this fails it.
 *
 * Every row ends in a cell `QQ<row>`, the only text of that shape, so a page
 * "has the last column" exactly when its text holds one. The first and last
 * rows' marks must both appear (nothing cut). Health: a PDF with no pages,
 * texts that do not match the page count, or no mark at all fails, so "every
 * page has the last column" cannot pass vacuously.
 *
 * Pure (JSZip for the input, pdf-lib for page boxes, text passed in), so the
 * unit tests and `scripts/worker-prove-tools.ts` ask the same question; the
 * harness extracts each page's text with pdfjs and hands it over.
 */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

export const WIDE_SHEET = { cols: 40, rows: 400 } as const;

/** The last column's prefix: `QQ12` is row 12's last cell. */
export const LAST_COLUMN_MARK = "QQ";

/** A4 in points, portrait; landscape swaps them. */
export const A4_POINTS = { width: 595.28, height: 841.89 } as const;
const POINT_TOLERANCE = 3;

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const ODOC_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

/**
 * A `cols` x `rows` .xlsx with NO page setup of its own: numbers in every
 * cell but the last, which holds `QQ<row>` as an inline string. Deterministic
 * (fixed dates in the ZIP), small (a few tens of KB).
 */
export async function wideSheetXlsx({
  cols,
  rows,
}: { cols: number; rows: number } = WIDE_SHEET): Promise<Uint8Array> {
  const lines: string[] = [];
  for (let r = 1; r <= rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols - 1; c++)
      cells.push(
        `<c r="${columnName(c)}${r}"><v>${(r * 31 + c * 7) % 997}</v></c>`,
      );
    cells.push(
      `<c r="${columnName(cols - 1)}${r}" t="inlineStr"><is><t>${LAST_COLUMN_MARK}${r}</t></is></c>`,
    );
    lines.push(`<row r="${r}">${cells.join("")}</row>`);
  }
  const zip = new JSZip();
  const date = new Date("2026-01-01T00:00:00Z");
  const add = (name: string, body: string) => zip.file(name, body, { date });
  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  );
  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${ODOC_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  add(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${ODOC_NS}"><sheets><sheet name="Wide" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${ODOC_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  add(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN_NS}"><sheetData>${lines.join("")}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** The page sizes as a viewer shows them: /Rotate 90 or 270 swaps the box. */
async function shownPageSizes(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }[]> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  return doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    const turn = ((page.getRotation().angle % 360) + 360) % 360;
    return turn === 90 || turn === 270
      ? { width: height, height: width }
      : { width, height };
  });
}

/**
 * The verdict for "landscape + fit all columns on the page width" on
 * {@link wideSheetXlsx}. `pageTexts[i]` is page i+1's extracted text.
 */
export async function sheetLayoutProofVerdict(
  bytes: Uint8Array,
  pageTexts: readonly string[],
  rows: number = WIDE_SHEET.rows,
): Promise<{ ok: boolean; detail: string }> {
  const fail = (detail: string) => ({ ok: false, detail });
  let sizes: { width: number; height: number }[];
  try {
    sizes = await shownPageSizes(bytes);
  } catch (error) {
    return fail(`the download could not be read: ${(error as Error).message}`);
  }
  if (sizes.length === 0) return fail("the PDF has no pages");
  if (pageTexts.length !== sizes.length)
    return fail(
      `${pageTexts.length} page texts for ${sizes.length} pages: the text was not read page by page`,
    );
  // Read from the text as extracted, never with spaces squeezed out: that
  // joins a cell's digits to the next cell's ("QQ1 62" reads as "QQ162").
  const mark = new RegExp(`${LAST_COLUMN_MARK}(\\d+)(?!\\d)`, "g");
  const perPage = pageTexts.map((t) =>
    [...t.matchAll(mark)].map((m) => Number(m[1])),
  );
  const all = new Set(perPage.flat());
  if (all.size === 0)
    return fail(
      `no "${LAST_COLUMN_MARK}<row>" cell on any of ${sizes.length} pages: the sheet's last column is not in the PDF`,
    );
  const box = (s: { width: number; height: number }) =>
    `${Math.round(s.width)}x${Math.round(s.height)}`;
  const portrait = sizes.flatMap((s, i) => (s.width > s.height ? [] : [i + 1]));
  const withoutLast = perPage.flatMap((m, i) => (m.length > 0 ? [] : [i + 1]));
  const summary = `${sizes.length} pages (first ${box(sizes[0]!)} pt), the last column on ${sizes.length - withoutLast.length} of them`;
  if (portrait.length > 0)
    return fail(
      `${summary}; page(s) ${portrait.slice(0, 8).join(", ")} not landscape: the orientation was not applied`,
    );
  const notA4 = sizes.flatMap((s, i) =>
    Math.abs(s.width - A4_POINTS.height) <= POINT_TOLERANCE &&
    Math.abs(s.height - A4_POINTS.width) <= POINT_TOLERANCE
      ? []
      : [i + 1],
  );
  if (notA4.length > 0)
    return fail(
      `${summary}; page(s) ${notA4.slice(0, 8).join(", ")} are not A4 landscape`,
    );
  if (withoutLast.length > 0)
    return fail(
      `${summary}; page(s) ${withoutLast.slice(0, 8).join(", ")} lack the last column: the columns were not fitted to the page width`,
    );
  if (!all.has(1) || !all.has(rows))
    return fail(
      `${summary}; the ${!all.has(1) ? "first" : "last"} row's last cell is missing: rows were cut`,
    );
  return {
    ok: true,
    detail: `${summary}: A4 landscape, every column on every page, rows 1-${rows} present`,
  };
}
