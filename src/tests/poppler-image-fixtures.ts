/**
 * #28 slice 3 (wraps): every PDF the capture session runs through the worker
 * image's poppler (`scripts/capture-flow-image.ts`), by capture name, each
 * with the generator its export's docblock names and the words it draws.
 *
 * A name `X` becomes the export `IMAGE_X_BBOX` of `./poppler-samples-image`
 * (`scripts/write-poppler-image-samples.ts`). `words` is read from the SAME
 * exported constants the generator draws from, so the drift check in
 * `./poppler-samples-image.test.ts` — a capture's words against its
 * generator's — can fail when either side moves. An `ocr` capture has no
 * words to compare (Tesseract reads the page; what it reads is the finding).
 *
 * The 17 re-captures (S15) are the generators behind `./poppler-samples`'s
 * `_BBOX` exports, each named as that module's docblock names it, so the
 * same page can be read on poppler 25.07 (that module) and on the image's
 * poppler (this one).
 */
import {
  DOCX_TABLE_WRAPS_PROBE,
  docxTableWrapsProbePdf,
} from "@/lib/workers/pdf-office-export/capability";
import {
  columnHeadingsPdf,
  columnListsPdf,
  HEADINGS_LEFT,
  HEADINGS_RIGHT,
  HIGHLIGHTS_LEFT,
  HIGHLIGHTS_RIGHT,
  highlightsPdf,
  incomeStatementPdf,
  INVOICE_FOOTER,
  INVOICE_HEADING,
  INVOICE_LONE_TOTAL_ROWS,
  INVOICE_ROWS,
  LEFT_COLUMN,
  LETTER,
  letterPdf,
  LISTS_LEFT,
  LISTS_RIGHT,
  NEWSLETTER_LEFT,
  NEWSLETTER_RIGHT,
  newsletterPdf,
  quarterlyTablePdf,
  RIGHT_COLUMN,
  SIDEBAR_LIST,
  SIDEBAR_MAIN,
  sidebarPdf,
  SKU_ROWS,
  skuTablePdf,
  STATEMENT_ROWS,
  TABLE_ROWS,
  twoColumnReportPdf,
  WRAPPED_TABLE,
  wrappedCellTablePdf,
} from "./pdf-office-fixtures";
import {
  AUTO_SIZED_TABLE,
  autoSizedTablePdf,
  INVOICE_ASIDE,
  loneTotalInvoicePdf,
  REPORT_CAPTION,
  REPORT_FOOTER,
  REPORT_NOTE,
  REPORT_PROSE,
  REPORT_TABLES,
  REPORT_TITLE,
  reportTablesPdf,
  SPANNING_TABLE,
  spanningHeaderPdf,
  STACKED_TABLES,
  stackedTablesPdf,
  surroundedInvoicePdf,
  TITLED_TABLE,
  TITLED_TITLE,
  titledTablePdf,
} from "./table-extract-fixtures";
import {
  academicItems,
  academicTablePdf,
  bankStatementPdf,
  BANK_STATEMENT,
  drawnWords,
  figuresSidebarItems,
  figuresSidebarPdf,
  FORM_TABLE,
  formTablePdf,
  tableItems,
  tableInterruptItems,
  tableInterruptPdf,
  tableNoteItems,
  tableNotePdf,
  twoColumnShortLinesItems,
  twoColumnShortLinesPdf,
  wrapAcrossPagesItems,
  wrapAcrossPagesPdf,
  WRAPPED_BENGALI_TABLE,
  wrappedBengaliTablePdf,
  wrappedInvoiceItems,
  wrappedInvoicePdf,
  wrappedTwoColumnPageItems,
  wrappedTwoColumnPagePdf,
} from "./word-wrap-fixtures";

export interface CaptureFixture {
  /** `synthetic`: a generated page; `ocr`: a generated page OCR'd in the image. */
  kind: "synthetic" | "ocr";
  /** The generator call, as the export's docblock names it. */
  source: string;
  /** What the page stands for and what it exercises (brief §1.2). */
  shape: string;
  build: () => Promise<Uint8Array>;
  /** Every word the generator draws, from its exported spec; null for `ocr`. */
  words: (() => readonly string[]) | null;
}

