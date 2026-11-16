/**
 * #28 slice 3 (wraps): generated PDFs of tables whose cells wrap onto the
 * lines below them, and of the pages that must NOT be read as such tables.
 * The capture session (`scripts/capture-flow-image.ts`) runs each through
 * the worker image's own poppler; the captures are committed, unedited, in
 * `./poppler-samples-image.ts`.
 *
 * WHY A MODULE OF ITS OWN, not `./pdf-office-fixtures` (the brief's first
 * home for them): three real-poppler suites DISCOVER every zero-argument
 * `*Pdf` export of that module — Extract Tables' (`table-extract/
 * engine.poppler.test.ts`, which wants each to come back as no_tables or as
 * its drawn tables EXACTLY), PDF to PowerPoint's, and the table detector's
 * HEALTH — and Extract Tables reads a wrapped row as two rows by design
 * (guides/catalog.ts, PDF to Excel). Enrolling these there would turn a
 * suite red that no machine here runs (no poppler on the dev host or in
 * CI's unit job), for a behaviour this slice does not change.
 *
 * Every page is drawn from ONE exported spec, as a list of {@link Drawn}
 * items, and {@link drawnWords} reads the words back from the same items:
 * the drift check in `./poppler-samples-image.test.ts` compares a capture's
 * words with them, so a spec edited after the capture fails it.
 */
import { PDFDocument, type PDFFont } from "pdf-lib";
import { FONT_PACKS } from "@/lib/pdf/font-packs";
import { embedDrawingFont, embedFaceIfDrawable } from "@/lib/pdf/unicode-font";

/** One string drawn on a page: left- or right-aligned at `x`, baseline `y`. */
export interface Drawn {
  text: string;
  x: number;
  y: number;
  align?: "left" | "right" | "centre";
  bold?: boolean;
  size?: number;
  /** 0-based page index; 0 when absent. */
  page?: number;
}

/** A table whose cells may wrap, as drawn. */
export interface WrapTableSpec {
  /** Each column's anchor: a left edge, a right edge, or a centre. */
  columns: readonly { x: number; align: "left" | "right" | "centre" }[];
  /** Row 0 is the header (bold). `""` draws nothing. */
  rows: readonly (readonly string[])[];
  /** Continuation lines: `wraps[row][col]` are drawn under that cell. */
  wraps: Readonly<Record<number, Readonly<Record<number, readonly string[]>>>>;
  size: number;
  /** A continuation's baseline below the line above it. */
  linePitch: number;
  /** A row's first baseline below the LAST line of the row above. */
  rowPitch: number;
  /** The header's baseline. */
  top: number;
}

/**
 * {@link WrapTableSpec} as drawn items, and the baseline one row pitch
 * under its last line (where a line set directly below the table goes).
 */
export function tableItems(spec: WrapTableSpec): {
  items: Drawn[];
  below: number;
} {
  const items: Drawn[] = [];
  let y = spec.top;
  spec.rows.forEach((row, r) => {
    const bold = r === 0;
    let lines = 1;
    row.forEach((cell, c) => {
      const { x, align } = spec.columns[c]!;
      if (cell) items.push({ text: cell, x, y, align, bold, size: spec.size });
      const more = spec.wraps[r]?.[c] ?? [];
      more.forEach((line, k) =>
        items.push({
          text: line,
          x,
          y: y - (k + 1) * spec.linePitch,
          align,
          bold,
          size: spec.size,
        }),
      );
      lines = Math.max(lines, 1 + more.length);
    });
    y -= (lines - 1) * spec.linePitch + spec.rowPitch;
  });
  return { items, below: y };
}

/** The words of `items`, split on white space as a reader would. */
export function drawnWords(items: readonly Drawn[]): string[] {
  return items.flatMap((d) => d.text.split(/\s+/).filter(Boolean));
}

/**
 * Draw `items` on `pages` US Letter pages. `face` "bengali" draws every item
 * in the face `embedDrawingFont` picks for all of their text (the shipped
 * Bengali pack), bold or not; "embedded-latin" draws every item in the
 * shipped Noto Sans pack, EMBEDDED with its ToUnicode map, bold or not;
 * otherwise Helvetica and Helvetica-Bold (standard fonts, WinAnsi).
 */
