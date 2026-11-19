import { test, expect } from "@playwright/test";
import { axeViolations } from "./chat-citations-fixture";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { fileInput, waitForHydration } from "./helpers";
import { flatForm } from "./create-forms-detect-fixture";

/**
 * Create Fillable Forms' Find fields on a 375 x 812 touch phone (backlog
 * #17, S2): the review list fits the phone (no sideways scroll), a TAP on
 * a dotted suggestion selects its row and never adds it, every suggestion
 * is at least a 24 px target, Add works from the row, and axe finds
 * nothing.
 */
test.use({ viewport: { width: 375, height: 812 } });

test("Find fields at 375 px: a tap selects, Add adds, nothing overflows", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Find fields" }).tap();
  await expect(page.getByTestId("find-fields-summary")).toContainText(
    "Found 8 possible fields",
    { timeout: 30_000 },
  );
  const rows = page.locator("[data-proposal-row]");
  await expect(rows).toHaveCount(8);

  // Nothing is wider than the phone.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);

  // One suggestion is in the tab order, a target of at least 24 x 24 px.
  const targets = sheet.locator("[data-proposal]");
  await expect(targets).toHaveCount(1);
  const t = (await targets.boundingBox())!;
  expect(t.width).toBeGreaterThanOrEqual(24);
  expect(t.height).toBeGreaterThanOrEqual(24);
  await expect(sheet.locator("[data-proposed]")).toHaveCount(5);

  // A tap on "Email" selects it, and adds nothing.
  const email = sheet.locator('[data-proposed*="1:labelled-rule:112:611"]');
  await email.scrollIntoViewIfNeeded();
  const b = (await email.boundingBox())!;
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await expect(
    sheet.getByRole("button", { name: /^Found text field, “Email”, page 1/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(8);
  await expect(page.locator("[data-field-card]")).toHaveCount(1);

  expect(await axeViolations(page)).toEqual([]);

  // Add from its row.
  await page
    .getByRole("button", { name: /^Add text field “Full name”, page 1/ })
    .tap();
  await expect(rows).toHaveCount(7);
  await expect(
    page.locator("[data-field-card]").getByLabel("Field name"),
  ).toHaveValue("full_name");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
