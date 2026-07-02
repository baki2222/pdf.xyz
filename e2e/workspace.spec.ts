import { test, expect } from "@playwright/test";
import { attachConsoleGuard, writeTempPdf } from "./helpers";

/**
 * The workspace is a local-first command center: files are staged in browser
 * state only (never uploaded), the UI suggests tools from the file mix, a batch
 * queue lines files up for a tool, and only tool choices — never file names —
 * persist. These tests exercise those promises end-to-end.
 */

async function waitForWorkspaceHydration(page: import("@playwright/test").Page) {
  await expect(
    page.getByText(/tools you open from here show up/i),
  ).toBeVisible();
}

test("stages files locally, summarizes the mix, removes and clears them", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const [contract, invoice] = await Promise.all([
    writeTempPdf("contract.pdf", 2),
    writeTempPdf("invoice.pdf", 1),
  ]);

  await page.goto("/workspace");
  await waitForWorkspaceHydration(page);

  // Honest, local-only framing is present up front.
  await expect(page.getByText(/local session only/i)).toBeVisible();
  await expect(page.getByText(/nothing is uploaded/i).first()).toBeVisible();

  // Stage two documents — purely in browser memory.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([contract, invoice]);

  const staged = page.getByRole("list", { name: /staged files/i });
  await expect(staged.getByText("contract.pdf")).toBeVisible();
  await expect(staged.getByText("invoice.pdf")).toBeVisible();
  await expect(staged.getByText("PDF").first()).toBeVisible();

  // Each PDF gets a page count parsed locally in the browser (never uploaded);
  // contract.pdf has two pages, invoice.pdf one.
  await expect(staged.getByText(/2 pages/)).toBeVisible();
  await expect(staged.getByText(/1 page(?!s)/)).toBeVisible();

  // The summary counts files and breaks the mix down by type.
  await expect(page.getByText(/2 files/i)).toBeVisible();
  await expect(
    page.getByRole("list", { name: /file types staged/i }).getByText(/PDF/),
  ).toBeVisible();

  // Removing one leaves the other staged.
  await page.getByRole("button", { name: "Remove contract.pdf" }).click();
  await expect(staged.getByText("contract.pdf")).toHaveCount(0);
  await expect(staged.getByText("invoice.pdf")).toBeVisible();

  // Clear-all empties the staging list and shows the empty state.
  await page.getByRole("button", { name: /clear all/i }).click();
  await expect(page.getByRole("list", { name: /staged files/i })).toHaveCount(0);
  await expect(page.getByText(/no files staged yet/i)).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("suggests tools from the staged file mix and links to the runner", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await waitForWorkspaceHydration(page);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([await writeTempPdf("a.pdf"), await writeTempPdf("b.pdf")]);

  // Two PDFs → "Merge PDF" is suggested, first, with honest in-browser framing.
  await expect(
    page.getByRole("heading", { name: /suggested for your files/i }),
  ).toBeVisible();
  const suggested = page.getByRole("region", { name: /suggested for your files/i });
  const mergeLink = suggested.locator('a[href="/tools/merge-pdf"]');
  await expect(mergeLink).toBeVisible();
  await expect(mergeLink).toContainText(/merge pdf/i);
  await expect(mergeLink).toContainText(/2 pdfs/i);
  await expect(mergeLink.getByText(/in-browser/i)).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("surfaces the deep-linked tool as Suggested and routes to its runner", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace?tool=rotate-pdf");

  // Arriving with ?tool=<tool> surfaces it as the suggested next step.
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

test("batch queue launches a live tool and is honest about worker tools", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await waitForWorkspaceHydration(page);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([await writeTempPdf("a.pdf"), await writeTempPdf("b.pdf")]);

  const batch = page.getByRole("region", { name: /batch queue/i });
  await expect(batch).toBeVisible();

  // Choose a live in-browser tool and queue the staged files.
  await batch.getByLabel("Tool").selectOption("merge-pdf");
  await batch.getByRole("button", { name: /add all staged/i }).click();
  await expect(batch.getByRole("list", { name: /batch queue/i })).toContainText(
    "a.pdf",
  );

  // Ready to launch — clicking it creates a browser-only handoff and preloads
  // the real in-browser runner. The handoff token is consumed and stripped from
  // the URL, so users do not get a shareable file link.
  await expect(batch.getByText(/ready/i)).toBeVisible();
  await batch.getByRole("button", { name: /open merge pdf with 2 files/i }).click();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(page.getByText("a.pdf")).toBeVisible();
  await expect(page.getByText("b.pdf")).toBeVisible();
  await expect(page.getByText(/loaded .* from your workspace/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /merge 2 pdfs/i })).toBeEnabled();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("batch queue is honest about secure-worker tools", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await waitForWorkspaceHydration(page);
  await page.locator('input[type="file"]').first().setInputFiles(await writeTempPdf("scan.pdf"));

  const batch = page.getByRole("region", { name: /batch queue/i });
  await batch.getByLabel("Tool").selectOption("ocr-pdf");
  await batch.getByRole("button", { name: /add all staged/i }).click();

  // Secure-worker tools do not fake a local handoff; they route to the honest
  // worker preview instead.
  await expect(batch.getByText(/runs on a secure worker/i)).toBeVisible();
  await expect(
    batch.getByRole("link", { name: /see how it works/i }),
  ).toHaveAttribute("href", "/tools/ocr-pdf");

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("remembers recent activity across navigation (local only)", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace?tool=rotate-pdf");

  // Opening a tool from the workspace records it as recent activity.
  await page.getByRole("main").locator('a[href="/tools/rotate-pdf"]').click();
  await expect(page).toHaveURL(/\/tools\/rotate-pdf$/);

  // Returning restores the activity from localStorage (no file names stored).
  await page.goto("/workspace");
  const activity = page.getByRole("region", { name: /recent activity/i });
  await expect(activity.getByText(/opened rotate pdf/i)).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});
