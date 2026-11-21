import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { PDFDocument, PDFTextField, StandardFonts, rgb } from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Create Fillable Forms' Find fields, slice S4 (entry boxes and stacked
 * lines), through the PAGE and judged on the DOWNLOADED PDF: a form drawn
 * here with pdf-lib holds an empty 400 x 80 box captioned "Comments" (a
 * multiline entry box), an empty 200 x 20 box labelled "Reference:" (a
 * one-line entry box), and three equal lines 20 pt apart under "Notes:"
 * (ONE multiline field). Find fields is pressed, everything is added, the
 * form is created and downloaded, and pdf-lib (a second reader, beside the
 * pdf.js read in form-detect-boxes.test.ts) reads each field back:
 *
 *  - exactly three fields, each widget inside the box or stack PRINTED
 *    there (the numbers this file drew with, not the finder's);
 *  - the Ff multiline flag (bit 13, 4096) set on the two multiline fields
 *    and clear on the one-line one.
 */
const COMMENTS = { x: 72, y: 560, w: 400, h: 80 };
const REFERENCE = { x: 160, y: 480, w: 200, h: 20 };
const NOTES = { x0: 72, x1: 540, ys: [300, 320, 340], caption: 346 };

const PRINTED: Record<
  string,
  { x0: number; y0: number; x1: number; y1: number; multiline: boolean }
> = {
  comments: {
    x0: COMMENTS.x,
    y0: COMMENTS.y,
    x1: COMMENTS.x + COMMENTS.w,
    y1: COMMENTS.y + COMMENTS.h,
    multiline: true,
  },
  reference: {
    x0: REFERENCE.x,
    y0: REFERENCE.y,
    x1: REFERENCE.x + REFERENCE.w,
    y1: REFERENCE.y + REFERENCE.h,
    multiline: false,
  },
  notes: {
    x0: NOTES.x0,
    y0: NOTES.ys[0]!,
    x1: NOTES.x1,
    y1: NOTES.caption,
    multiline: true,
  },
};

async function entryForm(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const page = d.addPage([612, 792]);
  const font = await d.embedFont(StandardFonts.Helvetica);
  const say = (s: string, x: number, y: number) =>
    page.drawText(s, { x, y, size: 10, font, color: rgb(0, 0, 0) });
  const box = (b: { x: number; y: number; w: number; h: number }) =>
    page.drawRectangle({
      x: b.x,
      y: b.y,
      width: b.w,
      height: b.h,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.75,
    });
  say("Comments", COMMENTS.x, COMMENTS.y + COMMENTS.h + 4);
  box(COMMENTS);
  say(
    "Reference:",
    REFERENCE.x - 12 - font.widthOfTextAtSize("Reference:", 10),
    REFERENCE.y + 6,
  );
  box(REFERENCE);
  say("Notes:", NOTES.x0, NOTES.caption);
  for (const y of NOTES.ys)
    page.drawLine({
      start: { x: NOTES.x0, y },
      end: { x: NOTES.x1, y },
      thickness: 0.75,
      color: rgb(0, 0, 0),
    });
  return Buffer.from(await d.save());
}

test("Find fields: entry boxes and stacked lines become fields inside what was printed, multiline where tall", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/create-forms");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "entry-boxes.pdf",
    mimeType: "application/pdf",
    buffer: await entryForm(),
  });
  await expect(page.getByTestId("form-page-preview")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Find fields" }).click();
  await expect(page.getByTestId("find-fields-summary")).toContainText(
    "Found 3 possible fields: check each one, as nothing is added until you add it.",
    { timeout: 30_000 },
  );
  const rows = page.locator("[data-proposal-row]");
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: /^Add all \(3\)/ }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator("[data-field-card]")).toHaveCount(3);

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
  for (const field of fields) {
    const want = PRINTED[field.getName()]!;
    expect(field, field.getName()).toBeInstanceOf(PDFTextField);
    const widgets = field.acroField.getWidgets();
    expect(widgets).toHaveLength(1);
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
    // Ff bit 13 (4096): multiline.
    expect(
      (field.acroField.getFlags() & 4096) !== 0,
      `${field.getName()} multiline flag`,
    ).toBe(want.multiline);
  }
  // Health: both sides of the flag were read.
  expect(Object.values(PRINTED).map((p) => p.multiline)).toEqual([
    true,
    false,
    true,
  ]);
});
