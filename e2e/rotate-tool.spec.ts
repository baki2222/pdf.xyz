import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf, uploadFiles } from "./helpers";

/**
 * End-to-end proof that the single-file rotate runner works entirely in the
 * browser: we generate a multi-page PDF, stage it, rotate every page, apply the
 * change, and get a downloadable result — all under the production CSP, which
 * also has to permit the pdfjs worker + wasm that render the page previews.
 */
test("rotate spins every page client-side and yields a download", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const source = await writeTempPdf("spin.pdf", 4);

  await page.goto("/tools/rotate-pdf");

  await uploadFiles(page, source);

  // The editor mounts once the PDF is parsed: the file header names the doc.
  await expect(page.getByText("spin.pdf")).toBeVisible();

  // Nothing has changed yet, so applying is a no-op and stays disabled.
  const applyButton = page.getByRole("button", { name: /apply rotation/i });
  await expect(applyButton).toBeDisabled();

  // All pages are selected by default; rotate them a quarter turn right.
  await page.getByRole("button", { name: "Right", exact: true }).click();

  await expect(applyButton).toBeEnabled();
  await applyButton.click();

  await expect(
    page.getByRole("heading", { name: /pdf rotated/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download rotated pdf/i }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});
