import { test, expect } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { ANNOTATION_GROUP_IDS } from "../src/lib/pdf/offered-kinds";
import { fullFixture } from "../src/tests/annotation-fixtures";

/**
 * Remove Annotations' kind checkboxes on a 375 px phone: each row — the
 * whole label a thumb presses, not the 20 px box inside it — is a 44 px
 * target inside the screen, and the page does not scroll sideways. The
 * fixture carries every kind, and the kinds are read from the model, so a
 * kind added there is measured here.
 */
const MIN = 44;
const SCREEN = 375;

test.use({ viewport: { width: SCREEN, height: 812 } });

test("every kind row is a 44 px target inside a 375 px screen", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/tools/remove-annotations");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "reviewed.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await fullFixture()),
  });
  const group = page.getByRole("group", {
    name: "Kinds of annotation to remove",
  });
  await expect(group).toBeVisible();
  const rows = group.locator("label[data-group]");
  await expect(rows).toHaveCount(ANNOTATION_GROUP_IDS.length);
  for (const id of ANNOTATION_GROUP_IDS) {
    const row = group.locator(`label[data-group="${id}"]`);
    await row.scrollIntoViewIfNeeded();
    const b = (await row.boundingBox())!;
    expect(b.height, `${id} height`).toBeGreaterThanOrEqual(MIN - 0.5);
    expect(b.x, `${id} left edge`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${id} right edge`).toBeLessThanOrEqual(SCREEN + 1);
  }
  // A press on the row's text toggles its box: the row IS the target.
  const links = group.getByRole("checkbox", { name: /^Links/ });
  await expect(links).not.toBeChecked();
  await group.locator('label[data-group="links"] span').first().click();
  await expect(links).toBeChecked();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(SCREEN);
});
