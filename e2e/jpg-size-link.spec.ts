import { expect, test, type Page } from "@playwright/test";
import { fileInput, waitForHydration } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { JPEG_30X20 } from "../src/tests/jpeg-fixtures";

/**
 * JPG to PDF's `?size=` link (audit #2, 2026-11-17), on the served build. The
 * JPG size guide's table links here with a size set; the limit is set when
 * the first image is added. A size the table does not list sets nothing, and
 * the link changes nothing on the page before an image is added, so it moves
 * nothing either (layout shift measured from navigation).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
    // Every layout shift not caused by input, from the first paint.
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[])
        if (!entry.hadRecentInput)
          (window as unknown as { __cls: number }).__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  }, CONSENT_STORAGE_KEY);
});

async function openWithImage(page: Page, search: string) {
  await page.goto(`/tools/jpg-to-pdf${search}`);
  const input = fileInput(page);
  await waitForHydration(input);
  const cls = await page.evaluate(
    () => (window as unknown as { __cls: number }).__cls,
  );
  await input.setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(JPEG_30X20),
  });
  await expect(page.getByText("photo.jpg").first()).toBeVisible({
    timeout: 20_000,
  });
  return cls;
}

const limitChip = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Max file size" })
    .getByRole("button", { name, exact: true });

test("?size=300kb: once an image is added, Custom shows 300, and Create PDF makes the PDF", async ({
  page,
}) => {
  const cls = await openWithImage(page, "?size=300kb");
  expect(cls).toBeLessThanOrEqual(0.01);
  await expect(limitChip(page, "Custom")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("textbox", { name: "Custom max file size in KB" }),
  ).toHaveValue("300");
  await expect(page.getByText(/^Enter a whole number of KB/)).toHaveCount(0);
  await page.getByRole("button", { name: /create pdf/i }).click();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible({
    timeout: 20_000,
  });
});

test("?size=200kb sets the 200 KB limit", async ({ page }) => {
  await openWithImage(page, "?size=200kb");
  await expect(limitChip(page, "200 KB")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("?size=150kb, a size the guide does not list: No limit, as without a link", async ({
  page,
}) => {
  await openWithImage(page, "?size=150kb");
  await expect(limitChip(page, "No limit")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
