/**
 * Generated PDFs for the PDF to Office export tests, and a way to find a REAL
 * poppler `pdftotext` to run them through.
 *
 * Every fixture is built here, so a test can say exactly what is on the page.
 * The encrypted ones are written by hand because pdf-lib cannot encrypt: the
 * Standard security handler, revision 2 (RC4, 40-bit), which every PDF reader
 * and poppler build accepts. That is enough for the property under test —
 * "needs a password to open" versus "encrypted but opens" — and small enough
 * to read.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
// Through the product's font chooser, like every other text-drawing module:
// for this Latin text it picks the same Helvetica faces, so the captured
// poppler samples match these fixtures byte for byte in their geometry.
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { cellsByRef, type SheetRead } from "@/lib/workers/ooxml/sheet-read";

/** The left column of {@link twoColumnReportPdf}, one printed line each. */
export const LEFT_COLUMN = [
  "The quarterly results show that revenue",
  "grew by twelve percent while operating",
  "costs fell for the third straight quarter.",
] as const;
/** The right column, drawn on the same baselines as the left. */
export const RIGHT_COLUMN = [
  "Risks include currency exposure in the",
  "European segment and supplier delays",
  "that may affect the next two quarters.",
] as const;

/** A report page: a title, then two columns of prose on shared baselines. */
export async function twoColumnReportPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [...LEFT_COLUMN, ...RIGHT_COLUMN]);
  const bold = await embedDrawingFont(doc, ["Quarterly Report"], "sans-bold");
  const page = doc.addPage([612, 792]);
  page.drawText("Quarterly Report", { x: 50, y: 740, size: 18, font: bold });
  LEFT_COLUMN.forEach((line, i) =>
    page.drawText(line, { x: 50, y: 690 - i * 14, size: 11, font }),
  );
  RIGHT_COLUMN.forEach((line, i) =>
    page.drawText(line, { x: 320, y: 690 - i * 14, size: 11, font }),
  );
  return doc.save();
}

/** The grid {@link quarterlyTablePdf} draws, row by row. */
export const TABLE_ROWS = [
  ["Region", "Q1", "Q2", "Q3"],
  ["North", "1200", "1350", "1410"],
  ["South", "980", "1020", "1100"],
] as const;

/** A 4×3 table with no rules — cells placed on a grid, nothing else. */
export async function quarterlyTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, TABLE_ROWS.flat());
  const page = doc.addPage([612, 792]);
  TABLE_ROWS.forEach((row, r) =>
    row.forEach((cell, c) =>
      page.drawText(cell, { x: 50 + c * 110, y: 700 - r * 16, size: 11, font }),
    ),
  );
  return doc.save();
}

/**
 * A label / amount statement, drawn the way an income statement, a bank
 * statement or an invoice summary is: labels flush left, amounts flush RIGHT
 * on a shared edge, and some labels of four or more words. The first paragraph
 * rule shipped for PDF to Word read a band holding one long label and one
 * amount as prose (half its cells "long"), so no run of table rows formed and
 * poppler's reading order printed every label, then every amount.
 */
export const STATEMENT_ROWS = [
  ["Revenue", "12,400"],
  ["Cost of goods sold", "7,100"],
  ["Gross profit", "5,300"],
  ["Selling and admin expenses", "2,900"],
  ["Operating income", "2,400"],
  ["Interest paid on bank loans", "300"],
  ["Net income", "2,100"],
] as const;

/** {@link STATEMENT_ROWS}, amounts right-aligned at x = 480. */
export async function incomeStatementPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, STATEMENT_ROWS.flat());
  const page = doc.addPage([612, 792]);
  STATEMENT_ROWS.forEach(([label, amount], r) => {
    const y = 700 - r * 16;
    page.drawText(label, { x: 50, y, size: 11, font });
    page.drawText(amount, {
      x: 480 - font.widthOfTextAtSize(amount, 11),
      y,
      size: 11,
      font,
    });
  });
  return doc.save();
}

