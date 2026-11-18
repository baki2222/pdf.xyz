import { test, expect, type Page } from "@playwright/test";
import { axeViolations } from "./chat-citations-fixture";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";
import { widgetsAsViewed } from "./create-forms-preview-fixture";
import { PRINTED, flatForm } from "./create-forms-detect-fixture";

/**
 * Create Fillable Forms' Find fields (backlog #17, S2), through the PAGE:
 * a flat form generated in this test (labelled lines and boxes on page 1,
 * the same lines on a /Rotate 90 page 2, only negatives on page 3) is
 * opened, Find fields is pressed, one suggestion is added from the preview
 * with Enter, one is dismissed, the rest are added with Add all, the form is
 * created and DOWNLOADED, and pdfjs (in the test process) reads the widgets.
 *
 * Held, each at the point of consumption:
 *  - the widgets are exactly the cards the suggestions became (names,
 *    pages and numbers), and nothing else;
 *  - each widget sits over a line or box the fixture PRINTED there, in the
 *    frame a reader sees (computed by the fixture from its own drawing);
 *  - page 3, all negatives, yields no row; its signature line is counted.
 */
async function open(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
  await page.goto("/tools/create-forms");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "flat-form.pdf",
    mimeType: "application/pdf",
    buffer: await flatForm(),
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
    "Found 8 possible fields on 2 of 3 pages: check each one, as nothing is added until you add it.",
    { timeout: 30_000 },
  );
  expect(fetched.length).toBeGreaterThan(before);
  await expect(summary).toContainText(
    "1 signature line was skipped: use Sign PDF for those.",
  );
  await expect(summary.getByRole("link", { name: "Sign PDF" })).toHaveAttribute(
    "href",
    "/tools/sign-pdf",
  );
  await expect(summary).toContainText(
    "Nothing was suggested on page 3: check it and add any field by hand.",
  );
  await expect(rows(page)).toHaveCount(8);
  // The negatives page yields no row.
  for (const text of await rows(page).allInnerTexts())
    expect(text).not.toMatch(/page 3\b/);
  await expect(
    page.getByText("8 found fields are not added and will not be in the form."),
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
    const b = (await sheet.locator(`[data-proposed*="${key}"]`).boundingBox())!;
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
  await expect(page.getByText(/found fields? (is|are) not added/)).toHaveCount(
    0,
  );

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
      // A line: horizontal on page 1, turned vertical on page 2. The
      // widget runs along it and starts within 2 pt of it, on its side.
      if (p.y0 === p.y1)
        return (
          pts.x >= p.x0 - 0.5 &&
          pts.x + pts.width <= p.x1 + 0.5 &&
          pts.y >= p.y0 - 0.5 &&
          pts.y <= p.y0 + 2
        );
      return (
        pts.y >= p.y0 - 0.5 &&
        pts.y + pts.height <= p.y1 + 0.5 &&
        pts.x >= p.x0 - 0.5 &&
        pts.x <= p.x0 + 2
      );
    });
    expect(on, `${w.name} sits on a printed line or box`).toBeTruthy();
  }
  // Health: page 2 is the turned page, and its widgets were checked there.
  expect(widgets.filter((w) => w.page === 2)).toHaveLength(3);
  expect(widgets.find((w) => w.page === 2)!.pageWidth).toBe(696);
});
