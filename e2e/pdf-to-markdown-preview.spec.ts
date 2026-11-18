import { expect, test } from "@playwright/test";
import {
  createMarkdown,
  denyConsent,
  expectTabThenScroll,
  scrollableRegionViolations,
} from "./markdown-preview-fixture";

/**
 * PDF to Markdown's preview, desktop (sweep finding F2, 2026-11-18): Tab
 * reaches it and ArrowDown scrolls it. The 390x844 phone pass is
 * pdf-to-markdown-preview.mobile.spec.ts.
 */

test.beforeEach(async ({ page }) => {
  await denyConsent(page);
});

test("after Create Markdown on a 2-page PDF, Tab reaches the preview and ArrowDown scrolls it", async ({
  page,
}) => {
  const preview = await createMarkdown(page);
  await expectTabThenScroll(page, preview);
  expect(await scrollableRegionViolations(page)).toEqual([]);
});
