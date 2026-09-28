// @vitest-environment node
/**
 * PDF to Office export through a REAL poppler `pdftotext`, with the production
 * deps builder, read back from the file a user downloads.
 *
 * The unit tests beside this one run the same rules over captured poppler
 * output. This one exists because a capture is a point in time: it runs the
 * generated fixtures through whatever poppler is installed, so a poppler whose
 * reading order or error behaviour differs shows up here and not in a user's
 * document. The production worker runs a different poppler from a dev laptop;
 * run `pnpm worker:prove-tools pdf-to-word` against a deployment for that one.
 *
 * Skips VISIBLY when no poppler is installed (the suite name says so): Git for
 * Windows puts Xpdf's `pdftotext` first on PATH, and a run against that would
 * fail, or pass, for reasons that say nothing about the worker.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  columnHeadingsPdf,
  columnListsPdf,
  columnsReadInOrder,
  findPopplerPdfToText,
  HEADINGS_LEFT,
  HEADINGS_RIGHT,
  LETTER,
  letterPdf,
  LISTS_LEFT,
  LISTS_RIGHT,
  readColumnByColumn,
  highlightsPdf,
  HIGHLIGHTS_LEFT,
  HIGHLIGHTS_RIGHT,
  incomeStatementPdf,
  INVOICE_LONE_TOTAL_ROWS,
  INVOICE_SHEET,
  INVOICE_FOOTER,
  type InvoiceSurroundings,
  INVOICE_ROWS,
  invoicePdf,
  invoiceSheetMismatches,
  newsletterPdf,
  NEWSLETTER_LEFT,
  NEWSLETTER_RIGHT,
  paragraphsReadWhole,
  partlyScannedPdf,
  quarterlyTablePdf,
  rc4EncryptedPdf,
  rowsHeldTogether,
  sidebarPdf,
  SIDEBAR_LIST,
  SIDEBAR_MAIN,
  skuTablePdf,
  SKU_ROWS,
  STATEMENT_ROWS,
  TABLE_ROWS,
  twoColumnReportPdf,
  WIDE_ROW,
  wideRowPdf,
} from "@/tests/pdf-office-fixtures";
import * as officeFixtures from "@/tests/pdf-office-fixtures";
import { readXlsxSheet, sheetGridProblems } from "../ooxml/sheet-read";
import { nativePdfOfficeExportDeps } from "../pdf-text/native";
import { readDocxParagraphs } from "./docx-text";
import { readPptx } from "./validate-ooxml";
import {
  runPdfOfficeExport,
  type PdfFlowExtractor,
  type PdfOfficeExportDeps,
} from "./engine";

const POPPLER = findPopplerPdfToText();
const suite = describe.skipIf(!POPPLER);
const label = POPPLER
  ? "PDF to Office export on real poppler"
  : "PDF to Office export on real poppler (SKIPPED: no poppler pdftotext found on PATH)";

/** The production deps builder, pointed at the poppler we found. */
function deps(): PdfOfficeExportDeps {
  return nativePdfOfficeExportDeps(
    { PDFXYZ_PDF_TEXT_BIN: POPPLER! },
    { resolveOnPath: () => true },
  );
}

async function docxParagraphs(
  input: Uint8Array,
  over: Partial<PdfOfficeExportDeps> = {},
): Promise<string[]> {
  const run = await runPdfOfficeExport("pdf-to-word", input, {
    ...deps(),
    ...over,
  });
  if (!run.ok) throw new Error(`pdf-to-word failed: ${run.kind}`);
  return readDocxParagraphs(run.output);
}