export async function drawnPdf(
  items: readonly Drawn[],
  pages = 1,
  face: "latin" | "bengali" | "embedded-latin" = "latin",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const texts = items.map((d) => d.text);
  let regular: PDFFont;
  if (face === "embedded-latin") {
    const pack = FONT_PACKS.find((p) => p.id === "latin")!;
    const font = await embedFaceIfDrawable(doc, pack, texts);
    if (!font) throw new Error("Noto Sans cannot draw this text");
    regular = font;
  } else regular = await embedDrawingFont(doc, texts, "sans");
  const bold: PDFFont =
    face === "latin"
      ? await embedDrawingFont(doc, texts, "sans-bold")
      : regular;
  const sheets = Array.from({ length: pages }, () => doc.addPage([612, 792]));
  for (const d of items) {
    const font = d.bold ? bold : regular;
    const size = d.size ?? 10;
    const width = font.widthOfTextAtSize(d.text, size);
    const x =
      d.align === "right"
        ? d.x - width
        : d.align === "centre"
          ? d.x - width / 2
          : d.x;
    sheets[d.page ?? 0]!.drawText(d.text, { x, y: d.y, size, font });
  }
  return doc.save();
}

// ───────────────────────────── S3 / S4: the invoice ─────────────────────────

/**
 * U+00AD, built from its code point: an escape typed in source has reached
 * files as the raw, invisible character before (memory "invisible
 * characters in instruments").
 */
export const SOFT_HYPHEN = String.fromCharCode(0xad);

/** S3's columns: Item, Description flush left; Qty, Unit, Amount flush right. */
const INVOICE_COLUMNS = [
  { x: 50, align: "left" },
  { x: 110, align: "left" },
  { x: 380, align: "right" },
  { x: 450, align: "right" },
  { x: 530, align: "right" },
] as const;

/**
 * S3: an invoice whose descriptions wrap onto two and three lines — one
 * continuation in lower case after a four-word line (rule 4's shape), one
 * capitalised (no rule sees it), one after a letter-hyphen (`stain-` /
 * `less`, joined keeping its hyphen), one after a U+00AD soft hyphen
 * (`car` + U+00AD / `tridges`, a line-break artefact flow removes) — then a
 * Subtotal / VAT / Total block under Unit and Amount, then an amount-only
 * total alone under Amount.
 */
export const WRAPPED_INVOICE: WrapTableSpec = {
  columns: INVOICE_COLUMNS,
  rows: [
    ["Item", "Description", "Qty", "Unit", "Amount"],
    ["P-101", "Insulated stainless steel bottle", "2", "18.00", "36.00"],
    ["P-102", "Cotton tote bag", "5", "6.50", "32.50"],
    ["P-103", "Coffee dripper, stain-", "1", "24.00", "24.00"],
    ["P-104", `Water filter car${SOFT_HYPHEN}`, "3", "4.20", "12.60"],
    ["P-105", "Gasket", "10", "0.40", "4.00"],
  ],
  wraps: {
    1: { 1: ["with a bamboo lid"] },
    2: { 1: ["Natural colour", "Recycled fabric"] },
    3: { 1: ["less steel, two cups"] },
    4: { 1: ["tridges for jugs"] },
  },
  size: 10,
  linePitch: 12,
  rowPitch: 18,
  top: 680,
};

/** The lines S3 sets under its table: label under Unit, value under Amount. */
export const WRAPPED_INVOICE_TOTALS = [
  ["Subtotal", "109.10"],
  ["VAT 20%", "21.82"],
  ["Total", "130.92"],
] as const;
/** The amount-only total S3 ends on, alone under Amount. */
export const WRAPPED_INVOICE_LONE_TOTAL = "130.92";
/** S3 `stray`: a lone number under Description, one row pitch below P-105. */
export const WRAPPED_INVOICE_STRAY_NUMBER = "12";
/** S3 `amountNote`: a non-number continuation under P-102's Amount. */
export const WRAPPED_INVOICE_AMOUNT_NOTE = "incl. VAT";

