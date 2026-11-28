import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  type PDFTextField,
} from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";

/**
 * Fill Forms in the served page (audits fill-forms#8 and fill-forms#6):
 *  - a form with two required fields left empty: pressing Fill form names
 *    BOTH before anything runs, and Fill anyway goes ahead;
 *  - a value the engine refuses (right-to-left text) is listed after the run
 *    by its field name, with the reason;
 *  - a Cyrillic name typed into a field reaches the DOWNLOAD: /V holds the
 *    exact string and the field's appearance names an embedded font.
 */

const FIELDS = {
  surname: "applicant.surname",
  dob: "applicant.dob",
  name: "applicant.name",
  notes: "applicant.notes",
} as const;

async function requiredForm(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 520]);
  const form = doc.getForm();
  let y = 440;
  for (const name of Object.values(FIELDS)) {
    const field = form.createTextField(name);
    if (name === FIELDS.surname || name === FIELDS.dob) field.enableRequired();
    field.addToPage(page, { x: 40, y, width: 260, height: 26 });
    y -= 50;
  }
  return Buffer.from(await doc.save());
}

/** The text box on the row that names `field`. */
function inputFor(page: Page, field: string) {
  return page
    .getByTitle(field, { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]")
    .locator('input[type="text"]');
}

test("required fields are named before filling; refused values are listed by name; Cyrillic reaches the download", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/fill-forms");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: await requiredForm(),
  });
  await expect(page.getByTitle(FIELDS.surname, { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await inputFor(page, FIELDS.name).fill("Иван");
  await inputFor(page, FIELDS.notes).fill("مرحبا");
  await page.getByRole("button", { name: "Fill form", exact: true }).click();

  const alert = page.getByRole("alert").filter({ hasText: "required" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(FIELDS.surname);
  await expect(alert).toContainText(FIELDS.dob);
  await expect(alert).not.toContainText(FIELDS.name);
  // Nothing has run yet.
  await expect(
    page.getByRole("button", { name: "Download filled PDF" }),
  ).toHaveCount(0);

  await alert.getByRole("button", { name: "Fill anyway" }).click();
  const download = page.getByRole("button", { name: "Download filled PDF" });
  await expect(download).toBeVisible({ timeout: 30_000 });

  const list = page.getByRole("list", { name: /couldn.t be applied/ });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem")).toContainText(FIELDS.notes);
  await expect(list.getByRole("listitem")).toContainText("Arabic");

  const saved = page.waitForEvent("download");
  await download.click();
  const file = await (await saved).path();
  const doc = await PDFDocument.load(readFileSync(file!));
  const field = doc.getForm().getField(FIELDS.name) as PDFTextField;
  expect(field.getText()).toBe("Иван");
  // The refused field is left as it came.
  expect(
    (doc.getForm().getField(FIELDS.notes) as PDFTextField).getText(),
  ).toBeUndefined();
  const normal = field.acroField.getWidgets()[0]!.getAppearances()!
    .normal as PDFStream;
  const fonts = normal.dict
    .lookup(PDFName.of("Resources"), PDFDict)
    .lookup(PDFName.of("Font"), PDFDict);
  const font = fonts.lookup(fonts.keys()[0]!, PDFDict);
  // An embedded composite (Type0) face, not the form's standard Helvetica.
  expect(font.get(PDFName.of("Subtype"))?.toString()).toBe("/Type0");
});
