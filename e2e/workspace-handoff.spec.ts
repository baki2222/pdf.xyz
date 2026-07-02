import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf } from "./helpers";

/**
 * The Phase 9 promise: files staged in `/workspace` can be handed off to a live
 * in-browser tool without ever uploading them. The hand-off rides through the
 * browser's own IndexedDB (single-use, short-TTL, token stripped from the URL),
 * so these tests prove the real end-to-end flow — stage → launch → pre-loaded
 * runner → run → download — under the production build and CSP.
 */

test("hands a batch off from the workspace to Compress and runs it in-browser", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      await writeTempPdf("one.pdf", 3),
      await writeTempPdf("two.pdf", 2),
    ]);

  const batch = page.getByRole("region", { name: /batch queue/i });
  await batch.getByLabel("Tool").selectOption("compress-pdf");
  await batch.getByRole("button", { name: /add all staged/i }).click();

  // Two files + a batch-ready tool → real hand-off into the batch runner.
  await batch
    .getByRole("button", { name: /open compress pdf with 2 files/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);

  // Files arrived, pre-loaded, still local.
  await expect(page.getByText(/loaded .* from your workspace/i)).toBeVisible();
  await expect(page.getByText("one.pdf")).toBeVisible();
  await expect(page.getByText("two.pdf")).toBeVisible();

  // Run the deterministic, on-device lossless batch and get downloadable output.
  await page.getByRole("button", { name: /compress 2 pdfs/i }).click();
  await expect(page.getByRole("button", { name: /download all/i })).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("hands a single PDF off from the workspace to Rotate and runs it", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(await writeTempPdf("turn.pdf", 2));

  const batch = page.getByRole("region", { name: /batch queue/i });
  await batch.getByLabel("Tool").selectOption("rotate-pdf");
  await batch.getByRole("button", { name: /add all staged/i }).click();

  // Rotate is one-file-at-a-time — the panel says so, honestly.
  await expect(batch.getByText(/opens your first file/i)).toBeVisible();
  await batch.getByRole("button", { name: /open rotate pdf/i }).click();
  await expect(page).toHaveURL(/\/tools\/rotate-pdf$/);

  // The staged PDF is pre-loaded into the real runner.
  await expect(page.getByText(/loaded .* from your workspace/i)).toBeVisible();
  await expect(page.getByText("turn.pdf")).toBeVisible();

  // Rotate all pages and export.
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await page.getByRole("button", { name: /apply rotation/i }).click();
  await expect(page.getByRole("heading", { name: /pdf rotated/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download rotated pdf/i }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("shows an honest expired state for a stale hand-off token", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  // A well-formed but unknown token: nothing to claim → expired, not a crash.
  await page.goto("/tools/merge-pdf?handoff=h_deadbeefdeadbeef00");

  await expect(
    page.getByText(/hand-off expired or was already used/i),
  ).toBeVisible();
  // Falls back to the normal picker, and the dead token is stripped from the URL.
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});