/** S4: {@link WRAPPED_INVOICE} with EVERY description wrapping to 3 lines. */
export const WRAPPED_INVOICE_EVERY_ROW: WrapTableSpec = {
  ...WRAPPED_INVOICE,
  rows: [
    ["Item", "Description", "Qty", "Unit", "Amount"],
    ["P-101", "Insulated bottle", "2", "18.00", "36.00"],
    ["P-102", "Cotton tote bag", "5", "6.50", "32.50"],
    ["P-103", "Coffee dripper", "1", "24.00", "24.00"],
    ["P-104", "Water filter", "3", "4.20", "12.60"],
    ["P-105", "Gasket set", "10", "0.40", "4.00"],
  ],
  wraps: {
    1: { 1: ["Stainless steel", "Bamboo lid"] },
    2: { 1: ["Natural colour", "Recycled fabric"] },
    3: { 1: ["Ceramic body", "Two cups"] },
    4: { 1: ["Cartridge pack", "Fits most jugs"] },
    5: { 1: ["Rubber seals", "Assorted sizes"] },
  },
};

export interface WrappedInvoiceOptions {
  /** S4: every description wraps to three lines. */
  everyRow?: 3;
  /** A lone {@link WRAPPED_INVOICE_STRAY_NUMBER} under Description (mutation M2's bite). */
  stray?: boolean;
  /** {@link WRAPPED_INVOICE_AMOUNT_NOTE} under P-102's Amount (mutation M15's bite). */
  amountNote?: boolean;
  /**
   * Draw in the shipped Noto Sans, EMBEDDED, instead of Helvetica. Measured
   * on the image's poppler (22.12.0), 2026-11-16: Helvetica draws U+00AD
   * through WinAnsi 0xAD, whose glyph is `hyphen`, and poppler reads it
   * back as U+002D ("car-") — so the standard-font S3 never hands flow a
   * soft hyphen. This variant asks what an embedded face's ToUnicode does.
   */
  embedded?: boolean;
}

/** Every item {@link wrappedInvoicePdf} draws for `options`. */
export function wrappedInvoiceItems(
  options: WrappedInvoiceOptions = {},
): Drawn[] {
  const spec = options.everyRow ? WRAPPED_INVOICE_EVERY_ROW : WRAPPED_INVOICE;
  const withNote: WrapTableSpec = options.amountNote
    ? {
        ...spec,
        wraps: {
          ...spec.wraps,
          2: { ...spec.wraps[2], 4: [WRAPPED_INVOICE_AMOUNT_NOTE] },
        },
      }
    : spec;
  const { items, below } = tableItems(withNote);
  let y = below;
  if (options.stray) {
    items.push({ text: WRAPPED_INVOICE_STRAY_NUMBER, x: 110, y, size: 10 });
    y -= 18;
  }
  y -= 6;
  for (const [label, value] of WRAPPED_INVOICE_TOTALS) {
    items.push({ text: label, x: 450, y, align: "right", size: 10 });
    items.push({ text: value, x: 530, y, align: "right", size: 10 });
    y -= 18;
  }
  items.push({
    text: WRAPPED_INVOICE_LONE_TOTAL,
    x: 530,
    y,
    align: "right",
    size: 10,
  });
  return items;
}

/** S3 (and S4 with `everyRow: 3`): {@link wrappedInvoiceItems}. */
export async function wrappedInvoicePdf(
  options: WrappedInvoiceOptions = {},
): Promise<Uint8Array> {
  return drawnPdf(
    wrappedInvoiceItems(options),
    1,
    options.embedded ? "embedded-latin" : "latin",
  );
}

// ───────────────────────────── S5: the bank statement ───────────────────────

/**
 * S5: a bank statement — Date / Description / Debit / Credit / Balance —
 * whose descriptions wrap onto a reference line that starts with letters
 * and carries digits (`REF 88231 CARD 4421`), Debit and Credit alternately
 * empty beside them.
 */
