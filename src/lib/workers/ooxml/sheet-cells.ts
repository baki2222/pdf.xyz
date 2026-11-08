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
/** Thousands grouping (1,250) or, consistently, Indian lakh grouping (1,25,000). */
const THOUSANDS = "\\d{1,3}(?:,\\d{3})+";
const LAKH = "\\d{1,2}(?:,\\d{2})+,\\d{3}";
const NUMBER = new RegExp(
  `^([-−])?([${CURRENCY}])?([-−])?(${THOUSANDS}|${LAKH}|\\d+)(?:\\.(\\d+))?(%)?$`,
  "u",
);
const IS_THOUSANDS = new RegExp(`^${THOUSANDS}$`);
const IS_LAKH = new RegExp(`^${LAKH}$`);
/** Excel keeps 15 significant digits; a longer number is an ID, not a value. */
export const MAX_SIGNIFICANT_DIGITS = 15;

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

/** One signed amount, before any accounting wrapper is applied. */
interface Amount {
  negative: boolean;
  /** Unsigned `<v>` digits. */
  value: string;
  /** The format for the amount shown as a positive number. */
  positive: string;
  /** Grouped, a fraction or a currency symbol: plainly an amount, not a mark. */
  amountShaped: boolean;
  percent: boolean;
  lakh: boolean;
}

function amountOf(text: string): Amount | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const [, sign1, currency, sign2, grouped, fraction = "", percent] = m;
  if (sign1 && sign2) return null;
  if (currency && percent) return null;
  const int = grouped!.replace(/,/g, "");
  if (int.length > 1 && int.startsWith("0")) return null;
  if ((int + fraction).replace(/^0+/, "").length > MAX_SIGNIFICANT_DIGITS)
    return null;
  const value = percent
    ? percentValue(int, fraction)
    : fraction
      ? `${int}.${fraction}`
      : int;
  const symbol = currency ? `"${currency}"` : "";
  const decimals = fraction ? `.${"0".repeat(fraction.length)}` : "";
  return {
    negative: !!(sign1 || sign2),
    value,
    positive:
      symbol +
      (grouped!.includes(",") ? "#,##0" : "0") +
      decimals +
      (percent ? "%" : ""),
    amountShaped: grouped!.includes(",") || !!fraction || !!currency,
    percent: !!percent,
    lakh: IS_LAKH.test(grouped!) && !IS_THOUSANDS.test(grouped!),
  };
}

/**
 * Indian lakh/crore grouping (1,25,000 and 1,00,00,000) as a display format.
 * Excel has no locale-free code for it, so this is the usual conditional
 * one: crore from 1,00,00,000, lakh from 1,00,000, thousands below. Past
 * 99 crore the leftmost group grows instead of splitting — a display limit,
 * never a value one.
 */
function lakhFormat(symbol: string, decimals: string): string {
  return `[>=10000000]${symbol}##\\,##\\,##\\,##0${decimals};[>=100000]${symbol}##\\,##\\,##0${decimals};${symbol}##,##0${decimals}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_NAME = new RegExp(
  `^(\\d{1,2}) (${MONTHS.join("|")}|${MONTHS.map((m) => m.slice(0, 3)).join("|")}) (\\d{4})$`,
);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Excel's day 0 in its 1900 date system (it counts a 29 Feb 1900 that never was). */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** Before this day Excel's phantom 29 Feb 1900 shifts every serial by one. */
const FIRST_SAFE_DAY = Date.UTC(1900, 2, 1);

/**
 * A date only when it cannot be read two ways and exists: ISO `2026-01-05`,
 * or a day, an English month name and a year (`12 March 2024`, `5 Jan
 * 2026`). `05/01/2026` is the 5th of January in one country and the 1st of
 * May in another, so it stays text.
 */
function parseSheetDate(text: string): SheetNumber | null {
  let year: number, month: number, day: number, format: string;
  const iso = ISO_DATE.exec(text);
  const named = iso ? null : MONTH_NAME.exec(text);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    format = "yyyy-mm-dd";
  } else if (named) {
    const name = named[2]!;
    day = Number(named[1]);
    year = Number(named[3]);
    month =
      (name.length === 3
        ? MONTHS.findIndex((m) => m.startsWith(name))
        : MONTHS.indexOf(name)) + 1;
    format = `${named[1]!.startsWith("0") ? "dd" : "d"} ${name.length === 3 ? "mmm" : "mmmm"} yyyy`;
  } else return null;
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day ||
    time < FIRST_SAFE_DAY
  )
    return null;
  return { value: String((time - EXCEL_EPOCH) / 86_400_000), format };
}

/**
 * The number a cell's WHOLE text denotes, or `null` when it is not
 * unambiguously one — in which case the cell stays text, exactly as printed.
 *
 * Deliberately narrow, because Excel's own guessing is what users fear:
 *  - grouping in the thousands shape `1,250.00` or, consistently, the lakh
 *    shape `1,25,000.00` (since 2026-11-08, audit pdf-to-excel#4: ₹ and ৳
 *    were accepted while the way amounts in them are printed was not); a
 *    mixed `1,234,56,789`, `1,25` and the European `1.250,00` stay text —
 *    no locale is guessed;
 *  - an accounting negative, `(1,250.00)` or `1,250.00-`, is negative — but
 *    only around something plainly an amount (grouped, a fraction or a
 *    currency symbol): a bare `(3)` is a note mark and stays text;
 *  - a date that cannot be read two ways and exists is a date
 *    ({@link parseSheetDate}); `05/01/2026` stays text;
 *  - a leading zero (`00123`, `0012`) is an ID or a code and stays text;
 *    `0` and `0.5` are numbers;
 *  - more than 15 significant digits stays text (an account number would
 *    otherwise lose its tail);
 *  - one leading currency symbol OR one trailing `%`, never both; ranges
 *    and anything else stay text.
 */
export function parseSheetNumber(text: string): SheetNumber | null {
  const date = parseSheetDate(text);
  if (date) return date;
  const bracketed = /^\((.+)\)$/.exec(text);
  const trailing = bracketed ? null : /^(.+)-$/.exec(text);
  const wrapped = bracketed ?? trailing;
  const amount = amountOf(wrapped ? wrapped[1]! : text);
  if (!amount) return null;
  if (wrapped) {
    if (amount.negative || amount.percent || !amount.amountShaped) return null;
    const p = amount.positive;
    return {
      value: `-${amount.value}`,
      format: bracketed ? `${p};(${p})` : `${p};${p}-`,
    };
  }
  const symbol = /^"[^"]+"/.exec(amount.positive)?.[0] ?? "";
  const decimals = /\.0+$/.exec(amount.positive)?.[0] ?? "";
  return {
    value: `${amount.negative ? "-" : ""}${amount.value}`,
    format:
      amount.lakh && !amount.negative
        ? lakhFormat(symbol, decimals)
        : amount.positive,
  };
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