const split = (texts: readonly string[]) =>
  texts.flatMap((t) => t.split(/\s+/).filter(Boolean));
const flat = (rows: readonly (readonly string[])[]) => split(rows.flat());

const probeWords = () => {
  const p = DOCX_TABLE_WRAPS_PROBE;
  const wraps: Readonly<Record<number, readonly string[]>> = p.wraps;
  return split([...p.rows.flat(), ...Object.values(wraps).flat(), p.total]);
};

/** Every capture, in the order the session runs them. */
export const CAPTURE_FIXTURES: Readonly<Record<string, CaptureFixture>> = {
  // ── S1–S14, S16: the wrap captures ──
  DOCX_TABLE_WRAPS_PROBE: {
    kind: "synthetic",
    source: "docxTableWrapsProbePdf()",
    shape:
      "S1, the docxTableWraps probe: a lower-case 1-line wrap after a four-word line (rule 4), a capitalised 2-line wrap, a lone total",
    build: docxTableWrapsProbePdf,
    words: probeWords,
  },
  WRAPPED_LONG: {
    kind: "synthetic",
    source: 'wrappedCellTablePdf("long")',
    shape:
      "S2, slice 2's measured case: a four-word cell, lower-case continuation",
    build: () => wrappedCellTablePdf("long"),
    words: () =>
      split([
        ...WRAPPED_TABLE.long.rows.flat(),
        WRAPPED_TABLE.long.continuation,
      ]),
  },
  WRAPPED_SHORT: {
    kind: "synthetic",
    source: 'wrappedCellTablePdf("short")',
    shape: 'S2, slice 2\'s measured case: "New York" / "City", capitalised',
    build: () => wrappedCellTablePdf("short"),
    words: () =>
      split([
        ...WRAPPED_TABLE.short.rows.flat(),
        WRAPPED_TABLE.short.continuation,
      ]),
  },
  WRAPPED_INVOICE: {
    kind: "synthetic",
    source: "wrappedInvoicePdf()",
    shape:
      "S3, an invoice: 2- and 3-line descriptions, lower-case / capitalised / letter-hyphen / soft-hyphen continuations, a totals block and an amount-only total",
    build: () => wrappedInvoicePdf(),
    words: () => drawnWords(wrappedInvoiceItems()),
  },
  WRAPPED_INVOICE_STRAY_NUMBER: {
    kind: "synthetic",
    source: "wrappedInvoicePdf({ stray: true })",
    shape:
      "S3 with a lone number under Description one row pitch below the last row (mutation M2's bite)",
    build: () => wrappedInvoicePdf({ stray: true }),
    words: () => drawnWords(wrappedInvoiceItems({ stray: true })),
  },
  WRAPPED_INVOICE_AMOUNT_NOTE: {
    kind: "synthetic",
    source: "wrappedInvoicePdf({ amountNote: true })",
    shape:
      "S3 with \"incl. VAT\" continuing a body row's Amount: a non-number under a figure column (mutation M15's bite)",
    build: () => wrappedInvoicePdf({ amountNote: true }),
    words: () => drawnWords(wrappedInvoiceItems({ amountNote: true })),
  },
  WRAPPED_INVOICE_EMBEDDED: {
    kind: "synthetic",
    source: "wrappedInvoicePdf({ embedded: true })",
    shape:
      "S3 drawn in the shipped Noto Sans, embedded: what an embedded face's ToUnicode hands poppler for U+00AD",
    build: () => wrappedInvoicePdf({ embedded: true }),
    words: () => drawnWords(wrappedInvoiceItems({ embedded: true })),
  },
  WRAPPED_INVOICE_EVERY_ROW: {
    kind: "synthetic",
    source: "wrappedInvoicePdf({ everyRow: 3 })",
    shape: "S4, every description wraps to 3 lines: the share cap",
    build: () => wrappedInvoicePdf({ everyRow: 3 }),
    words: () => drawnWords(wrappedInvoiceItems({ everyRow: 3 })),
  },
  BANK_STATEMENT: {
    kind: "synthetic",
    source: "bankStatementPdf()",
    shape:
      "S5, a bank statement: reference-line continuations carrying digits, Debit/Credit alternately empty",
    build: bankStatementPdf,
    words: () => drawnWords(tableItems(BANK_STATEMENT).items),
  },
  ACADEMIC_LABEL_WRAP: {
    kind: "synthetic",
    source: 'academicTablePdf("label-wrap")',
    shape: "S6, a first-column row label that wraps: the stated limit",
    build: () => academicTablePdf("label-wrap"),
    words: () => drawnWords(academicItems("label-wrap")),
  },
  ACADEMIC_HEADER_WRAP: {
    kind: "synthetic",
    source: 'academicTablePdf("header-wrap")',
    shape: "S7, one header cell of a text column wraps",
    build: () => academicTablePdf("header-wrap"),
    words: () => drawnWords(academicItems("header-wrap")),
  },
  ACADEMIC_HEADER_WRAP_FIGURE: {
    kind: "synthetic",
    source: 'academicTablePdf("header-wrap-figure")',
    shape: 'S7, one header cell of a figure column wraps ("Amount" / "(USD)")',
    build: () => academicTablePdf("header-wrap-figure"),
    words: () => drawnWords(academicItems("header-wrap-figure")),
  },
  ACADEMIC_HEADER_WRAP_PAIR: {
    kind: "synthetic",
    source: 'academicTablePdf("header-wrap-pair")',
    shape:
      "S7, two header cells wrap on the same baselines: a two-cell continuation band",
    build: () => academicTablePdf("header-wrap-pair"),
    words: () => drawnWords(academicItems("header-wrap-pair")),
  },
  ACADEMIC_HEADER_BOTTOM: {
    kind: "synthetic",
    source: 'academicTablePdf("header-bottom")',
    shape:
      "S7, a bottom-aligned header whose upper line sits above the header row",
    build: () => academicTablePdf("header-bottom"),
    words: () => drawnWords(academicItems("header-bottom")),
  },
  FORM_TABLE: {
    kind: "synthetic",
    source: "formTablePdf()",
    shape: "S8, Label: / value pairs with wrapped values and no figure column",
    build: formTablePdf,
    words: () => drawnWords(tableItems(FORM_TABLE).items),
  },
  OCR_WRAPPED_INVOICE: {
    kind: "ocr",
    source: "wrappedInvoicePdf() through ocrmypdf --force-ocr -l eng",
    shape:
      "S9, S3 OCR'd in the image: OCR word and cell gaps per line height (brief D2)",
    build: () => wrappedInvoicePdf(),
    words: null,
  },
  TWO_COLUMN_SHORT_LINES: {
    kind: "synthetic",
    source: "twoColumnShortLinesPdf()",
    shape:
      "S10, two-column prose whose right column ends in short lines below the left's end: no table",
    build: twoColumnShortLinesPdf,
    words: () => drawnWords(twoColumnShortLinesItems()),
  },
  FIGURES_SIDEBAR: {
    kind: "synthetic",
    source: "figuresSidebarPdf()",
    shape:
      "S11, a paragraph beside a column of figures with a two-line note under the figures: prose not absorbed",
    build: figuresSidebarPdf,
    words: () => drawnWords(figuresSidebarItems()),
  },
  WRAPPED_TWO_COLUMN_PAGE: {
    kind: "synthetic",
    source: "wrappedTwoColumnPagePdf()",
    shape:
      "S12, a wrapped table in the left column of a two-column page: bands across the gutter",
    build: wrappedTwoColumnPagePdf,
    words: () => drawnWords(wrappedTwoColumnPageItems()),
  },
  WRAP_ACROSS_PAGES: {
    kind: "synthetic",
    source: "wrapAcrossPagesPdf()",
    shape:
      "S13, the last row's description wraps onto page 2: no cross-page join",
    build: wrapAcrossPagesPdf,
    words: () => drawnWords(wrapAcrossPagesItems()),
  },
  WRAPPED_BENGALI_TABLE: {
    kind: "synthetic",
    source: "wrappedBengaliTablePdf()",
    shape:
      "S14, Bengali descriptions that wrap: no letter case, geometry-only absorption",
    build: wrappedBengaliTablePdf,
    words: () => drawnWords(tableItems(WRAPPED_BENGALI_TABLE).items),
  },
  TABLE_NOTE_1_0: {
    kind: "synthetic",
    source: 'tableNotePdf("note-1.0")',
    shape:
      "S16, a note centred under Description one row pitch below the last row (brief §2.7)",
    build: () => tableNotePdf("note-1.0"),
    words: () => drawnWords(tableNoteItems("note-1.0")),
  },
  TABLE_NOTE_1_5: {
    kind: "synthetic",
    source: 'tableNotePdf("note-1.5")',
    shape: "S16, the same note one and a half row pitches below the last row",
    build: () => tableNotePdf("note-1.5"),
    words: () => drawnWords(tableNoteItems("note-1.5")),
  },
  TABLE_NOTE_CAPTION: {
    kind: "synthetic",
    source: 'tableNotePdf("caption")',
    shape:
      "S16, two tables with a centred caption one row pitch below the first",
    build: () => tableNotePdf("caption"),
    words: () => drawnWords(tableNoteItems("caption")),
  },
  TABLE_INTERRUPT_SUBHEADING: {
    kind: "synthetic",
    source: 'tableInterruptPdf("subheading")',
    shape:
      "S17, a subheading under Description in a poppler block of its own, between two groups of rows",
    build: () => tableInterruptPdf("subheading"),
    words: () => drawnWords(tableInterruptItems("subheading")),
  },
  TABLE_INTERRUPT_MIDNOTE: {
    kind: "synthetic",
    source: 'tableInterruptPdf("midnote")',
    shape:
      "S17, a note centred under Description in a block of its own, between the rows and the Total / Paid / Due lines",
    build: () => tableInterruptPdf("midnote"),
    words: () => drawnWords(tableInterruptItems("midnote")),
  },
  TABLE_INTERRUPT_BLANKFIRST: {
    kind: "synthetic",
    source: 'tableInterruptPdf("blankfirst")',
    shape:
      "S17, a statement row whose only cell is its description, in a block of its own, between two rows",
    build: () => tableInterruptPdf("blankfirst"),
    words: () => drawnWords(tableInterruptItems("blankfirst")),
  },

  // ── S15: the 17 generators behind ./poppler-samples' _BBOX exports ──
  TWO_COLUMN: {
    kind: "synthetic",
    source: "twoColumnReportPdf()",
    shape: "S15 re-capture of TWO_COLUMN_BBOX",
    build: twoColumnReportPdf,
    words: () => split(["Quarterly Report", ...LEFT_COLUMN, ...RIGHT_COLUMN]),
  },
  TABLE: {
    kind: "synthetic",
    source: "quarterlyTablePdf()",
    shape: "S15 re-capture of TABLE_BBOX",
    build: quarterlyTablePdf,
    words: () => flat(TABLE_ROWS),
  },
  STATEMENT: {
    kind: "synthetic",
    source: "incomeStatementPdf()",
    shape: "S15 re-capture of STATEMENT_BBOX",
    build: incomeStatementPdf,
    words: () => flat(STATEMENT_ROWS),
  },
  SKU_TABLE: {
    kind: "synthetic",
    source: "skuTablePdf()",
    shape: "S15 re-capture of SKU_TABLE_BBOX",
    build: skuTablePdf,
    words: () => flat(SKU_ROWS),
  },
  NEWSLETTER: {
    kind: "synthetic",
    source: "newsletterPdf()",
    shape: "S15 re-capture of NEWSLETTER_BBOX",
    build: newsletterPdf,
    words: () => split([...NEWSLETTER_LEFT.flat(), ...NEWSLETTER_RIGHT.flat()]),
  },
  SIDEBAR: {
    kind: "synthetic",
    source: "sidebarPdf()",
    shape: "S15 re-capture of SIDEBAR_BBOX",
    build: sidebarPdf,
    words: () => split([...SIDEBAR_MAIN, ...SIDEBAR_LIST]),
  },
  HIGHLIGHTS: {
    kind: "synthetic",
    source: "highlightsPdf()",
    shape: "S15 re-capture of HIGHLIGHTS_BBOX",
    build: highlightsPdf,
    words: () => split([...HIGHLIGHTS_LEFT, ...HIGHLIGHTS_RIGHT]),
  },
  HEADINGS: {
    kind: "synthetic",
    source: "columnHeadingsPdf()",
    shape: "S15 re-capture of HEADINGS_BBOX",
    build: columnHeadingsPdf,
    words: () => split([...HEADINGS_LEFT.flat(), ...HEADINGS_RIGHT.flat()]),
  },
  LISTS: {
    kind: "synthetic",
    source: "columnListsPdf()",
    shape: "S15 re-capture of LISTS_BBOX",
    build: columnListsPdf,
    words: () => split([...LISTS_LEFT.flat(), ...LISTS_RIGHT.flat()]),
  },
  LETTER: {
    kind: "synthetic",
    source: "letterPdf()",
    shape: "S15 re-capture of LETTER_BBOX",
    build: letterPdf,
    words: () => split(LETTER.flat()),
  },
  REPORT_TABLES: {
    kind: "synthetic",
    source: "reportTablesPdf()",
    shape: "S15 re-capture of REPORT_TABLES_BBOX",
    build: reportTablesPdf,
    words: () =>
      split([
        REPORT_TITLE,
        ...REPORT_PROSE,
        REPORT_CAPTION,
        ...REPORT_NOTE,
        REPORT_FOOTER,
        ...REPORT_TABLES.flat(2),
      ]),
  },
  TITLED_TABLE: {
    kind: "synthetic",
    source: "titledTablePdf()",
    shape: "S15 re-capture of TITLED_TABLE_BBOX",
    build: titledTablePdf,
    words: () => split([TITLED_TITLE, ...TITLED_TABLE.flat()]),
  },
  SPANNING_TABLE: {
    kind: "synthetic",
    source: "spanningHeaderPdf()",
    shape: "S15 re-capture of SPANNING_TABLE_BBOX",
    build: spanningHeaderPdf,
    words: () => flat(SPANNING_TABLE),
  },
  SURROUNDED_INVOICE: {
    kind: "synthetic",
    source: "surroundedInvoicePdf()",
    shape: "S15 re-capture of SURROUNDED_INVOICE_BBOX",
    build: surroundedInvoicePdf,
    words: () =>
      split([
        ...INVOICE_HEADING,
        ...INVOICE_ROWS.flat(),
        INVOICE_ASIDE,
        INVOICE_FOOTER.left,
        INVOICE_FOOTER.right,
      ]),
  },
  AUTO_SIZED_TABLE: {
    kind: "synthetic",
    source: "autoSizedTablePdf()",
    shape: "S15 re-capture of AUTO_SIZED_TABLE_BBOX",
    build: autoSizedTablePdf,
    words: () => flat(AUTO_SIZED_TABLE),
  },
  STACKED_TABLES: {
    kind: "synthetic",
    source: "stackedTablesPdf()",
    shape: "S15 re-capture of STACKED_TABLES_BBOX",
    build: stackedTablesPdf,
    words: () => split(STACKED_TABLES.flat(2)),
  },
  LONE_TOTAL_INVOICE: {
    kind: "synthetic",
    source: "loneTotalInvoicePdf()",
    shape: "S15 re-capture of LONE_TOTAL_INVOICE_BBOX",
    build: loneTotalInvoicePdf,
    words: () => split([...INVOICE_HEADING, ...INVOICE_LONE_TOTAL_ROWS.flat()]),
  },
};