export const BANK_STATEMENT: WrapTableSpec = {
  columns: [
    { x: 50, align: "left" },
    { x: 110, align: "left" },
    { x: 400, align: "right" },
    { x: 470, align: "right" },
    { x: 550, align: "right" },
  ],
  rows: [
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["01/03", "Card payment Tesco Stores", "42.10", "", "1,957.90"],
    ["02/03", "Salary ACME Ltd", "", "2,400.00", "4,357.90"],
    ["04/03", "Direct debit Council Tax", "130.00", "", "4,227.90"],
    ["05/03", "Transfer to savings", "500.00", "", "3,727.90"],
    ["07/03", "Refund Amazon Marketplace", "", "18.99", "3,746.89"],
  ],
  wraps: {
    1: { 1: ["REF 88231 CARD 4421"] },
    2: { 1: ["REF 10045 BACS"] },
    3: { 1: ["REF 55120 DD"] },
    5: { 1: ["REF 77310 CARD 4421"] },
  },
  size: 10,
  linePitch: 12,
  rowPitch: 18,
  top: 680,
};

/** S5: {@link BANK_STATEMENT}. */
export async function bankStatementPdf(): Promise<Uint8Array> {
  return drawnPdf(tableItems(BANK_STATEMENT).items);
}

// ───────────────────────────── S6 / S7: academic tables ─────────────────────

const ACADEMIC_COLUMNS = [
  { x: 50, align: "left" },
  { x: 300, align: "right" },
  { x: 390, align: "right" },
  { x: 470, align: "right" },
] as const;

/** S6: first-column row labels that wrap (the stated first-column limit). */
export const ACADEMIC_LABEL_WRAP: WrapTableSpec = {
  columns: ACADEMIC_COLUMNS,
  rows: [
    ["Measure", "Group A", "Group B", "p"],
    ["Accuracy (%)", "91.2", "88.4", "0.03"],
    ["Mean response", "412", "455", "0.01"],
    ["Error rate", "3.1", "4.7", "0.02"],
    ["Trials completed", "48", "47", "0.64"],
  ],
  wraps: { 2: { 0: ["time (ms)"] } },
  size: 10,
  linePitch: 12,
  rowPitch: 18,
  top: 680,
};

const MATURITY_COLUMNS = [
  { x: 50, align: "left" },
  { x: 160, align: "left" },
  { x: 330, align: "right" },
  { x: 450, align: "right" },
] as const;
const MATURITY_BODY = [
  ["1-year", "4.12", "35", "1,200"],
  ["2-year", "3.98", "41", "980"],
  ["5-year", "3.85", "52", "1,450"],
  ["10-year", "4.05", "60", "2,100"],
] as const;

/**
 * S7's variants, each a header row over {@link MATURITY_BODY}:
 *  - `header-wrap`: ONE header cell wraps ("Treasury" / "yield (%)", a text
 *    column of the header, not the first);
 *  - `header-wrap-figure`: ONE header cell of a figure column wraps
 *    ("Amount" / "(USD)", which holds no digit);
 *  - `header-wrap-pair`: both wrap on the same baselines — the continuation
 *    band then holds two cells, an ALIGNED band (brief §0's two-cell limit);
 *  - `header-bottom`: a bottom-aligned header whose upper line
 *    ("Treasury") sits ABOVE the header row ("constant maturities").
 */
export const ACADEMIC_HEADERS = {
  "header-wrap": {
    header: ["Term", "Treasury", "Spread", "Volume"],
    wraps: { 1: ["yield (%)"] },
    above: null,
  },
  "header-wrap-figure": {
    header: ["Term", "Treasury rate", "Spread", "Amount"],
    wraps: { 3: ["(USD)"] },
    above: null,
  },
  "header-wrap-pair": {
    header: ["Term", "Treasury", "Spread", "Amount"],
    wraps: { 1: ["yield (%)"], 3: ["(USD)"] },
    above: null,
  },
  "header-bottom": {
    header: ["Term", "constant maturities", "Spread", "Volume"],
    wraps: {},
    above: "Treasury",
  },
} as const;
export type AcademicVariant = "label-wrap" | keyof typeof ACADEMIC_HEADERS;

