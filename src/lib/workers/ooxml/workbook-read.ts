/**
 * Read EVERY worksheet of an XLSX, by the name its tab shows — for proofs and
 * tests, not for production.
 *
 * `./sheet-read` reads one part by path, and the existing proofs asked it for
 * `xl/worksheets/sheet1.xml`: true of a one-sheet workbook and silent about
 * every other sheet. The wave-3 options (one sheet per page, combine tables
 * into one sheet) are claims about the SET of sheets and their names, so this
 * walks the workbook the way a consumer does: `<sheet name r:id>` in
 * `xl/workbook.xml`, each id through `xl/_rels/workbook.xml.rels` to its part.
 * It shares nothing with either writer — a writer that numbered its parts
 * one way and its relationships another is read as the consumer would read it.
 */
import JSZip from "jszip";
import { readXlsxSheet, type SheetRead } from "./sheet-read";

export interface WorkbookSheetRead {
  /** The tab name, entity-decoded. */
  name: string;
  /** The part it resolved to, e.g. `xl/worksheets/sheet2.xml`. */
  part: string;
  sheet: SheetRead;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos);/g, (_, n: string) =>
    String(ENTITIES[n]),
  );
const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/**
 * Every sheet in workbook order. Throws when the package has no workbook, or
 * a sheet's relationship or part is missing — a broken link is an unreadable
 * workbook, never a shorter list of sheets.
 */
export async function readWorkbookSheets(
  bytes: Uint8Array,
): Promise<WorkbookSheetRead[]> {
  const zip = await JSZip.loadAsync(bytes);
  const book = await zip.file("xl/workbook.xml")?.async("string");
  if (book === undefined) throw new Error("the XLSX has no xl/workbook.xml");
  const relsXml =
    (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) targets.set(id, target);
  }
  const out: WorkbookSheetRead[] = [];
  for (const m of book.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(attr(m[0], "name") ?? "");
    const id = attr(m[0], "r:id");
    const target = id ? targets.get(id) : undefined;
    if (!target) throw new Error(`sheet "${name}" has no relationship`);
    const part = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    if (!zip.file(part))
      throw new Error(`sheet "${name}" names ${part}, absent`);
    out.push({ name, part, sheet: await readXlsxSheet(bytes, part) });
  }
  return out;
}

/** Every non-empty cell value of a sheet, in row then column order. */
export function sheetValues(sheet: SheetRead): string[] {
  return sheet.rows.flatMap((row) =>
    row.cells.map((c) => c.value).filter((v) => v.trim() !== ""),
  );
}
