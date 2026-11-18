import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { axeViolations } from "./chat-citations-fixture";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";
import { widgetsAsViewed } from "./create-forms-preview-fixture";
import {
  PRINTED,
  flatForm,
  starterShadowForm,
} from "./create-forms-detect-fixture";

/**
 * Create Fillable Forms' Find fields (backlog #17, S2), through the PAGE:
 * a flat form generated in this test (labelled lines and boxes on page 1,
 * the same lines on a landscape page 2, only negatives on page 3, the same
 * lines shown SIDEWAYS on page 4) is opened, Find fields is pressed, one
 * suggestion is added from the preview with Enter, one is dismissed, the
 * rest are added with Add all, the form is created and DOWNLOADED, and
 * pdfjs and pdf-lib (in the test process) read the widgets.
 *
 * Held, each at the point of consumption:
 *  - the widgets are exactly the cards the suggestions became (names,
 *    pages and numbers), and nothing else;
 *  - each widget sits over a line or box the fixture PRINTED there, in the
 *    frame a reader sees (computed by the fixture from its own drawing),
 *    and a text widget's typed text runs ALONG its line as the reader sees
 *    it (review round 7: a sideways page passed the "sits on" check with
 *    fields whose text crossed the line);
 *  - page 3, all negatives, yields no row; its signature line is counted;
 *  - page 4, shown sideways, yields no row, and the summary says why.
 */
async function open(page: Page, buffer?: Buffer) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/create-forms");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "flat-form.pdf",
    mimeType: "application/pdf",
    buffer: buffer ?? (await flatForm()),
  });
  const sheet = page.getByTestId("form-page-preview");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  return sheet;
}

const rows = (page: Page) => page.locator("[data-proposal-row]");