/** The spec {@link academicTablePdf} draws for `variant`. */
export function academicSpec(variant: AcademicVariant): WrapTableSpec {
  if (variant === "label-wrap") return ACADEMIC_LABEL_WRAP;
  const v = ACADEMIC_HEADERS[variant];
  return {
    columns: MATURITY_COLUMNS,
    rows: [v.header, ...MATURITY_BODY],
    wraps: { 0: v.wraps },
    size: 10,
    linePitch: 12,
    rowPitch: 18,
    top: 680,
  };
}

/** Every item {@link academicTablePdf} draws for `variant`. */
export function academicItems(variant: AcademicVariant): Drawn[] {
  const spec = academicSpec(variant);
  const { items } = tableItems(spec);
  const above =
    variant === "label-wrap" ? null : ACADEMIC_HEADERS[variant].above;
  if (above)
    items.push({
      text: above,
      x: MATURITY_COLUMNS[1].x,
      y: spec.top + spec.linePitch,
      bold: true,
      size: spec.size,
    });
  return items;
}

/** S6 (`label-wrap`) and S7 (the header variants). */
export async function academicTablePdf(
  variant: AcademicVariant,
): Promise<Uint8Array> {
  return drawnPdf(academicItems(variant));
}

// ───────────────────────────── S8: a form ───────────────────────────────────

/** S8: Label: / value pairs whose values wrap, and no column of figures. */
export const FORM_TABLE: WrapTableSpec = {
  columns: [
    { x: 50, align: "left" },
    { x: 160, align: "left" },
  ],
  rows: [
    ["Field", "Entry"],
    ["Name:", "Jane Doe"],
    ["Address:", "12 Market Street,"],
    ["Occupation:", "Senior research"],
    ["Notes:", "Prefers contact by"],
  ],
  wraps: {
    2: { 1: ["Leeds LS1 4AB"] },
    3: { 1: ["engineer"] },
    4: { 1: ["email after five"] },
  },
  size: 10,
  linePitch: 12,
  rowPitch: 18,
  top: 680,
};

/** S8: {@link FORM_TABLE}. */
export async function formTablePdf(): Promise<Uint8Array> {
  return drawnPdf(tableItems(FORM_TABLE).items);
}

// ───────────────────────────── S10 / S11: prose negatives ───────────────────

/**
 * S10: two columns of prose on shared baselines; the right column runs on
 * below the left column's end in SHORT lines — one-cell bands directly
 * under two-cell ones, the shape of a continuation, inside no table.
 */
export const TWO_COLUMN_SHORT_LINES = {
  left: [
    "The council met on Tuesday to discuss",
    "the new parking rules for the town",
    "centre and agreed to a trial period.",
  ],
  right: [
    "Residents raised concerns about the",
    "cost of permits and the loss of free",
    "spaces near the station and the",
    "market.",
    "A vote follows",
    "in March.",
  ],
} as const;

/** {@link TWO_COLUMN_SHORT_LINES}: left at x = 50, right at x = 320, 14pt apart. */
export function twoColumnShortLinesItems(): Drawn[] {
  const t = TWO_COLUMN_SHORT_LINES;
  return [
    ...t.left.map((text, i) => ({ text, x: 50, y: 700 - i * 14, size: 11 })),
    ...t.right.map((text, i) => ({ text, x: 320, y: 700 - i * 14, size: 11 })),
  ];
}

/** S10: {@link twoColumnShortLinesItems}. */
export async function twoColumnShortLinesPdf(): Promise<Uint8Array> {
  return drawnPdf(twoColumnShortLinesItems());
}

/**
 * S11: a paragraph beside a narrow column of figures (`Revenue` / `12.5`),
 * and under the figures the sidebar's own two-line note — prose lying
 * inside the figures column's span, under a run that may be a table.
 */
export const FIGURES_SIDEBAR = {
  paragraph: [
    "The company had a strong year with sales",
    "rising in every region and new stores",
    "opening on time across the north and the",
    "south, while costs stayed under control",
    "thanks to better purchasing and lower",
    "energy prices in the second half.",
  ],
  figures: [
    ["Revenue", "12.5"],
    ["Margin", "8%"],
    ["Growth", "3.1"],
  ],
  note: ["Figures are unaudited", "and rounded to one place"],
} as const;