suite(label, () => {
  it("writes a two-column report column by column", async () => {
    const paragraphs = await docxParagraphs(await twoColumnReportPdf());
    expect(columnsReadInOrder(paragraphs)).toBe(true);
  });

  it("POSITIVE CONTROL: the same PDF through the -layout lines PDF to Word used to write fails", async () => {
    // What shipped: every `-layout` line its own paragraph. Built from the
    // real layout extractor, so the control is this poppler's output too.
    const { extract } = deps();
    const oldWord: PdfFlowExtractor = async (bytes) => {
      const text = await extract!(bytes);
      return {
        pageCount: text.pageCount,
        pages: text.pages.map((page) => ({
          pageNumber: page.pageNumber,
          paragraphs: page.text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => [l]),
        })),
      };
    };
    const paragraphs = await docxParagraphs(await twoColumnReportPdf(), {
      extractFlow: oldWord,
    });
    expect(columnsReadInOrder(paragraphs)).toBe(false);
  });

  it("keeps a table's rows as rows", async () => {
    const paragraphs = await docxParagraphs(await quarterlyTablePdf());
    expect(paragraphs).toEqual(TABLE_ROWS.map((row) => row.join("\t")));
  });

  it("keeps a label / amount statement's rows as rows, long labels included", async () => {
    const paragraphs = await docxParagraphs(await incomeStatementPdf());
    expect(rowsHeldTogether(paragraphs, STATEMENT_ROWS)).toBe(true);
    expect(paragraphs).toEqual(STATEMENT_ROWS.map((row) => row.join("	")));
  });

  it("keeps a table with a text column as rows", async () => {
    const paragraphs = await docxParagraphs(await skuTablePdf());
    expect(rowsHeldTogether(paragraphs, SKU_ROWS)).toBe(true);
    expect(paragraphs).toEqual(SKU_ROWS.map((row) => row.join("	")));
  });

  it("writes aligned prose one whole paragraph at a time", async () => {
    // Short aligned last lines above aligned headings; a paragraph beside a
    // list of names; two columns of one-line sentences.
    expect(
      paragraphsReadWhole(await docxParagraphs(await newsletterPdf()), [
        NEWSLETTER_LEFT,
        NEWSLETTER_RIGHT,
      ]),
    ).toBe(true);
    expect(
      paragraphsReadWhole(await docxParagraphs(await sidebarPdf()), [
        [SIDEBAR_MAIN],
        [SIDEBAR_LIST],
      ]),
    ).toBe(true);
    expect(
      paragraphsReadWhole(await docxParagraphs(await highlightsPdf()), [
        [HIGHLIGHTS_LEFT],
        [HIGHLIGHTS_RIGHT],
      ]),
    ).toBe(true);
  });

  it("writes two columns whose every row lines up column by column, one w:p per paragraph, no tabs", async () => {
    // Short capitalised last lines above aligned headings, and two bulleted
    // lists side by side: every row of both pages is a pair of short lines on
    // a shared baseline, which is what a table row looks like.
    for (const [build, columns] of [
      [columnHeadingsPdf, [HEADINGS_LEFT, HEADINGS_RIGHT]],
      [columnListsPdf, [LISTS_LEFT, LISTS_RIGHT]],
    ] as const) {
      const paragraphs = await docxParagraphs(await build());
      expect(
        paragraphs.filter((p) => p.includes("\t")),
        build.name,
      ).toEqual([]);
      expect(readColumnByColumn(paragraphs, columns), build.name).toBe(true);
    }
  });

  it("writes a one-block letter one w:p per paragraph, heading, list item and closing line", async () => {
    // One font, one size, one pitch: poppler hands the whole letter over as
    // ONE block, and 9c73735 wrote it as one paragraph. The justified
    // paragraph, with a full line ending in a full stop inside it, must still
    // come out as one w:p.
    expect(await docxParagraphs(await letterPdf())).toEqual(
      LETTER.map((p) => p.join(" ")),
    );
  });

  it("names a user-password PDF as password-protected, for all three tools", async () => {
    const locked = rc4EncryptedPdf({
      userPassword: "s3cret",
      ownerPassword: "owner",
    });
    for (const tool of [
      "pdf-to-word",
      "pdf-to-excel",
      "pdf-to-powerpoint",
    ] as const)
      await expect(
        runPdfOfficeExport(tool, locked, deps()),
      ).resolves.toMatchObject({ ok: false, kind: "password_protected" });
  });

  it("names a locked PDF password-protected when its header is damaged too — the case only the byte scan can answer", async () => {
    // poppler still refuses this file for its password (exit 1); pdf-lib
    // cannot parse it at all, so the encryption question is answered by the
    // `/Encrypt` scan or not at all. Without the scan it read as damaged,
    // and the user was sent to Repair PDF for a file that needs a password.
    const locked = rc4EncryptedPdf({
      userPassword: "s3cret",
      ownerPassword: "owner",
    });
    const damaged = locked.slice(locked.indexOf(0x0a) + 1);
    await expect(
      PDFDocument.load(damaged, { ignoreEncryption: true }),
    ).rejects.toThrow();
    await expect(
      runPdfOfficeExport("pdf-to-word", damaged, deps()),
    ).resolves.toMatchObject({ ok: false, kind: "password_protected" });
  });

  it("POSITIVE CONTROL: an owner-password-only PDF is encrypted AND still converts", async () => {
    // The reason encryption is never checked up front: this file carries an
    // /Encrypt dictionary and opens without a password.
    const ownerOnly = rc4EncryptedPdf({
      userPassword: "",
      ownerPassword: "owner",
      text: "Owner locked but readable",
    });
    expect(await docxParagraphs(ownerOnly)).toEqual([
      "Owner locked but readable",
    ]);
  });

  it("reports the scanned pages of a partly scanned PDF, for all three tools", async () => {
    const scan = await partlyScannedPdf(5, [1]);
    for (const tool of [
      "pdf-to-word",
      "pdf-to-excel",
      "pdf-to-powerpoint",
    ] as const)
      await expect(
        runPdfOfficeExport(tool, scan, deps()),
      ).resolves.toMatchObject({
        ok: true,
        coverage: {
          pageCount: 5,
          textPageCount: 1,
          pagesWithoutText: [2, 3, 4, 5],
          // The 32-character stamp is the only text on page 1.
          littleTextPageCount: 1,
          pagesWithLittleText: [1],
        },
      });
  });

  it.each([16, 24])(
    "PDF to Excel writes an invoice cell for cell — rows %ipt apart",
    async (rowGap) => {
      const run = await runPdfOfficeExport(
        "pdf-to-excel",
        await invoicePdf(rowGap),
        deps(),
      );
      if (!run.ok) throw new Error(`pdf-to-excel failed: ${run.kind}`);
      const sheet = await readXlsxSheet(run.output);
      expect(sheet.rows).toHaveLength(INVOICE_SHEET.length);
      expect(invoiceSheetMismatches(sheet)).toEqual([]);
      expect(sheetGridProblems(sheet)).toEqual([]);
    },
  );

  describe("PDF to Excel keeps a table's columns with a two-run line a blank line above and below it", () => {
    // At 4ebfb4a a two-run line joined the table's block whenever only blank
    // lines separated them, and its runs bridged the gutters: with a page
    // footer ("Thank you for your business." … "Page 1 of 1") the download
    // had A3 "Invoice No Date", A4 "1001 2026-01-05", every later value one
    // column left, and "Page 1 of 1" under Amount. The plain invoice, with
    // one-run lines around its table, was exact, which is all the proof drew.
    // `only`: with a footer alone, every row down to the Total must be exact
    // ("invoice", what the deployment proof checks); with an aside on the
    // address line, the table's rows ("table").
    const aside = "Period: January 2026";
    const cases: {
      name: string;
      rowGap: number;
      around: InvoiceSurroundings & { footer: { left: string; right: string } };
      only: "invoice" | "table";
    }[] = [
      {
        name: "footer",
        rowGap: 16,
        around: { footer: INVOICE_FOOTER },
        only: "invoice",
      },
      {
        name: "footer",
        rowGap: 24,
        around: { footer: INVOICE_FOOTER },
        only: "invoice",
      },
      {
        name: "aside and footer",
        rowGap: 16,
        around: { aside, footer: INVOICE_FOOTER },
        only: "table",
      },
      {
        name: "aside and footer",
        rowGap: 24,
        around: { aside, footer: INVOICE_FOOTER },
        only: "table",
      },
      // The footer's right run past the table's right edge: the union loses
      // a column AND gains one, so a count of columns alone calls it fine.
      {
        name: "footer past the right edge",
        rowGap: 16,
        around: { footer: { ...INVOICE_FOOTER, x: 535 } },
        only: "invoice",
      },
    ];

    it.each(cases)(
      "$name, rows $rowGap pt apart",
      async ({ rowGap, around, only }) => {
        const pdf = await invoicePdf(rowGap, INVOICE_ROWS, around);
        // HEALTH: poppler prints each added line as ONE line of two runs, a
        // blank line away from the table, and at least one of its runs spans
        // two headings' positions — the shape that merged columns.
        const layout = (await deps().extract!(pdf)).pages[0]!.text.split("\n");
        const header = layout.findIndex((l) =>
          l.startsWith(INVOICE_ROWS[0][0]),
        );
        const headings = INVOICE_ROWS[0].map((h) => layout[header]!.indexOf(h));
        const added = [
          ...(around.aside ? [around.aside] : []),
          around.footer.right,
        ].map((text) => layout.findIndex((l) => l.includes(text)));
        expect(added).not.toContain(-1);
        for (const i of added) {
          const runs = [...layout[i]!.matchAll(/[^ ]+(?: [^ ]+)*/g)];
          expect(runs, layout[i]).toHaveLength(2);
          expect(layout[i < header ? i + 1 : i - 1], layout[i]).toBe("");
          expect(
            runs.some(
              (r) =>
                headings.filter(
                  (h) => h >= r.index && h < r.index + r[0].length,
                ).length >= 2,
            ),
            layout[i],
          ).toBe(true);
        }

        const run = await runPdfOfficeExport("pdf-to-excel", pdf, deps());
        if (!run.ok) throw new Error(`pdf-to-excel failed: ${run.kind}`);
        const sheet = await readXlsxSheet(run.output);
        expect(sheetGridProblems(sheet)).toEqual([]);
        expect(invoiceSheetMismatches(sheet, only)).toEqual([]);
        // The added lines are written, whole, outside the table's rows.
        const outside = sheet.rows
          .filter((row) => row.r < 3 || row.r > INVOICE_SHEET.length)
          .flatMap((row) => row.cells.map((c) => c.value));
        for (const text of [
          ...(around.aside ? [around.aside] : []),
          around.footer.left,
          around.footer.right,
        ])
          expect(outside).toContain(text);
      },
    );

    it("HEALTH: the narrowed checks read their rows and nothing else", async () => {
      const sheet = await readXlsxSheet(
        (
          (await runPdfOfficeExport(
            "pdf-to-excel",
            await invoicePdf(),
            deps(),
          )) as { output: Uint8Array }
        ).output,
      );
      expect(invoiceSheetMismatches(sheet, "table")).toEqual([]);
      // A cell moved into a table row is seen; the same cell in a heading
      // row is not the table check's business, and the full check sees it.
      const moveTo = (r: number): typeof sheet => ({
        rows: sheet.rows.map((row) =>
          row.r !== r
            ? row
            : {
                ...row,
                cells: [
                  ...row.cells,
                  {
                    ref: `Z${r}`,
                    column: 25,
                    row: r,
                    type: "text",
                    value: "stray",
                    format: "General",
                  },
                ],
              },
        ),
      });
      expect(invoiceSheetMismatches(moveTo(4), "table")).toEqual([
        "R4C26 (Z4): unexpected cell",
      ]);
      expect(invoiceSheetMismatches(moveTo(2), "table")).toEqual([]);
      for (const only of ["invoice", "sheet"] as const)
        expect(invoiceSheetMismatches(moveTo(2), only)).toEqual([
          "R2C26 (Z2): unexpected cell",
        ]);
      // Below the Total (a footer's row): only the full check compares it.
      const below = INVOICE_SHEET.length + 1;
      const withFooterRow: typeof sheet = {
        rows: [
          ...sheet.rows,
          {
            r: below,
            cells: [
              {
                ref: `A${below}`,
                column: 0,
                row: below,
                type: "text",
                value: "stray",
                format: "General",
              },
            ],
          },
        ],
      };
      expect(invoiceSheetMismatches(withFooterRow, "invoice")).toEqual([]);
      expect(invoiceSheetMismatches(withFooterRow, "table")).toEqual([]);
      expect(invoiceSheetMismatches(withFooterRow)).toEqual([
        `R${below}C1 (A${below}): unexpected cell`,
      ]);
    });
  });

  it.each([16, 24])(
    "PDF to Excel puts a table's amount-only LAST line under Amount — rows %ipt apart",
    async (rowGap) => {
      // 1287f42 sent this line to column A, under the first header: a lone
      // value is a one-run line, and one-run lines were placed by position
      // only BETWEEN a table's rows, never after its last one.
      const run = await runPdfOfficeExport(
        "pdf-to-excel",
        await invoicePdf(rowGap, INVOICE_LONE_TOTAL_ROWS),
        deps(),
      );
      if (!run.ok) throw new Error(`pdf-to-excel failed: ${run.kind}`);
      const sheet = await readXlsxSheet(run.output);
      expect(sheetGridProblems(sheet)).toEqual([]);
      const header = INVOICE_LONE_TOTAL_ROWS[0]!;
      const headerRow = sheet.rows.find(
        (row) => row.cells[0]?.value === header[0],
      );
      // HEALTH: the header was read back whole, one heading per column.
      expect(headerRow?.cells.map((c) => c.value)).toEqual([...header]);
      const amount = headerRow!.cells.find((c) => c.value === header.at(-1));
      const lone = INVOICE_LONE_TOTAL_ROWS.at(-1)!.at(-1)!;
      const last = sheet.rows.at(-1)!;
      expect(last.cells).toHaveLength(1);
      expect(last.cells[0]).toMatchObject({
        type: "number",
        value: String(Number(lone.replace(/[$,]/g, ""))),
        column: amount!.column,
      });
    },
  );

  it("PDF to Excel gives a 30-column row AA… references, each once, in order", async () => {
    const run = await runPdfOfficeExport(
      "pdf-to-excel",
      await wideRowPdf(),
      deps(),
    );
    if (!run.ok) throw new Error(`pdf-to-excel failed: ${run.kind}`);
    const sheet = await readXlsxSheet(run.output);
    expect(sheetGridProblems(sheet)).toEqual([]);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]!.cells.map((c) => c.value)).toEqual(WIDE_ROW);
    expect(sheet.rows[0]!.cells.at(-1)!.ref).toBe("AD1");
  });

  it("PDF to PowerPoint writes a deck PowerPoint opens for EVERY generated fixture PDF", async () => {
    // Discovered, not named: every zero-argument `*Pdf` builder the fixtures
    // module exports, plus a partly scanned document for its textless pages.
    // Until 2026-09-27 every deck this produced was refused by PowerPoint.
    const builders = Object.entries(
      officeFixtures as Record<string, unknown>,
    ).filter(
      (entry): entry is [string, () => Promise<Uint8Array>] =>
        entry[0].endsWith("Pdf") &&
        typeof entry[1] === "function" &&
        entry[1].length === 0,
    );
    expect(builders.length).toBeGreaterThanOrEqual(6);
    const inputs: [string, Uint8Array][] = [
      ...(await Promise.all(
        builders.map(
          async ([name, build]) =>
            [name, await build()] as [string, Uint8Array],
        ),
      )),
      ["partlyScannedPdf(4, [2])", await partlyScannedPdf(4, [2])],
    ];
    for (const [name, input] of inputs) {
      const run = await runPdfOfficeExport("pdf-to-powerpoint", input, deps());
      if (!run.ok)
        throw new Error(`${name}: pdf-to-powerpoint failed: ${run.kind}`);
      const read = await readPptx(run.output);
      expect(read.problems, name).toEqual([]);
      // Slide N is page N, textless pages included.
      expect(read.slides, name).toHaveLength(run.meta.pageCount);
      expect(read.slides.flat().join("").length, name).toBeGreaterThan(0);
    }
  });
});
