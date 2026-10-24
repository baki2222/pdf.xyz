import type { MarkGlyph, MarkObject, TextBoxObject, TextStyle } from "./model";

/**
 * Quick fields for filling in and signing any PDF, flat or not: the date,
 * initials, a name and a check mark, each placed with one click. The date,
 * initials and name are ordinary text boxes (movable, restyled, exported as
 * text a reader can select); a check mark or cross is a vector mark, because
 * the one shipped face that draws ✓ is a multi-megabyte CJK pack.
 */

export const DATE_FORMATS = ["dmy", "mdy", "iso", "long", "dmonthy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

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

const pad = (n: number) => String(n).padStart(2, "0");

/** A date as each format writes it. Months are English: the form alphabet is Latin. */
export function formatDate(date: Date, format: DateFormat): string {
  const d = date.getDate();
  const m = date.getMonth();
  const y = date.getFullYear();
  switch (format) {
    case "dmy":
      return `${pad(d)}/${pad(m + 1)}/${y}`;
    case "mdy":
      return `${pad(m + 1)}/${pad(d)}/${y}`;
    case "iso":
      return `${y}-${pad(m + 1)}-${pad(d)}`;
    case "long":
      return `${MONTHS[m]} ${d}, ${y}`;
    case "dmonthy":
      return `${d} ${MONTHS[m]!.slice(0, 3)} ${y}`;
  }
}

/** The format a locale reads first: month first in the US, day first elsewhere. */
export function defaultDateFormat(locale: string | undefined): DateFormat {
  return /^en-(us|ph)$/i.test(locale ?? "") ? "mdy" : "dmy";
}

/** "Baki Billah" → "BB"; "jean-luc picard" → "JLP". At most four letters. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => Array.from(w)[0]!.toUpperCase())
    .slice(0, 4)
    .join("");
}

export type QuickTextKind = "date" | "initials" | "name";

/**
 * A quick field's text box, one line, centred on the click and kept on the
 * page. `measure` is the width of the words as the export will set them.
 */
export function quickTextObject(
  id: string,
  page: number,
  at: { x: number; y: number },
  text: string,
  style: TextStyle,
  measure: (text: string) => number,
  pageSize: { width: number; height: number },
): TextBoxObject {
  const width = Math.min(pageSize.width, Math.ceil(measure(text)) + 4);
  const height = style.size * style.lineHeight;
  const x = Math.min(Math.max(0, at.x - width / 2), pageSize.width - width);
  const y = Math.min(Math.max(0, at.y - height / 2), pageSize.height - height);
  return { id, kind: "text", page, x, y, width, text, ...style };
}

/** Side of a placed check mark, points. */
export const MARK_SIZE = 16;

export function markObject(
  id: string,
  page: number,
  at: { x: number; y: number },
  glyph: MarkGlyph,
  color: string,
  pageSize: { width: number; height: number },
): MarkObject {
  const s = MARK_SIZE;
  return {
    id,
    kind: "mark",
    page,
    glyph,
    color,
    x: Math.min(Math.max(0, at.x - s / 2), pageSize.width - s),
    y: Math.min(Math.max(0, at.y - s / 2), pageSize.height - s),
    width: s,
    height: s,
  };
}