/** A two-column table whose second column is a line of text, not a value. */
export const SKU_ROWS = [
  ["SKU", "Description"],
  ["A-100", "Stainless steel water bottle with a bamboo lid"],
  ["B-200", "Recycled cotton tote bag in a natural colour"],
  ["C-300", "Ceramic pour-over coffee dripper, white"],
] as const;

/** {@link SKU_ROWS}: codes at x = 50, descriptions at x = 150. */
export async function skuTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, SKU_ROWS.flat());
  const page = doc.addPage([612, 792]);
  SKU_ROWS.forEach(([sku, description], r) => {
    const y = 700 - r * 16;
    page.drawText(sku, { x: 50, y, size: 11, font });
    page.drawText(description, { x: 150, y, size: 11, font });
  });
  return doc.save();
}

/**
 * A two-column newsletter whose paragraphs END on short lines at the same
 * height, above section headings aligned across the columns. Two consecutive
 * bands of short aligned lines is what the first paragraph rule called a
 * table: it pulled those lines out of their paragraphs and wrote
 * `"it went well.\tfeedback was great."` — the columns interleaved again.
 * Each entry is one paragraph, one printed line per string.
 */
export const NEWSLETTER_LEFT = [
  [
    "Our team spent the last quarter rebuilding",
    "the upload flow from the ground up, and",
    "it went well.",
  ],
  ["Next steps"],
  [
    "We will ship the new editor in two phases",
    "and measure how people use each one.",
  ],
] as const;
export const NEWSLETTER_RIGHT = [
  [
    "Customers noticed the faster uploads within",
    "days, the support queue shrank, and the",
    "feedback was great.",
  ],
  ["Open issues"],
  [
    "Search inside very large files is still slow",
    "and the fix needs a new kind of index.",
  ],
] as const;

/** {@link NEWSLETTER_LEFT} at x = 50 and {@link NEWSLETTER_RIGHT} at x = 320. */
export async function newsletterPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const all = [...NEWSLETTER_LEFT.flat(), ...NEWSLETTER_RIGHT.flat()];
  const font = await embedDrawingFont(doc, all);
  const bold = await embedDrawingFont(doc, all, "sans-bold");
  const page = doc.addPage([612, 792]);
  for (const [x, column] of [
    [50, NEWSLETTER_LEFT],
    [320, NEWSLETTER_RIGHT],
  ] as const) {
    let y = 700;
    column.forEach((paragraph, p) => {
      const heading = p === 1;
      if (p > 0) y -= 14;
      for (const line of paragraph) {
        page.drawText(line, {
          x,
          y,
          size: heading ? 12 : 11,
          font: heading ? bold : font,
        });
        y -= heading ? 18 : 14;
      }
    });
  }
  return doc.save();
}

/**
 * A paragraph with a narrow list beside it, every line on a shared baseline:
 * the list's column is all short values, which is table evidence on its own,
 * so this is what tells a table from running text set next to a list.
 */
export const SIDEBAR_MAIN = [
  "The board approved the budget for next year",
  "after a long debate about hiring, and asked",
  "the finance team to report back every month",
  "on how the new spending plan is working out.",
] as const;
export const SIDEBAR_LIST = [
  "Editor",
  "Jane Doe",
  "Design",
  "Sam Lee",
] as const;

/** {@link SIDEBAR_MAIN} at x = 50, {@link SIDEBAR_LIST} at x = 400. */
export async function sidebarPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [...SIDEBAR_MAIN, ...SIDEBAR_LIST]);
  const page = doc.addPage([612, 792]);
  SIDEBAR_MAIN.forEach((line, i) =>
    page.drawText(line, { x: 50, y: 700 - i * 14, size: 11, font }),
  );
  SIDEBAR_LIST.forEach((line, i) =>
    page.drawText(line, { x: 400, y: 700 - i * 14, size: 11, font }),
  );
  return doc.save();
}

/**
 * Two columns of one-line sentences, each starting with a capital, on shared
 * baselines: no line continues onto the next, so only the absence of a column
 * of short VALUES says this is not a table.
 */
