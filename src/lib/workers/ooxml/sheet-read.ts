/**
 * Read an XLSX worksheet back into the cells a spreadsheet shows — for PROOFS
 * and tests, not for production.
 *
 * The PDF to Excel proof used to check only that the artifact began with `PK`.
 * The sheet it certified put `1,250.00` in two columns and moved every value
 * after an empty cell under the wrong header. This reads the package the way a
 * consumer does: each cell at its own reference, typed (number or text), with
 * the number format Excel will display it in. It shares NOTHING with the
 * writer in `./sheet-cells` — reference letters are decoded here on their own,
 * so a wrong writer cannot be agreed with by its own inverse.
 */
import JSZip from "jszip";

export interface SheetCellRead {
  /** The cell's `r` attribute, verbatim. */
  ref: string;
  /** 0-based column decoded from `ref` (A → 0, AA → 26); -1 when malformed. */
  column: number;
  /** 1-based row decoded from `ref`; -1 when malformed. */
  row: number;
  type: "number" | "text";
  /** The text shown (text cells) or the stored `<v>` (number cells). */
  value: string;
  /** The number format code applied, `General` when none. */
  format: string;
}
export interface SheetRowRead {
  /** The row's `r` attribute. */
  r: number;
  cells: SheetCellRead[];
}
export interface SheetRead {
  rows: SheetRowRead[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) =>
    String(ENTITIES[name]),
  );
}

/** Excel's built-in format codes for the ids a writer may use undeclared. */
const BUILT_IN: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
};

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : null;
}

/** The format code of each cell style (`s` index) in `xl/styles.xml`. */
function styleFormats(stylesXml: string | null): string[] {
  if (!stylesXml) return ["General"];
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*\/?>/g))
    custom.set(
      Number(attr(m[0], "numFmtId")),
      decode(attr(m[0], "formatCode") ?? ""),
    );
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!cellXfs) return ["General"];
  return [...cellXfs[1]!.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? "0");
    return custom.get(id) ?? BUILT_IN[id] ?? `numFmtId ${id}`;
  });
}

/** Decode `AD12` into a 0-based column and 1-based row. */
export function decodeCellRef(ref: string): { column: number; row: number } {
  const m = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref);
  if (!m) return { column: -1, row: -1 };
  let column = 0;
  for (const ch of m[1]!) column = column * 26 + (ch.charCodeAt(0) - 64);
  return { column: column - 1, row: Number(m[2]) };
}

/** Parse one worksheet part out of an XLSX package. Throws if it is absent. */
export async function readXlsxSheet(
  bytes: Uint8Array,
  sheetPath = "xl/worksheets/sheet1.xml",
): Promise<SheetRead> {
  const zip = await JSZip.loadAsync(bytes);
  const part = zip.file(sheetPath);
  if (!part) throw new Error(`the XLSX has no ${sheetPath}`);
  const xml = await part.async("string");
  const stylesPart = zip.file("xl/styles.xml");
  const formats = styleFormats(
    stylesPart ? await stylesPart.async("string") : null,
  );
  const rows: SheetRowRead[] = [];
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: SheetCellRead[] = [];
    for (const c of (row[2] ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const ref = attr(c[1]!, "r") ?? "";
      const t = attr(c[1]!, "t");
      const s = Number(attr(c[1]!, "s") ?? "0");
      const body = c[2] ?? "";
      const text =
        t === "inlineStr"
          ? [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
              .map((m) => decode(m[1]!))
              .join("")
          : decode(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      cells.push({
        ref,
        ...decodeCellRef(ref),
        type: t === "inlineStr" || t === "str" || t === "s" ? "text" : "number",
        value: text,
        format: formats[s] ?? `style ${s}`,
      });
    }
    rows.push({ r: Number(attr(row[1]!, "r") ?? "NaN"), cells });
  }
  return { rows };
}

/** Every cell of the sheet, keyed by its reference. */
export function cellsByRef(sheet: SheetRead): Map<string, SheetCellRead> {
  return new Map(
    sheet.rows.flatMap((row) => row.cells.map((c) => [c.ref, c] as const)),
  );
}

/**
 * What Excel would have to "repair": rows out of order, a cell filed under
 * the wrong row, a reference that does not parse, or cells in a row that are
 * not in strictly increasing column order (which is also how a duplicate
 * reference shows). Empty means well formed.
 */
export function sheetGridProblems(sheet: SheetRead): string[] {
  const problems: string[] = [];
  let lastRow = 0;
  for (const row of sheet.rows) {
    if (!(row.r > lastRow))
      problems.push(`row ${row.r} does not follow row ${lastRow}`);
    lastRow = row.r;
    let lastColumn = -1;
    for (const cell of row.cells) {
      if (cell.column < 0) problems.push(`cell ref "${cell.ref}" is malformed`);
      else if (cell.row !== row.r)
        problems.push(`cell ${cell.ref} sits in row ${row.r}`);
      else if (!(cell.column > lastColumn))
        problems.push(`cell ${cell.ref} is not right of the cell before it`);
      lastColumn = Math.max(lastColumn, cell.column);
    }
  }
  return problems;
}