test("Find fields: dismiss one, add the rest, and the saved widgets sit on the printed lines", async ({
  page,
}) => {
  const sheet = await open(page);
  // Nothing of the finder is fetched until the button is pressed.
  const fetched: string[] = [];
  page.on("request", (r) => fetched.push(r.url()));
  const before = fetched.length;
  await page.getByRole("button", { name: "Find fields" }).click();
  const summary = page.getByTestId("find-fields-summary");
  await expect(summary).toContainText(
    "Found 8 possible fields on 2 of 4 pages: check each one, as nothing is added until you add it.",
    { timeout: 30_000 },
  );
  expect(fetched.length).toBeGreaterThan(before);
  await expect(summary).toContainText(
    "It can miss a field or suggest a wrong one, so check each page and add anything it missed with Add field.",
  );
  await expect(summary).toContainText(
    "1 line labelled as a signature was skipped: Edit PDF adds a signature field, and Sign PDF signs the PDF.",
  );
  await expect(summary.getByRole("link", { name: "Sign PDF" })).toHaveAttribute(
    "href",
    "/tools/sign-pdf",
  );
  await expect(summary.getByRole("link", { name: "Edit PDF" })).toHaveAttribute(
    "href",
    "/tools/edit-pdf",
  );
  await expect(summary).toContainText(
    "Nothing was suggested on page 3: check it and add any field by hand.",
  );
  await expect(summary).toContainText(
    "The writing on page 4 shows sideways or upside down, which Find fields cannot read: add those fields by hand.",
  );
  await expect(rows(page)).toHaveCount(8);
  // The negatives page and the sideways page yield no row.
  for (const text of await rows(page).allInnerTexts())
    expect(text).not.toMatch(/page [34]\b/);
  await expect(
    page.getByText("8 found fields are not in the form until you add them."),
  ).toBeVisible();

  // Each suggestion on page 1 is drawn dotted; ONE is in the tab order (the
  // first), a target of at least 24 px.
  const dotted = sheet.locator("[data-proposed]");
  await expect(dotted).toHaveCount(5);
  await expect(sheet.locator("[data-proposal]")).toHaveCount(1);
  const first = (await sheet.locator("[data-proposal]").boundingBox())!;
  expect(first.width).toBeGreaterThanOrEqual(24);
  expect(first.height).toBeGreaterThanOrEqual(24);
  expect(await axeViolations(page)).toEqual([]);

  /** Press the middle of a suggestion's dotted box. */
  const press = async (key: string) => {
    const box = sheet.locator(`[data-proposed*="${key}"]`);
    await box.scrollIntoViewIfNeeded();
    const b = (await box.boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  };

  // A press on a suggestion selects it, and adds nothing.
  await press(":square-checkbox:73:501");
  const target = sheet.getByRole("button", {
    name: /^Found checkbox, “Contact me by email”, page 1/,
  });
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(8);
  await expect(page.locator("[data-field-card]")).toHaveCount(1);

  // Enter on the preview adds "Email" (and replaces the untouched starter).
  await press("1:labelled-rule:112:611");
  await sheet
    .getByRole("button", { name: /^Found text field, “Email”, page 1/ })
    .press("Enter");
  await expect(rows(page)).toHaveCount(7);
  await expect(page.locator("[data-field-card]")).toHaveCount(1);
  await expect(
    page.locator("[data-field-card]").getByLabel("Field name"),
  ).toHaveValue("email");
  await expect(
    page.locator("[data-field-card]").getByLabel("Field name"),
  ).toBeFocused();

  // Dismiss "Phone" on page 1 from its row.
  await page
    .getByRole("button", { name: /^Dismiss text field “Phone”, page 1/ })
    .click();
  await expect(rows(page)).toHaveCount(6);

  await page.getByRole("button", { name: /^Add all \(6\)/ }).click();
  await expect(rows(page)).toHaveCount(0);
  const cards = page.locator("[data-field-card]");
  await expect(cards).toHaveCount(7);
  await expect(
    page.getByText(/found fields? (is|are) not in the form/),
  ).toHaveCount(0);

  // What each card says, as the engine will be handed it.
  const want = [];
  for (let i = 0; i < 7; i++) {
    const card = cards.nth(i);
    const num = async (label: string) =>
      Number(await card.getByLabel(label, { exact: true }).inputValue());
    want.push({
      name: await card.getByLabel("Field name").inputValue(),
      page: await num("Page"),
      x: await num("X"),
      y: await num("Y"),
      width: await num("Width"),
      height: await num("Height"),
    });
  }
  expect(want.map((w) => w.name).sort()).toEqual(
    [
      "contact_me_by_email",
      "email",
      "email_2",
      "full_name",
      "full_name_2",
      "phone",
      "send_the_newsletter",
    ].sort(),
  );

  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByText("Fillable form ready")).toBeVisible({
    timeout: 20_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download form PDF" }).click(),
  ]);
  const widgets = await widgetsAsViewed((await download.path())!);
  expect(widgets).toHaveLength(7);
  expect(widgets.map((w) => w.name).sort()).toEqual(
    want.map((w) => w.name).sort(),
  );
  for (const w of widgets) {
    const card = want.find((c) => c.name === w.name)!;
    const pts = {
      x: w.x * w.pageWidth,
      y: w.y * w.pageHeight,
      width: w.width * w.pageWidth,
      height: w.height * w.pageHeight,
    };
    // The widget is the card (pdf-lib's half-point border on every side).
    expect(w.page, w.name).toBe(card.page);
    expect(Math.abs(pts.x - card.x), `${w.name} x`).toBeLessThanOrEqual(0.51);
    expect(Math.abs(pts.y - card.y), `${w.name} y`).toBeLessThanOrEqual(0.51);
    expect(Math.abs(pts.width - card.width), `${w.name} w`).toBeLessThanOrEqual(
      1.01,
    );
    expect(
      Math.abs(pts.height - card.height),
      `${w.name} h`,
    ).toBeLessThanOrEqual(1.01);
    // And it sits on something the fixture PRINTED there.
    const on = PRINTED.filter((p) => p.page === w.page).find((p) => {
      if (p.kind === "square")
        return (
          pts.x >= p.x0 - 0.5 &&
          pts.x + pts.width <= p.x1 + 0.5 &&
          pts.y >= p.y0 - 0.5 &&
          pts.y + pts.height <= p.y1 + 0.5
        );
      // A line, level as the reader sees it on pages 1 and 2 (page 2 is a
      // landscape page shown upright). The widget runs along it and starts
      // within 2 pt above it. Until review round 7 a second branch accepted
      // a line running UP the displayed page (page 2 was then shown
      // sideways), so a field across its line passed.
      return (
        p.y0 === p.y1 &&
        pts.x >= p.x0 - 0.5 &&
        pts.x + pts.width <= p.x1 + 0.5 &&
        pts.y >= p.y0 - 0.5 &&
        pts.y <= p.y0 + 2
      );
    });
    expect(on, `${w.name} sits on a printed line or box`).toBeTruthy();
    // A text field's typed text runs along its line as shown: wider than
    // tall on screen, and its /MK /R turns its text as the page turns.
    if (on?.kind === "line")
      expect(pts.width, `${w.name} runs along its line`).toBeGreaterThan(
        pts.height,
      );
  }
  // The widgets' text turns with their page, so it reads upright on screen.
  const saved = await PDFDocument.load(readFileSync((await download.path())!));
  const turns = saved.getPages().map((p) => p.getRotation().angle);
  const fields = saved.getForm().getFields();
  expect(fields).toHaveLength(7);
  for (const field of fields)
    for (const widget of field.acroField.getWidgets()) {
      const pageIndex = saved.getPages().findIndex((p) => p.ref === widget.P());
      const mk = widget.dict.lookupMaybe(PDFName.of("MK"), PDFDict);
      const r = mk?.lookupMaybe(PDFName.of("R"), PDFNumber)?.asNumber() ?? 0;
      expect(
        (((r - turns[pageIndex]!) % 360) + 360) % 360,
        `${field.getName()} text turns with page ${pageIndex + 1}`,
      ).toBe(0);
    }
  // Health: page 2 is the turned page, and its widgets were checked there.
  expect(widgets.filter((w) => w.page === 2)).toHaveLength(3);
  expect(widgets.find((w) => w.page === 2)!.pageWidth).toBe(696);
  expect(turns).toEqual([0, 90, 0, 90]);
});

test("Find fields: a line under the untouched starter card is suggested, and Add puts its field there", async ({
  page,
}) => {
  // Review round 7: the untouched starter card's box (x 72..272, y 700..724)
  // was handed to the finder, which dropped the line under it without a
  // word; the first Add then deleted the starter, leaving that line bare.
  await open(page, await starterShadowForm());
  await page.getByRole("button", { name: "Find fields" }).click();
  const summary = page.getByTestId("find-fields-summary");
  await expect(summary).toContainText("Found 2 possible fields", {
    timeout: 30_000,
  });
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Full name");
  await page.getByRole("button", { name: /^Add all \(2\)/ }).click();
  const names = page.locator("[data-field-card]").getByLabel("Field name");
  await expect(names).toHaveCount(2);
  expect(
    (
      await names.evaluateAll((els) =>
        els.map((e) => (e as HTMLInputElement).value),
      )
    ).sort(),
  ).toEqual(["email", "full_name"]);
});
