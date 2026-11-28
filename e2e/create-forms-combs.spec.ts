import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  PDFCheckBox,
  PDFDocument,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { axeViolations } from "./chat-citations-fixture";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Create Fillable Forms' Find fields, slice S6 (combs and radio clusters),
 * through the PAGE and judged on the DOWNLOADED PDF. One page holds:
 *
 *  - "Account number" beside eight 14 pt boxes edge to edge (a comb);
 *  - "Preferred contact" over three 12 pt squares stacked 6 pt apart (the
 *    builder's radio gap), "Email", "Phone", "Post" to their right;
 *  - a checklist: three 12 pt squares 12 pt apart, "Passport", "Driving
 *    licence", "Utility bill" to their right.
 *
 * Find fields is pressed, everything is added, the cards are checked
 * (the comb's "Max length" is 8, the radio card's options are the three
 * labels), the form is created and downloaded, and pdf-lib (a second
 * reader, beside the pdf.js read in form-detect-combs.test.ts) reads it:
 *
 *  - ONE text field over the eight boxes, /MaxLen 8, its widget spanning
 *    the printed run;
 *  - ONE radio group with three widgets, one inside each printed square,
 *    its options the three labels;
 *  - three checkboxes for the checklist, never a radio group.
 */
const COMB = { x: 150, y: 600, side: 14, n: 8 };
const STACK = { x: 72, tops: [500, 482, 464], side: 12 };
const CHECKS = { x: 300, tops: [500, 476, 452], side: 12 };
const OPTIONS = ["Email", "Phone", "Post"];
const ITEMS = ["Passport", "Driving licence", "Utility bill"];

async function combsForm(): Promise<Buffer> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const page = d.addPage([612, 792]);
  const square = (x: number, y: number, s: number) =>
    page.drawRectangle({
      x,
      y,
      width: s,
      height: s,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
  page.drawText("Account number", { x: 72, y: COMB.y + 3, size: 10, font });
  for (let k = 0; k < COMB.n; k++)
    square(COMB.x + COMB.side * k, COMB.y, COMB.side);
  page.drawText("Preferred contact", {
    x: STACK.x,
    y: STACK.tops[0]! + 18,
    size: 10,
    font,
  });
  STACK.tops.forEach((y, k) => {
    square(STACK.x, y, STACK.side);
    page.drawText(OPTIONS[k]!, { x: STACK.x + 16, y: y + 2, size: 10, font });
  });
  CHECKS.tops.forEach((y, k) => {
    square(CHECKS.x, y, CHECKS.side);
    page.drawText(ITEMS[k]!, { x: CHECKS.x + 16, y: y + 2, size: 10, font });
  });
  return Buffer.from(await d.save());
}

test("Find fields: a comb becomes one 8-character field, a stack at the radio gap one radio group, a checklist checkboxes", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/create-forms");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "combs.pdf",
    mimeType: "application/pdf",
    buffer: await combsForm(),
  });
  await expect(page.getByTestId("form-page-preview")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Find fields" }).click();
  const summary = page.getByTestId("find-fields-summary");
  await expect(summary).toContainText("Found 5 possible fields", {
    timeout: 30_000,
  });
  const rows = page.locator("[data-proposal-row]");
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: "Radio group" })).toHaveCount(1);
  await page.getByRole("button", { name: /^Add all \(5\)/ }).click();
  await expect(rows).toHaveCount(0);
  const cards = page.locator("[data-field-card]");
  await expect(cards).toHaveCount(5);
  // The cards as a person sees them: the comb's limit and the group's choices.
  await expect(page.getByLabel("Max length (optional)")).toHaveValue("8");
  await expect(page.getByLabel("Options — one per line")).toHaveValue(
    OPTIONS.join("\n"),
  );
  expect(await axeViolations(page)).toEqual([]);

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
  expect(fields).toHaveLength(5);

  const texts = fields.filter((f) => f instanceof PDFTextField);
  expect(texts).toHaveLength(1);
  const comb = texts[0] as PDFTextField;
  expect(comb.getName()).toBe("account_number");
  expect(comb.getMaxLength()).toBe(8);
  const cr = comb.acroField.getWidgets()[0]!.getRectangle();
  expect(Math.abs(cr.x - COMB.x)).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs(cr.x + cr.width - (COMB.x + COMB.side * COMB.n)),
  ).toBeLessThanOrEqual(0.5);
  expect(Math.abs(cr.y - COMB.y)).toBeLessThanOrEqual(0.5);
  // Each edge within 0.5 pt of the printed run's: pdf-lib stores a widget
  // inset half its 1 pt border on every side.
  expect(Math.abs(cr.y + cr.height - (COMB.y + COMB.side))).toBeLessThanOrEqual(
    0.5,
  );

  const radios = fields.filter((f) => f instanceof PDFRadioGroup);
  expect(radios).toHaveLength(1);
  const group = radios[0] as PDFRadioGroup;
  expect(group.getName()).toBe("preferred_contact");
  expect(group.getOptions()).toEqual(OPTIONS);
  const widgets = group.acroField.getWidgets();
  expect(widgets).toHaveLength(3);
  const used = new Set<number>();
  for (const w of widgets) {
    const r = w.getRectangle();
    const k = STACK.tops.findIndex(
      (y) =>
        r.x >= STACK.x - 0.5 &&
        r.x + r.width <= STACK.x + STACK.side + 0.5 &&
        r.y >= y - 0.5 &&
        r.y + r.height <= y + STACK.side + 0.5,
    );
    expect(k, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
    expect(used.has(k)).toBe(false);
    used.add(k);
  }

  const boxes = fields.filter((f) => f instanceof PDFCheckBox);
  expect(boxes.map((b) => b.getName()).sort()).toEqual(
    ["driving_licence", "passport", "utility_bill"].sort(),
  );
});