export const HIGHLIGHTS_LEFT = [
  "Revenue grew twelve percent over the year.",
  "Costs fell for the third straight quarter.",
  "Hiring stayed flat in every single region.",
] as const;
export const HIGHLIGHTS_RIGHT = [
  "Currency exposure remains the largest risk.",
  "Supplier delays may slow the next launch.",
  "Cash reserves cover two full years of costs.",
] as const;

/** {@link HIGHLIGHTS_LEFT} at x = 50, {@link HIGHLIGHTS_RIGHT} at x = 320. */
export async function highlightsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [
    ...HIGHLIGHTS_LEFT,
    ...HIGHLIGHTS_RIGHT,
  ]);
  const page = doc.addPage([612, 792]);
  HIGHLIGHTS_LEFT.forEach((line, i) =>
    page.drawText(line, { x: 50, y: 700 - i * 14, size: 11, font }),
  );
  HIGHLIGHTS_RIGHT.forEach((line, i) =>
    page.drawText(line, { x: 320, y: 700 - i * 14, size: 11, font }),
  );
  return doc.save();
}

/**
 * Two columns whose paragraphs end on a SHORT sentence that starts with a
 * capital, above bold headings aligned across the columns. Unlike
 * {@link NEWSLETTER_LEFT}, nothing on the short lines starts in lowercase, so
 * nothing about them says "this continues the line above". The first
 * paragraph rule (2e76d92) wrote `"Costs fell.\tAlso tariffs."` and then
 * `"Outlook\tSummary"` — each paragraph's last line cut off, and the right
 * column's heading before the left column's body.
 */
export const HEADINGS_LEFT = [
  [
    "Sales rose in every region this year and the",
    "new stores opened on time and on budget.",
    "Costs fell.",
  ],
  ["Outlook"],
  [
    "We expect growth to continue next year as",
    "the second factory comes online in spring.",
  ],
] as const;
export const HEADINGS_RIGHT = [
  [
    "Prices for raw materials stayed high all year",
    "and cut margins in the second half again.",
    "Also tariffs.",
  ],
  ["Summary"],
  [
    "The board will review the dividend in March",
    "once the audited accounts are complete.",
  ],
] as const;

/**
 * Two columns of BULLETED lists under bold headings, items on shared
 * baselines. Every item is short, so every row looks like a table row with a
 * column of values: 9c73735 wrote `"• Strong cash\t- Currency swings"`, the
 * two lists interleaved item by item.
 */
export const LISTS_LEFT = [
  ["Strengths"],
  ["• Strong cash"],
  ["• Low debt"],
  ["• Loyal customers"],
] as const;
export const LISTS_RIGHT = [
  ["Risks"],
  ["- Currency swings"],
  ["- Supplier delays"],
  ["- New rivals"],
] as const;

/**
 * Two columns of paragraphs, `headed[i]` set bold and 12pt with space above,
 * the way {@link newsletterPdf} sets them.
 */
async function columnsPdf(
  columns: readonly (readonly (readonly string[])[])[],
  headed: (paragraph: number) => boolean,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const all = columns.flat(2);
  const font = await embedDrawingFont(doc, all);
  const bold = await embedDrawingFont(doc, all, "sans-bold");
  const page = doc.addPage([612, 792]);
  columns.forEach((column, c) => {
    let y = 700;
    column.forEach((paragraph, p) => {
      const heading = headed(p);
      if (p > 0 && heading) y -= 14;
      for (const line of paragraph) {
        page.drawText(line, {
          x: 50 + c * 270,
          y,
          size: heading ? 12 : 11,
          font: heading ? bold : font,
        });
        y -= heading ? 18 : 14;
      }
    });
  });
  return doc.save();
}

/** {@link HEADINGS_LEFT} at x = 50 and {@link HEADINGS_RIGHT} at x = 320. */
export async function columnHeadingsPdf(): Promise<Uint8Array> {
  return columnsPdf([HEADINGS_LEFT, HEADINGS_RIGHT], (p) => p === 1);
}

