import { expect, test } from "@playwright/test";
import {
  axeViolations,
  convertTable,
  denyConsent,
  expectStyledCells,
} from "./markdown-table-cells-fixture";

/**
 * Markdown to PDF's styled table cells at 375x812 (backlog #24): the same
 * document, typed and converted on a phone-sized page, decodes the same, and
 * the page neither scrolls sideways nor fails axe.
 */

test.use({ viewport: { width: 375, height: 812 } });

test.beforeEach(async ({ page }) => {
  await denyConsent(page);
});

test("375x812: the styled table converts and decodes, with no sideways scroll", async ({
  page,
}) => {
  const bytes = await convertTable(page);
  expect(page.viewportSize()).toEqual({ width: 375, height: 812 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectStyledCells(bytes);
  expect(await axeViolations(page)).toEqual([]);
});
