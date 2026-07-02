import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf } from "./helpers";

/**
 * End-to-end proof that a "client" tool really runs in the browser: we generate
 * two PDFs, stage them, merge, and get a downloadable result — with the
 * production CSP active (the merge also spins up the pdfjs worker + wasm for
 * cover thumbnails, so a broken policy surfaces here).
 */
test("merge combines uploaded PDFs client-side and yields a download", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const [alpha, beta] = await Promise.all([
    writeTempPdf("alpha.pdf", 2),
    writeTempPdf("beta.pdf", 3),
  ]);

  await page.goto("/tools/merge-pdf");

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([alpha, beta]);

  await expect(page.getByText("alpha.pdf")).toBeVisible();
  await expect(page.getByText("beta.pdf")).toBeVisible();

  const mergeButton = page.getByRole("button", { name: /merge 2 pdfs/i });
  await expect(mergeButton).toBeEnabled();
  await mergeButton.click();

  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download merged pdf/i }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});