/** {@link LISTS_LEFT} at x = 50 and {@link LISTS_RIGHT} at x = 320. */
export async function columnListsPdf(): Promise<Uint8Array> {
  return columnsPdf([LISTS_LEFT, LISTS_RIGHT], (p) => p === 0);
}

/**
 * A one-column letter set the hard way for a paragraph rule: ONE font, ONE
 * size, ONE line pitch, no space between paragraphs — so poppler reads the
 * whole letter as one block and only the lines themselves say where a
 * paragraph ends. Each entry is one paragraph, one printed line per string.
 *
 * {@link LETTER_JUSTIFIED} paragraphs are set full measure, their LAST line
 * included, so a break after them can only come from what follows (a heading,
 * a list item), and a full line ending in a full stop INSIDE one ("…last
 * week.") must not end the paragraph. Every paragraph rule in
 * `src/lib/workers/pdf-text/flow.ts` decides at least one break here on its
 * own: the salutation's comma, the heading after a full line, the numbered
 * and bulleted items after full lines, "Bar hours" before a capitalised line,
 * the closing.
 */
export const LETTER = [
  ["Dear Ms Smith,"],
  [
    "Thank you for your letter of 3 March about the club accounts and the",
    "proposals for next year, which the committee discussed at length last week.",
    "It agreed to put three changes to the members at the annual meeting in May.",
  ],
  ["Proposals"],
  ["1. Raise the membership fee by five percent from January to cover costs."],
  ["2. Hold two general meetings each year."],
  ["3. Publish the accounts online."],
  ["Bar hours"],
  [
    "We will also keep the bar open later on match days, as many members asked:",
  ],
  ["• a trial for three months,"],
  ["• then a vote at the next meeting."],
  ["Yours sincerely,"],
  ["John Doe"],
] as const;
/** Indexes into {@link LETTER} of the paragraphs set justified, full measure. */
export const LETTER_JUSTIFIED: ReadonlySet<number> = new Set([1, 3, 7]);
/** The measure {@link letterPdf} justifies to, in points. */
const LETTER_MEASURE = 500;

/** {@link LETTER} at x = 50, 11pt Helvetica, every line 14pt below the last. */
export async function letterPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, LETTER.flat());
  const page = doc.addPage([612, 792]);
  let y = 740;
  LETTER.forEach((paragraph, p) => {
    for (const line of paragraph) {
      if (!LETTER_JUSTIFIED.has(p)) {
        page.drawText(line, { x: 50, y, size: 11, font });
      } else {
        // Word by word, the slack shared out between the gaps.
        const words = line.split(" ");
        const inked = words.reduce(
          (sum, w) => sum + font.widthOfTextAtSize(w, 11),
          0,
        );
        const gap = (LETTER_MEASURE - inked) / (words.length - 1);
        let x = 50;
        for (const word of words) {
          page.drawText(word, { x, y, size: 11, font });
          x += font.widthOfTextAtSize(word, 11) + gap;
        }
      }
      y -= 14;
    }
  });
  return doc.save();
}

/**
 * A scan with a typed line: `textPages` get `stamp` as their only text, every
 * other page is a grey rectangle standing in for a scanned image — no text at
 * all, which is what a scan is to a text extractor.
 */
export async function partlyScannedPdf(
  pageCount: number,
  textPages: readonly number[],
  stamp = "RECEIVED 2026-09-01 BATES 000123",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [stamp]);
  for (let n = 1; n <= pageCount; n += 1) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({
      x: 40,
      y: 40,
      width: 532,
      height: 680,
      color: rgb(0.85, 0.85, 0.85),
    });
    if (textPages.includes(n))
      page.drawText(stamp, { x: 50, y: 750, size: 10, font });
  }
  return doc.save();
}

// ───────────────────────────── PDF to Excel ─────────────────────────────────

/** The two lines {@link invoicePdf} prints above its table. */
export const INVOICE_HEADING = [
  "Invoice",
  "Acme Supplies, 12 Market Street",
] as const;
/**
 * The table {@link invoicePdf} draws, as printed; `""` draws nothing. Built
 * from the shapes PDF to Excel shipped broken: a thousands separator, a comma
 * inside text, an EMPTY middle cell, a Total row with two empty cells, a code
 * with a leading zero, and currency.
 */
