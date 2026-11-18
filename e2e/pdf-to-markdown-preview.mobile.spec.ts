import { expect, test } from "@playwright/test";
import {
  createMarkdown,
  denyConsent,
  expectTabThenScroll,
  scrollableRegionViolations,
} from "./markdown-preview-fixture";

/**
 * PDF to Markdown's preview on a phone (sweep finding F2, 2026-11-18): the
 * mobile project's 390x844 touch device, with a keyboard attached. Tab
 * reaches the preview and ArrowDown scrolls it.
 */

test.beforeEach(async ({ page }) => {
  await denyConsent(page);
});

test("phone: after Create Markdown on a 2-page PDF, Tab reaches the preview and ArrowDown scrolls it", async ({
  page,
}) => {
  const preview = await createMarkdown(page);
  expect(page.viewportSize()?.width).toBeLessThan(500);
  await expectTabThenScroll(page, preview);
  expect(await scrollableRegionViolations(page)).toEqual([]);
});
