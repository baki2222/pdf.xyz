/**
 * SpreadsheetML cells, written ONE way for every XLSX this worker produces.
 *
 * Two engines write workbooks — PDF to Excel (`../pdf-office-export`) and
 * Extract Tables (`../table-extract`). They used to carry a cell writer each,
 * and the copies disagreed: Extract Tables wrote base-26 column letters
 * (A…Z, AA…), PDF to Excel clamped every column past Z onto `Z`, so a wide
 * row came out as `Z1 Z1 Z1` — duplicate refs, which Excel "repairs" by
 * dropping cells. Both also stored every cell as text, so `SUM` over a
 * converted invoice returned 0. One module now owns the reference, the cell
 * and the number rules, and both engines import it.
 */

export const SHEET_MAIN_NS =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** A1-style column letters for a 0-based column index: 0 → A, 25 → Z, 26 → AA. */
export function columnRef(index: number): string {
  if (!Number.isInteger(index) || index < 0)
    throw new RangeError(`column index must be a non-negative integer`);
  let ref = "";
  let n = index;
  do {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return ref;
}

/**
 * Characters XML 1.0 cannot carry at all, escaped or not. One of them in a
 * cell makes Excel refuse the whole workbook, and extracted PDF text does
 * contain stray control characters.
 */
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function xmlEscape(value: string): string {
  return value
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A cell's text read as a number: the value Excel stores, and how to show it. */
export interface SheetNumber {
  /** The `<v>` content: plain decimal digits, no grouping, no symbol. */
  value: string;
  /** The number format that shows `value` the way the source text did. */
  format: string;
}

const CURRENCY = "$£€¥₹৳";
const NUMBER = new RegExp(
  `^([-−])?([${CURRENCY}])?([-−])?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?(%)?$`,
  "u",
);
/** Excel keeps 15 significant digits; a longer number is an ID, not a value. */
const MAX_SIGNIFICANT_DIGITS = 15;

/** Move the decimal point two places left, exactly (no floating point). */
function percentValue(int: string, frac: string): string {
  const digits = int + frac;
  const point = int.length - 2;
  const shifted =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return shifted
    .replace(/^0+(?=\d)/, "")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/**
 * The number a cell's WHOLE text denotes, or `null` when it is not
 * unambiguously one — in which case the cell stays text, exactly as printed.
 *
 * Deliberately narrow, because Excel's own guessing is what users fear:
 *  - thousands grouping only in the `1,250.00` shape (groups of three); `1,25`
 *    and the European `1.250,00` stay text — no locale is guessed;
 *  - a leading zero (`00123`, `0012`) is an ID or a code and stays text;
 *    `0` and `0.5` are numbers;
 *  - more than 15 significant digits stays text (an account number would
 *    otherwise lose its tail);
 *  - one leading currency symbol OR one trailing `%`, never both; dates,
 *    ranges, parenthesised negatives and anything else stay text.
 */
export function parseSheetNumber(text: string): SheetNumber | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const [, sign1, currency, sign2, grouped, fraction = "", percent] = m;
  if (sign1 && sign2) return null;
  if (currency && percent) return null;
  const int = grouped!.replace(/,/g, "");
  if (int.length > 1 && int.startsWith("0")) return null;
  if ((int + fraction).replace(/^0+/, "").length > MAX_SIGNIFICANT_DIGITS)
    return null;
  const negative = sign1 || sign2 ? "-" : "";
  const value = percent
    ? percentValue(int, fraction)
    : fraction
      ? `${int}.${fraction}`
      : int;
  const format =
    (currency ? `"${currency}"` : "") +
    (grouped!.includes(",") ? "#,##0" : "0") +
    (fraction ? `.${"0".repeat(fraction.length)}` : "") +
    (percent ? "%" : "");
  return { value: `${negative}${value}`, format };
}

/** Excel's built-in number formats this writer can use without declaring. */
const BUILT_IN_FORMATS: Record<string, number> = {
  "0": 1,
  "0.00": 2,
  "#,##0": 3,
  "#,##0.00": 4,
  "0%": 9,
  "0.00%": 10,
};
const FIRST_CUSTOM_FORMAT_ID = 164;

/**
 * The workbook's number formats, collected while its sheets are written.
 * Cell style 0 is General; every other style applies one number format.
 */
export class SheetStyles {
  private readonly styles: number[] = [0];
  private readonly custom = new Map<string, number>();
  private readonly byFormat = new Map<string, number>();

  /** The `s` attribute value for a number format. */
  styleFor(format: string): number {
    const known = this.byFormat.get(format);
    if (known !== undefined) return known;
    let id = BUILT_IN_FORMATS[format];
    if (id === undefined) {
      id = FIRST_CUSTOM_FORMAT_ID + this.custom.size;
      this.custom.set(format, id);
    }
    this.styles.push(id);
    const style = this.styles.length - 1;
    this.byFormat.set(format, style);
    return style;
  }

  /** `xl/styles.xml`. Always written, so the package never depends on luck. */
  xml(): string {
    const numFmts = this.custom.size
      ? `<numFmts count="${this.custom.size}">${[...this.custom]
          .map(
            ([code, id]) =>
              `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`,
          )
          .join("")}</numFmts>`
      : "";
    const xfs = this.styles
      .map((id, i) =>
        i === 0
          ? `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
          : `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${SHEET_MAIN_NS}">${numFmts}<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.styles.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

/** The `[Content_Types].xml` override for the part {@link SheetStyles.xml} writes. */
export const STYLES_CONTENT_TYPE_OVERRIDE = `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`;
/** The workbook relationship to `xl/styles.xml`. */
export function stylesRelationship(id: string): string {
  return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
}

/** One cell: a number when the whole text is one, otherwise the text itself. */
export function sheetCell(
  ref: string,
  text: string,
  styles: SheetStyles,
): string {
  const number = parseSheetNumber(text);
  if (number) {
    const style = styles.styleFor(number.format);
    return `<c r="${ref}" s="${style}"><v>${number.value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

/**
 * A worksheet from rows of cells. An empty or missing cell writes nothing, so
 * it stays empty IN ITS OWN COLUMN — the index in the row is the column.
 */
export function worksheetXml(
  rows: readonly (readonly (string | null | undefined)[])[],
  styles: SheetStyles,
): string {
  const sheetData = rows
    .map((row, ri) => {
      const cells = row
        .map((text, ci) =>
          text ? sheetCell(`${columnRef(ci)}${ri + 1}`, text, styles) : "",
        )
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${SHEET_MAIN_NS}"><sheetData>${sheetData}</sheetData></worksheet>`;
}