export const INVOICE_ROWS = [
  ["Invoice No", "Date", "Description", "Qty", "Amount"],
  ["1001", "2026-01-05", "Widgets, blue", "2", "1,250.00"],
  ["1002", "2026-01-06", "", "5", "$3,400.50"],
  ["00123", "2026-01-07", "Smith, John", "12", "980.25"],
  ["Total", "", "", "19", "$5,630.75"],
] as const;

/**
 * {@link INVOICE_ROWS} with the last row printed as its amount alone: the
 * unlabeled grand total, balance brought forward or amount-only continuation
 * line that invoices and statements end on. `-layout` prints it as spaces and
 * one number, a line with a single text run.
 */
export const INVOICE_LONE_TOTAL_ROWS: readonly (readonly string[])[] = [
  ...INVOICE_ROWS.slice(0, -1),
  INVOICE_ROWS[INVOICE_ROWS.length - 1]!.map((cell, c, row) =>
    c === row.length - 1 ? cell : "",
  ),
];

/** A cell as the XLSX must hold it: text, or a number and its display format. */
export type ExpectedCell =
  { text: string } | { number: number; format: string } | null;
const textCell = (t: string): ExpectedCell => ({ text: t });
const numberCell = (number: number, format = "0"): ExpectedCell => ({
  number,
  format,
});
/**
 * Every row of the sheet PDF to Excel must write for {@link invoicePdf}, from
 * A1 down, typed by hand as an INDEPENDENT bound — not derived from the
 * writer's own number rules. `null` is a cell that must be absent.
 */
export const INVOICE_SHEET: readonly (readonly ExpectedCell[])[] = [
  [textCell(INVOICE_HEADING[0])],
  [textCell(INVOICE_HEADING[1])],
  INVOICE_ROWS[0].map((t) => textCell(t)),
  [
    numberCell(1001),
    textCell("2026-01-05"),
    textCell("Widgets, blue"),
    numberCell(2),
    numberCell(1250, "#,##0.00"),
  ],
  [
    numberCell(1002),
    textCell("2026-01-06"),
    null,
    numberCell(5),
    numberCell(3400.5, '"$"#,##0.00'),
  ],
  [
    textCell("00123"),
    textCell("2026-01-07"),
    textCell("Smith, John"),
    numberCell(12),
    numberCell(980.25, "0.00"),
  ],
  [
    textCell("Total"),
    null,
    null,
    numberCell(19),
    numberCell(5630.75, '"$"#,##0.00'),
  ],
];

/**
 * {@link INVOICE_ROWS} under {@link INVOICE_HEADING}: text columns flush left,
 * Qty and Amount flush RIGHT (headers included), the way invoices are set.
 * `rowGap` 24 makes poppler print a blank line between rows. `rows` draws a
 * variant table at the same positions ({@link INVOICE_LONE_TOTAL_ROWS}).
 */
export async function invoicePdf(
  rowGap = 16,
  rows: readonly (readonly string[])[] = INVOICE_ROWS,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const all = [...INVOICE_HEADING, ...rows.flat()];
  const font = await embedDrawingFont(doc, all);
  const bold = await embedDrawingFont(doc, all, "sans-bold");
  const page = doc.addPage([612, 792]);
  page.drawText(INVOICE_HEADING[0], { x: 50, y: 740, size: 18, font: bold });
  page.drawText(INVOICE_HEADING[1], { x: 50, y: 716, size: 11, font });
  const left = [50, 130, 220];
  const right = [420, 520];
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell) return;
      const face = r === 0 ? bold : font;
      const x =
        c < left.length
          ? left[c]!
          : right[c - left.length]! - face.widthOfTextAtSize(cell, 11);
      page.drawText(cell, { x, y: 680 - r * rowGap, size: 11, font: face });
    }),
  );
  return doc.save();
}

/** The 30 headings {@link wideRowPdf} prints on one line — four past Z. */
export const WIDE_ROW = Array.from(
  { length: 30 },
  (_, i) => `Col${i + 1}`,
) as readonly string[];

