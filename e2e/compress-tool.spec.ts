import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf, uploadFiles } from "./helpers";

/**
 * Proves the Compress tool is honest end-to-end: it analyzes the PDF entirely in
 * the browser (real stats, lossless repack) and clearly labels the secure-worker
 * deep-compression path. In the production build the worker ships disabled, so
 * the page must say so and must NOT offer an upload-backed run — nothing leaves
 * the device. All under the production CSP.
 */
test("compress analyzes in-browser and honestly labels the worker path", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const file = await writeTempPdf("shrink.pdf", 4);

  await page.goto("/tools/compress-pdf");

  // Hybrid tools get the honest banner, not the pure in-browser guarantee.
  await expect(
    page.getByText(/any secure-server step is optional/i),
  ).toBeVisible();

  await uploadFiles(page, file);

  // Real in-browser analysis renders. The labels below are matched EXACTLY:
  // since the seo/content merge the page's own copy quotes them ("the tiles
  // Current size, Pages, …", "In the “Deep image compression (secure
  // worker)” panel …"), so a substring match found the copy as well as the
  // runner and failed on strict mode. The runner's element is the one whose
  // whole text is the label.
  await expect(page.getByText("shrink.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("Current size", { exact: true })).toBeVisible();

  // The secure-worker deep path is present but honestly labeled "Not enabled".
  await expect(
    page.getByText("Deep image compression (secure server)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not enabled", { exact: true })).toBeVisible();
  // The fallback detail names its own vantage (this web process) rather than
  // making a deployment-wide claim — the old "no secure worker is configured"
  // wording read as global and contradicted live deployments.
  await expect(
    page.getByText(/this web process runs no in-process worker/i),
  ).toBeVisible();

  // With the worker disabled there is no run button — the file is never uploaded.
  await expect(
    page.getByRole("button", { name: /compress images on our server/i }),
  ).toHaveCount(0);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

/*
 * Batch plan P0b, review: Remove before Run, from the keyboard. Pressing a
 * row's Remove unmounts the button that has focus; focus goes to the next
 * row's Remove rather than falling to the page. And a Remove that leaves one
 * file hands it to the single-file panel (its analysis, every option), which
 * takes the focus. A real Enter, in a real browser: jsdom cannot press one.
 */
test("Compress batch: Remove by keyboard keeps focus, and the last file goes to the single panel", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const files = await Promise.all(
    ["first.pdf", "second.pdf", "third.pdf"].map((name) =>
      writeTempPdf(name, 2),
    ),
  );
  await page.goto("/tools/compress-pdf");
  await uploadFiles(page, files);

  const removeFirst = page.getByRole("button", { name: "Remove first.pdf" });
  await expect(removeFirst).toBeVisible({ timeout: 20_000 });
  await removeFirst.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove second.pdf" }),
  ).toBeFocused();

  await page.keyboard.press("Enter");
  // One file left: the single-file panel, analysing third.pdf, has focus.
  await expect(page.locator("[data-compress-stage]")).toBeFocused();
  await expect(page.getByText("Current size", { exact: true })).toBeVisible();
  await expect(page.getByText("third.pdf", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Files in this batch" }),
  ).toHaveCount(0);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});
