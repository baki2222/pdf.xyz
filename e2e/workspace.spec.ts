import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf } from "./helpers";

/**
 * The workspace is a local-first staging shell: files live in browser state
 * only, never uploaded. These tests exercise that promise end-to-end — staging,
 * per-file removal, clear-all — plus the honest "pick a live tool" routing.
 */
test("workspace stages files locally, lists them, and clears them", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const [contract, invoice] = await Promise.all([
    writeTempPdf("contract.pdf", 2),
    writeTempPdf("invoice.pdf", 1),
  ]);

  await page.goto("/workspace");

  // Honest, local-only framing and the live-tool chooser are both present.
  await expect(page.getByText(/local session only/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /run a tool/i })).toBeVisible();

  // Stage two documents — purely in browser memory.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([contract, invoice]);

  const staged = page.getByRole("list", { name: /staged files/i });
  await expect(staged.getByText("contract.pdf")).toBeVisible();
  await expect(staged.getByText("invoice.pdf")).toBeVisible();
  // Each card surfaces the file type.
  await expect(staged.getByText("PDF").first()).toBeVisible();
  await expect(page.getByText(/2 files/i)).toBeVisible();

  // Removing one leaves the other staged.
  await page.getByRole("button", { name: "Remove contract.pdf" }).click();
  await expect(staged.getByText("contract.pdf")).toHaveCount(0);
  await expect(staged.getByText("invoice.pdf")).toBeVisible();

  // Clear-all empties the staging list entirely.
  await page.getByRole("button", { name: /clear all/i }).click();
  await expect(page.getByRole("list", { name: /staged files/i })).toHaveCount(0);

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("workspace suggests the deep-linked tool and routes to its runner", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace?tool=rotate-pdf");

  // Arriving with ?tool=<live-tool> surfaces it as the suggested next step.
  await expect(page.getByText("Suggested")).toBeVisible();
  const rotateLink = page
    .getByRole("main")
    .locator('a[href="/tools/rotate-pdf"]');
  await expect(rotateLink).toBeVisible();

  // Picking it routes to the real, in-browser tool page.
  await rotateLink.click();
  await expect(page).toHaveURL(/\/tools\/rotate-pdf$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Rotate PDF" }),
  ).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});