/** {@link WIDE_ROW} across one wide page, 58pt apart. */
export async function wideRowPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, WIDE_ROW);
  const page = doc.addPage([40 + WIDE_ROW.length * 58, 200]);
  WIDE_ROW.forEach((label, i) =>
    page.drawText(label, { x: 40 + i * 58, y: 120, size: 11, font }),
  );
  return doc.save();
}

/**
 * Where the sheet read back differs from {@link INVOICE_SHEET}, one line per
 * cell — every expected cell, AND every cell the sheet has that was not
 * expected. Empty means the sheet is exactly right.
 */
export function invoiceSheetMismatches(sheet: SheetRead): string[] {
  const cells = cellsByRef(sheet);
  const problems: string[] = [];
  const seen = new Set<string>();
  INVOICE_SHEET.forEach((row, r) =>
    row.forEach((want, c) => {
      const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
      seen.add(ref);
      const got = cells.get(ref);
      const shown = got
        ? `${got.type} ${JSON.stringify(got.value)} (${got.format})`
        : "absent";
      if (want === null) {
        if (got) problems.push(`${ref}: want absent, got ${shown}`);
      } else if ("text" in want) {
        if (got?.type !== "text" || got.value !== want.text)
          problems.push(
            `${ref}: want text ${JSON.stringify(want.text)}, got ${shown}`,
          );
      } else if (
        got?.type !== "number" ||
        Number(got.value) !== want.number ||
        got.format !== want.format
      )
        problems.push(
          `${ref}: want number ${want.number} (${want.format}), got ${shown}`,
        );
    }),
  );
  for (const ref of cells.keys())
    if (!seen.has(ref)) problems.push(`${ref}: unexpected cell`);
  return problems;
}

// ─────────────────────────── hand-written RC4 PDF ───────────────────────────

