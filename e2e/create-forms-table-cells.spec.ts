import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { PDFDocument, PDFTextField, StandardFonts, rgb } from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Create Fillable Forms' Find fields, slice S5 (tables: empty ruled cells),
 * through the PAGE and judged on the DOWNLOADED PDF. Page 1 holds a ruled
 * table, "Item | Qty | Amount" in its top row and two empty rows under it;
 * page 2 a sign-up sheet of 4 columns and 51 empty rows (204 empty cells,
 * over the 200 that are expanded). Find fields is pressed, everything is
 * added, the form is created and downloaded, and pdf-lib (a second reader,
 * beside the pdf.js read in form-detect-tables.test.ts) reads it back:
 *
 *  - exactly six fields, named by column and row, each widget inside the
 *    cell PRINTED there (the numbers this file drew with), one a cell;
 *  - nothing from page 2, whose table the summary names in ONE line.
 */
const XS = [72, 260, 380, 540];
const YS = [600, 624, 648, 672];
const HEAD = ["Item", "Qty", "Amount"];
const SHEET_XS = [72, 190, 310, 430, 540];
const SHEET_YS = Array.from({ length: 53 }, (_, i) => 100 + 12 * i);

/** Row r (1 = first under the header), column k of the page-1 table. */
const cell = (r: number, k: number) => ({
  x0: XS[k]!,
  x1: XS[k + 1]!,
  y0: YS[2 - r]!,
  y1: YS[3 - r]!,
});

const PRINTED: Record<
  string,
  { x0: number; x1: number; y0: number; y1: number }
> = Object.fromEntries(
  [1, 2].flatMap((r) =>
    HEAD.map((h, k) => [`${h.toLowerCase()}_row_${r}`, cell(r, k)]),
  ),
);

async function tableForm(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const grid = (
    page: ReturnType<PDFDocument["addPage"]>,
    xs: number[],
    ys: number[],
  ) => {
    for (const y of ys)
      page.drawLine({
        start: { x: xs[0]!, y },
        end: { x: xs[xs.length - 1]!, y },
        thickness: 0.75,
        color: rgb(0, 0, 0),
      });
    for (const x of xs)
      page.drawLine({
        start: { x, y: ys[0]! },
        end: { x, y: ys[ys.length - 1]! },
        thickness: 0.75,
        color: rgb(0, 0, 0),
      });
  };
  const one = d.addPage([612, 792]);
  grid(one, XS, YS);
  HEAD.forEach((h, k) =>
    one.drawText(h, { x: XS[k]! + 4, y: YS[2]! + 8, size: 10, font }),
  );
  const two = d.addPage([612, 792]);
  grid(two, SHEET_XS, SHEET_YS);
  ["Name", "Email", "Phone", "Team"].forEach((h, k) =>
    two.drawText(h, {
      x: SHEET_XS[k]! + 4,
      y: SHEET_YS[51]! + 3,
      size: 8,
      font,
    }),
  );
  return Buffer.from(await d.save());
}

test("Find fields: a headed table's empty cells become fields inside their cells; a table of 204 empty cells is one summary line", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/create-forms");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "table-cells.pdf",
    mimeType: "application/pdf",
    buffer: await tableForm(),
  });
  await expect(page.getByTestId("form-page-preview")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Find fields" }).click();
  const summary = page.getByTestId("find-fields-summary");
  await expect(summary).toContainText(
    "Found 6 possible fields on 1 of 2 pages: check each one, as nothing is added until you add it.",
    { timeout: 30_000 },
  );
  await expect(
    summary.getByText(
      "1 table has more than 200 empty cells, too many to suggest one by one: add its fields with Add field.",
    ),
  ).toHaveCount(1);
  const rows = page.locator("[data-proposal-row]");
  await expect(rows).toHaveCount(6);
  await page.getByRole("button", { name: /^Add all \(6\)/ }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator("[data-field-card]")).toHaveCount(6);

  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByText("Fillable form ready")).toBeVisible({
    timeout: 20_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download form PDF" }).click(),
  ]);
  const saved = await PDFDocument.load(readFileSync((await download.path())!));
  const fields = saved.getForm().getFields();
  expect(fields.map((f) => f.getName()).sort()).toEqual(
    Object.keys(PRINTED).sort(),
  );
  const pages = saved.getPages();
  for (const field of fields) {
    const want = PRINTED[field.getName()]!;
    expect(field, field.getName()).toBeInstanceOf(PDFTextField);
    const widgets = field.acroField.getWidgets();
    expect(widgets).toHaveLength(1);
    // On page 1: nothing was added from the sheet on page 2.
    expect(widgets[0]!.P()).toBe(pages[0]!.ref);
    const r = widgets[0]!.getRectangle();
    expect(r.x, `${field.getName()} left`).toBeGreaterThanOrEqual(
      want.x0 - 0.5,
    );
    expect(r.x + r.width, `${field.getName()} right`).toBeLessThanOrEqual(
      want.x1 + 0.5,
    );
    expect(r.y, `${field.getName()} bottom`).toBeGreaterThanOrEqual(
      want.y0 - 0.5,
    );
    expect(r.y + r.height, `${field.getName()} top`).toBeLessThanOrEqual(
      want.y1 + 0.5,
    );
  }
  // Health: six printed cells, each a different one.
  expect(
    new Set(Object.values(PRINTED).map((c) => `${c.x0},${c.y0}`)).size,
  ).toBe(6);
});
