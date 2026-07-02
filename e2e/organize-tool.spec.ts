import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf } from "./helpers";

/**
 * Proves the Organize Pages editor works end-to-end in the browser: it loads a
 * real PDF, builds the page board (which spins up the pdfjs worker + wasm for
 * thumbnails under the production CSP), and drives the undo/redo timeline —
 * exercising the history reducer and edit controls through real user actions.
 */
test("organize loads a PDF and supports edit → undo → redo", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  const file = await writeTempPdf("organize.pdf", 3);

  await page.goto("/tools/organize-pages");
  await expect(
    page.getByRole("heading", { level: 1, name: "Organize Pages" }),
  ).toBeVisible();

  await page.locator('input[type="file"]').first().setInputFiles(file);

  // The page board renders from the loaded document.
  await expect(page.getByText("organize.pdf")).toBeVisible();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();

  const applyButton = page.getByRole("button", { name: /apply.*export/i });
  const undoButton = page.getByRole("button", { name: "Undo" });
  const redoButton = page.getByRole("button", { name: "Redo" });
  const reverseButton = page.getByRole("button", { name: "Reverse" });

  // A fresh document isn't dirty: nothing to export, nothing to undo.
  await expect(applyButton).toBeDisabled();
  await expect(undoButton).toBeDisabled();
  await expect(redoButton).toBeDisabled();

  // Make an edit → the document is dirty and undoable.
  await reverseButton.click();
  await expect(applyButton).toBeEnabled();
  await expect(undoButton).toBeEnabled();

  // Undo returns to the pristine order (not dirty) and offers a redo.
  await undoButton.click();
  await expect(applyButton).toBeDisabled();
  await expect(undoButton).toBeDisabled();
  await expect(redoButton).toBeEnabled();

  // Redo re-applies the edit.
  await redoButton.click();
  await expect(applyButton).toBeEnabled();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});