/** {@link FIGURES_SIDEBAR}: paragraph at 50, figures at 380 and (right) 540. */
export function figuresSidebarItems(): Drawn[] {
  const f = FIGURES_SIDEBAR;
  const items: Drawn[] = f.paragraph.map((text, i) => ({
    text,
    x: 50,
    y: 700 - i * 14,
    size: 11,
  }));
  f.figures.forEach(([label, value], i) => {
    items.push({ text: label, x: 380, y: 700 - i * 14, size: 11 });
    items.push({
      text: value,
      x: 540,
      y: 700 - i * 14,
      align: "right",
      size: 11,
    });
  });
  f.note.forEach((text, i) =>
    items.push({
      text,
      x: 380,
      y: 700 - (f.figures.length + i) * 14,
      size: 11,
    }),
  );
  return items;
}

/** S11: {@link figuresSidebarItems}. */
export async function figuresSidebarPdf(): Promise<Uint8Array> {
  return drawnPdf(figuresSidebarItems());
}

// ───────────────────────────── S12: a wrapped table in a column ─────────────

/** S12's left-column table: Item / Description / Amount inside x 50–280. */
export const WRAPPED_TWO_COLUMN_TABLE: WrapTableSpec = {
  columns: [
    { x: 50, align: "left" },
    { x: 95, align: "left" },
    { x: 280, align: "right" },
  ],
  rows: [
    ["Item", "Description", "Amount"],
    ["K-1", "Desk lamp", "24.00"],
    ["K-2", "Office chair with", "149.00"],
    ["K-3", "Monitor stand", "39.50"],
    ["K-4", "Cable tray", "12.00"],
  ],
  wraps: { 2: { 1: ["lumbar support"] }, 3: { 1: ["Adjustable height"] } },
  size: 10,
  linePitch: 12,
  rowPitch: 18,
  top: 700,
};
/** S12's right column: prose at x = 320, one line every 12pt. */
export const WRAPPED_TWO_COLUMN_PROSE = [
  "Orders placed before noon ship the",
  "same day from our northern depot,",
  "and every item comes with a two",
  "year warranty that covers parts",
  "and labour for normal office use.",
  "Returns are free within thirty",
  "days of delivery.",
] as const;

/** {@link WRAPPED_TWO_COLUMN_TABLE} left and {@link WRAPPED_TWO_COLUMN_PROSE} right. */
export function wrappedTwoColumnPageItems(): Drawn[] {
  return [
    ...tableItems(WRAPPED_TWO_COLUMN_TABLE).items,
    ...WRAPPED_TWO_COLUMN_PROSE.map((text, i) => ({
      text,
      x: 320,
      y: 700 - i * 12,
      size: 10,
    })),
  ];
}

/** S12: {@link wrappedTwoColumnPageItems}. */
export async function wrappedTwoColumnPagePdf(): Promise<Uint8Array> {
  return drawnPdf(wrappedTwoColumnPageItems());
}

// ───────────────────────────── S13: a wrap across a page break ──────────────

/**
 * S13: a table at the foot of page 1 whose last row's description wraps
 * onto the first line of page 2, under the same column, above a sentence.
 */
export const WRAP_ACROSS_PAGES = {
  table: {
    columns: [
      { x: 72, align: "left" },
      { x: 160, align: "left" },
      { x: 460, align: "left" },
    ],
    rows: [
      ["Item", "Description", "Amount"],
      ["A-100", "Filter cartridge", "12.50"],
      ["B-200", "Service visit", "95.00"],
      ["C-300", "Replacement pump and housing", "48.00"],
    ],
    wraps: {},
    size: 10,
    linePitch: 12,
    rowPitch: 18,
    top: 110,
  } satisfies WrapTableSpec,
  continuation: "assembly for model X",
  closing: "Thank you for your order.",
} as const;

