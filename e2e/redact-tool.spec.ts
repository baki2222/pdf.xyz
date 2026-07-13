import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf } from "./helpers";

/**
 * End-to-end proof that the redaction runner works entirely in the browser: we
 * stage a multi-page PDF, add a redaction box, and run it — which exercises the
 * bundled pdfjs worker + wasm (raster path) and the canvas paint-over under the
 * production CSP, then yields a downloadable rebuilt PDF.
 */
test("redact bakes a box into a rasterized PDF client-side", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  const source = await writeTempPdf("secret.pdf", 2);

  await page.goto("/tools/redact-pdf");

  await page.locator('input[type="file"]').first().setInputFiles(source);

  // The editor mounts once the PDF is parsed: the file header names the doc.
  await expect(page.getByText("secret.pdf")).toBeVisible();

  // With no areas yet, running is a no-op and stays disabled.
  const redactButton = page.getByRole("button", { name: /^redact pdf$/i });
  await expect(redactButton).toBeDisabled();

  // The default draft box fits the 320×240 pt fixture page — add it once the
  // page sizes have loaded (the button is disabled until then).
  const addButton = page.getByRole("button", { name: /add area/i });
  await addButton.click();

  await expect(page.getByRole("button", { name: /remove redaction area 1/i })).toBeVisible();
  await expect(redactButton).toBeEnabled();
  await redactButton.click();

  await expect(page.getByRole("heading", { name: /redacted pdf ready/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download redacted pdf/i }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});