const PASSWORD_PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function md5(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function padded(password: string): Uint8Array {
  const bytes = new TextEncoder().encode(password).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PASSWORD_PAD.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/**
 * A one-page PDF encrypted with the Standard security handler, R2 / RC4-40.
 * `userPassword: ""` makes an owner-password-only file: encrypted, and opens
 * without asking — which a correct export must keep converting.
 */
export function rc4EncryptedPdf(opts: {
  userPassword: string;
  ownerPassword: string;
  text?: string;
}): Uint8Array {
  const text = opts.text ?? "Locked quarterly figures";
  const id = md5(new TextEncoder().encode(`pdfxyz-fixture-${text}`));
  const permissions = -44;
  const pLe = new Uint8Array(4);
  new DataView(pLe.buffer).setInt32(0, permissions, true);

  const owner = rc4(
    md5(padded(opts.ownerPassword)).subarray(0, 5),
    padded(opts.userPassword),
  );
  const fileKey = md5(padded(opts.userPassword), owner, pLe, id).subarray(0, 5);
  const user = rc4(fileKey, PASSWORD_PAD);
  const objectKey = (num: number) =>
    md5(
      fileKey,
      Uint8Array.from([
        num & 0xff,
        (num >> 8) & 0xff,
        (num >> 16) & 0xff,
        0,
        0,
      ]),
    ).subarray(0, 10);

  const content = new TextEncoder().encode(
    `BT /F1 14 Tf 72 700 Td (${text}) Tj ET`,
  );
  const encryptedContent = rc4(objectKey(5), content);

  const chunks: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    chunks.push(part);
    length +=
      typeof part === "string"
        ? Buffer.byteLength(part, "latin1")
        : part.length;
  };
  const obj = (num: number, body: string | (string | Uint8Array)[]) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  obj(5, [
    `<< /Length ${encryptedContent.length} >>\nstream\n`,
    encryptedContent,
    "\nendstream",
  ]);
  obj(
    6,
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> /P ${permissions} >>`,
  );
  const xref = length;
  push("xref\n0 7\n0000000000 65535 f \n");
  for (let n = 1; n <= 6; n += 1)
    push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(
    `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of chunks) {
    const bytes = typeof part === "string" ? Buffer.from(part, "latin1") : part;
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

// ───────────────────────────── a real poppler ───────────────────────────────

/**
 * The first `pdftotext` on PATH that is POPPLER's, or null.
 *
 * Not simply the first on PATH: Git for Windows ships Xpdf's `pdftotext` 4.00,
 * which has no `-bbox-layout` and orders text differently, so a test run
 * against it would fail — or pass — for reasons that say nothing about the
 * worker, which runs poppler. `PDFXYZ_TEST_PDFTOTEXT` pins one explicitly.
 */
export function findPopplerPdfToText(): string | null {
  const explicit = process.env.PDFXYZ_TEST_PDFTOTEXT?.trim();
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE").split(";").filter(Boolean)
      : [""];
  const candidates = explicit
    ? [explicit]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .flatMap((dir) => exts.map((ext) => path.join(dir, `pdftotext${ext}`)));
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
      // poppler prints its banner on stderr; read both streams.
      const run = spawnSync(candidate, ["-v"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      });
      if (/poppler/i.test(`${run.stdout ?? ""}${run.stderr ?? ""}`))
        return candidate;
    } catch {
      // Not runnable here; try the next one.
    }
  }
  return null;
}

/**
 * The two-column property, over paragraphs as a reader gets them: each
 * column's sentence is ONE paragraph, and the left one comes first. The
 * shape PDF to Word used to ship — each left line glued to its right-hand
 * neighbour — fails it.
 */
export function columnsReadInOrder(paragraphs: readonly string[]): boolean {
  const left = paragraphs.findIndex((p) => p.includes(LEFT_COLUMN.join(" ")));
  const right = paragraphs.findIndex((p) => p.includes(RIGHT_COLUMN.join(" ")));
  return left >= 0 && right > left;
}

/**
 * The table property, over paragraphs as a reader gets them: every row's
 * cells sit in ONE paragraph, in order. What the first paragraph rule wrote
 * for a statement — every label in one paragraph, every amount in the next —
 * fails it on the first row.
 */
export function rowsHeldTogether(
  paragraphs: readonly string[],
  rows: readonly (readonly string[])[],
): boolean {
  return rows.every((row) =>
    paragraphs.some((p) => {
      let at = 0;
      for (const cell of row) {
        const found = p.indexOf(cell, at);
        if (found < 0) return false;
        at = found + cell.length;
      }
      return true;
    }),
  );
}

/**
 * The multi-column prose property, generalised from
 * {@link columnsReadInOrder}: each source paragraph (a list of printed lines)
 * is contiguous inside ONE output paragraph, and no output paragraph holds a
 * line from two different columns. Cutting a paragraph's last line off and
 * tabbing it to the other column's last line fails both halves.
 */
export function paragraphsReadWhole(
  paragraphs: readonly string[],
  columns: readonly (readonly (readonly string[])[])[],
): boolean {
  const whole = columns.every((column) =>
    column.every((source) =>
      paragraphs.some((p) => p.includes(source.join(" "))),
    ),
  );
  const unmixed = paragraphs.every(
    (p) =>
      columns.filter((column) =>
        column.some((source) => source.some((line) => p.includes(line))),
      ).length <= 1,
  );
  return whole && unmixed;
}

/**
 * The strictest reading of a multi-column page, over paragraphs as a reader
 * gets them: EXACTLY one output paragraph per source paragraph, whole, the
 * first column's paragraphs all before the second's. What PDF to Word wrote
 * for {@link columnHeadingsPdf} and {@link columnListsPdf} — a heading or item
 * tabbed to its neighbour, or the right column's heading before the left
 * column's body — fails it; so does a list collapsed into one paragraph.
 */
export function readColumnByColumn(
  paragraphs: readonly string[],
  columns: readonly (readonly (readonly string[])[])[],
): boolean {
  const expected = columns.flatMap((column) =>
    column.map((source) => source.join(" ")),
  );
  return (
    paragraphs.length === expected.length &&
    paragraphs.every((p, i) => p === expected[i])
  );
}