/** {@link WRAP_ACROSS_PAGES}: the continuation at the top of page 2. */
export function wrapAcrossPagesItems(): Drawn[] {
  const w = WRAP_ACROSS_PAGES;
  return [
    ...tableItems(w.table).items,
    { text: w.continuation, x: 160, y: 740, size: 10, page: 1 },
    { text: w.closing, x: 72, y: 700, size: 10, page: 1 },
  ];
}

/** S13: {@link wrapAcrossPagesItems}, two pages. */
export async function wrapAcrossPagesPdf(): Promise<Uint8Array> {
  return drawnPdf(wrapAcrossPagesItems(), 2);
}

// ───────────────────────────── S14: Bengali ─────────────────────────────────

/**
 * S14: a table whose Bengali descriptions wrap. Bengali has no letter case,
 * so flow.ts rule 4 sees nothing; only geometry can absorb the lines. Drawn
 * in the shipped Bengali face (`embedDrawingFont` picks it for this text);
 * the header in the same face, not bold.
 */
export const WRAPPED_BENGALI_TABLE: WrapTableSpec = {
  columns: [
    { x: 72, align: "left" },
    { x: 160, align: "left" },
    { x: 460, align: "left" },
  ],
  rows: [
    ["Item", "বিবরণ", "Amount"],
    ["A-100", "সবুজ চায়ের পাতা", "120.00"],
    ["B-200", "মাটির তৈরি পানির", "350.00"],
    ["C-300", "হাতে বোনা কাপড়ের", "480.00"],
    ["D-400", "মধু", "95.00"],
  ],
  wraps: { 2: { 1: ["বোতল ও ঢাকনা"] }, 3: { 1: ["ব্যাগ"] } },
  size: 10,
  linePitch: 14,
  rowPitch: 20,
  top: 680,
};

/** S14: {@link WRAPPED_BENGALI_TABLE} in the Bengali face. */
export async function wrappedBengaliTablePdf(): Promise<Uint8Array> {
  return drawnPdf(
    tableItems(WRAPPED_BENGALI_TABLE).items.map((d) => ({ ...d, bold: false })),
    1,
    "bengali",
  );
}

// ───────────────────────────── S16: notes under a table ─────────────────────

/** S16's table: Item / Description / Amount, no wraps. */
export const TABLE_NOTE_TABLE: WrapTableSpec = {
  columns: [
    { x: 72, align: "left" },
    { x: 160, align: "left" },
    { x: 460, align: "right" },
  ],
  rows: [
    ["Item", "Description", "Amount"],
    ["A-100", "Filter cartridge", "12.50"],
    ["B-200", "Service visit", "95.00"],
    ["C-300", "Gasket", "3.25"],
  ],
  wraps: {},
  size: 10,
  linePitch: 12,
  rowPitch: 18,
  top: 680,
};
/** The note S16 centres under Description. */
export const TABLE_NOTE = "Prices exclude VAT";
/** The caption S16 `caption` centres between two tables. */
export const TABLE_NOTE_CAPTION = "Table 2";
/** S16 `caption`'s second table, at the first one's columns. */
export const TABLE_NOTE_SECOND: readonly (readonly string[])[] = [
  ["Item", "Description", "Amount"],
  ["E-500", "Hose clamp", "1.75"],
  ["F-600", "Pressure valve", "22.40"],
];

/**
 * S16 (brief §2.7): a one-line note centred under Description `1.0` or
 * `1.5` row pitches below the last row — the false-absorb risk the rules
 * cannot exclude below the last row — and (`caption`) a second table whose
 * centred caption sits one row pitch below the first.
 */
export type TableNoteVariant = "note-1.0" | "note-1.5" | "caption";

/** Every item {@link tableNotePdf} draws for `variant`. */
export function tableNoteItems(variant: TableNoteVariant): Drawn[] {
  const spec = TABLE_NOTE_TABLE;
  const { items, below } = tableItems(spec);
  const centre = 240;
  if (variant === "caption") {
    items.push({
      text: TABLE_NOTE_CAPTION,
      x: centre,
      y: below,
      align: "centre",
      size: 10,
    });
    const second = tableItems({
      ...spec,
      rows: TABLE_NOTE_SECOND,
      top: below - spec.rowPitch,
    });
    items.push(...second.items);
    return items;
  }
  const pitches = variant === "note-1.0" ? 1 : 1.5;
  items.push({
    text: TABLE_NOTE,
    x: centre,
    y: below + spec.rowPitch - pitches * spec.rowPitch,
    align: "centre",
    size: 10,
  });
  return items;
}

/** S16: {@link tableNoteItems}. */
export async function tableNotePdf(
  variant: TableNoteVariant,
): Promise<Uint8Array> {
  return drawnPdf(tableNoteItems(variant));
}

// ──────────────── S17: a one-line band of its own between two rows ──────────

/**
 * S17's three shapes (review of rule 7, 2026-11-16): a one-cell line in a
 * non-first, non-figure column, set between two rows of a table one row
 * pitch from each, in a poppler block of its OWN. Under any row but the
 * last, slice 3 first absorbed such a line into the row above (the block
 * condition was checked under the last row only), merging two tables into
 * one and folding the line into a data cell.
 *
 * - `subheading`: "Spare parts" under Description, left-aligned like the
 *   column, between two groups of parts;
 * - `midnote`: a note centred under Description between the parts and the
 *   Total / Paid / Due lines;
 * - `blankfirst`: a statement row whose only cell is its description
 *   ("Interest credited": no date, no amount).
 */
export type TableInterruptVariant = "subheading" | "midnote" | "blankfirst";

/** S17: each variant's rows above the line, the line, and the rows below. */
export const TABLE_INTERRUPT: Readonly<
  Record<
    TableInterruptVariant,
    {
      spec: WrapTableSpec;
      line: { text: string; x: number; align: "left" | "centre" };
      below: readonly (readonly string[])[];
    }
  >
> = {
  subheading: {
    spec: {
      ...TABLE_NOTE_TABLE,
      rows: [
        ["Item", "Description", "Amount"],
        ["A-100", "Filter cartridge", "12.50"],
        ["B-200", "Service visit", "95.00"],
      ],
    },
    line: { text: "Spare parts", x: 160, align: "left" },
    below: [
      ["C-300", "Gasket", "3.25"],
      ["D-400", "Hose clamp", "1.75"],
      ["E-500", "Pressure valve", "22.40"],
    ],
  },
  midnote: {
    spec: {
      ...TABLE_NOTE_TABLE,
      rows: [
        ["Item", "Description", "Amount"],
        ["A-100", "Filter cartridge", "12.50"],
        ["B-200", "Service visit", "95.00"],
        ["C-300", "Gasket", "3.25"],
      ],
    },
    line: { text: TABLE_NOTE, x: 240, align: "centre" },
    below: [
      ["Total", "", "110.75"],
      ["Paid", "", "110.75"],
      ["Due", "", "0.00"],
    ],
  },
  blankfirst: {
    spec: {
      ...TABLE_NOTE_TABLE,
      rows: [
        ["Date", "Description", "Amount"],
        ["02-01", "Opening balance", "100.00"],
        ["02-02", "Card payment", "12.50"],
      ],
    },
    line: { text: "Interest credited", x: 160, align: "left" },
    below: [
      ["02-03", "Transfer in", "250.00"],
      ["02-04", "Standing order", "40.00"],
      ["02-05", "Card payment", "8.99"],
    ],
  },
};

/** Every item {@link tableInterruptPdf} draws for `variant`. */
export function tableInterruptItems(variant: TableInterruptVariant): Drawn[] {
  const { spec, line, below } = TABLE_INTERRUPT[variant];
  const upper = tableItems(spec);
  const lower = tableItems({
    ...spec,
    rows: below,
    top: upper.below - spec.rowPitch,
  });
  return [
    ...upper.items,
    { ...line, y: upper.below, size: spec.size },
    ...lower.items.map((d) => ({ ...d, bold: false })),
  ];
}

/** S17: {@link tableInterruptItems}. */
export async function tableInterruptPdf(
  variant: TableInterruptVariant,
): Promise<Uint8Array> {
  return drawnPdf(tableInterruptItems(variant));
}
