import { test, expect } from "@playwright/test";
import {
  attachConsoleGuard,
  fileInput,
  uploadFiles,
  waitForHydration,
  writeTempPdf,
  writeTempScanPdf,
} from "./helpers";

/**
 * The workspace is a local-first command center: files are staged in browser
 * state only (never uploaded), the UI suggests tools from the file mix, a batch
 * queue lines files up for a tool, and only tool choices — never file names —
 * persist. These tests exercise those promises end-to-end.
 */

test("stages files locally, summarizes the mix, removes and clears them", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const [contract, invoice] = await Promise.all([
    writeTempPdf("contract.pdf", 2),
    writeTempPdf("invoice.pdf", 1),
  ]);

  await page.goto("/workspace");
  await waitForHydration(fileInput(page));

  // Honest, local-only framing is present up front.
  await expect(page.getByText(/local session only/i)).toBeVisible();
  await expect(page.getByText(/nothing is uploaded/i).first()).toBeVisible();

  // Stage two documents — purely in browser memory.
  await uploadFiles(page, [contract, invoice]);

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
  await expect(page.getByRole("list", { name: /staged files/i })).toHaveCount(
    0,
  );
  await expect(page.getByText(/no files staged yet/i)).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("suggests tools from the staged file mix and links to the runner", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await uploadFiles(page, [
    await writeTempPdf("a.pdf"),
    await writeTempPdf("b.pdf"),
  ]);

  // Two PDFs → "Merge PDF" is suggested, first, with honest in-browser framing.
  await expect(
    page.getByRole("heading", { name: /suggested for your files/i }),
  ).toBeVisible();
  const suggested = page.getByRole("region", {
    name: /suggested for your files/i,
  });
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

  // Arriving with ?tool=<tool> surfaces it as the suggested next step. The
  // tools panel is in the page twice (under the files on a phone, in the
  // aside on a wide screen; one display:none), so the visible copy is meant.
  await expect(
    page.getByText("Suggested", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  const rotateLink = page
    .getByRole("main")
    .locator('a[href="/tools/rotate-pdf"]')
    .filter({ visible: true });
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
  await uploadFiles(page, [
    await writeTempPdf("a.pdf"),
    await writeTempPdf("b.pdf"),
  ]);

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
  await batch
    .getByRole("button", { name: /open merge pdf with 2 files/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(page.getByText("a.pdf")).toBeVisible();
  await expect(page.getByText("b.pdf")).toBeVisible();
  await expect(page.getByText(/loaded .* from your workspace/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /merge 2 pdfs/i }),
  ).toBeEnabled();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("batch queue is honest about secure-worker tools", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await uploadFiles(page, await writeTempPdf("scan.pdf"));

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
  await page
    .getByRole("main")
    .locator('a[href="/tools/rotate-pdf"]')
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/tools\/rotate-pdf$/);

  // Returning restores the activity from localStorage (no file names stored).
  await page.goto("/workspace");
  const activity = page.getByRole("region", { name: /recent activity/i });
  await expect(activity.getByText(/opened rotate pdf/i)).toBeVisible();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});

test("a scan staged in the workspace is offered OCR PDF, with the measured reason", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await uploadFiles(page, await writeTempScanPdf("scan.pdf"));

  // Measured in this tab: the probe found no text layer on the page.
  const suggested = page.getByRole("region", {
    name: /suggested for your files/i,
  });
  const ocr = suggested.getByRole("link", { name: /^open ocr pdf/i });
  await expect(ocr).toBeVisible();
  await expect(ocr).toContainText(/no selectable text on page 1/i);
  // Where the file goes, at the moment it would move.
  await expect(ocr).toContainText(/uploads only when you start it/i);
  await expect(ocr).toHaveAttribute("href", "/tools/ocr-pdf");

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

/**
 * FOUND IN REVIEW (2026-10-09): with an ordinary long name staged —
 * `quarterly-report-final-version-2026.pdf` — /workspace scrolled sideways at
 * 390px (scrollWidth 428 against 390): the drop panel's border, the remove
 * buttons and every card below ran off the right edge. The page grid's one
 * implicit column kept `min-width: auto`, so the name's nowrap text (it is
 * `truncate`, which still counts toward min-content) widened the column.
 * Every fixture before this one had a short name, so nothing measured it.
 */
test.describe("at 390px", () => {
  // No mobile emulation: a phone browser zooms a too-wide page out to fit
  // (measured: innerWidth 512 at 390), which would hide the overflow from
  // the scrollWidth check behind a viewport that no longer measures 390.
  test.use({ viewport: { width: 390, height: 844 } });

  test("a long file name is truncated in its row, and the page never scrolls sideways", async ({
    page,
  }) => {
    const guard = attachConsoleGuard(page);
    const name = "quarterly-report-final-version-2026-signed-copy.pdf";
    expect(name.length).toBeGreaterThanOrEqual(40);
    await page.goto("/workspace");
    await uploadFiles(page, await writeTempPdf(name, 1));

    const staged = page.getByRole("list", { name: /staged files/i });
    const label = staged.getByText(name, { exact: true });
    await expect(label).toBeVisible();
    // Measured facts are in, so the row is at its final width.
    await expect(staged.getByText(/1 page(?!s)/)).toBeVisible();

    const m = await page.evaluate((fileName) => {
      const root = document.documentElement;
      const row = [...document.querySelectorAll("li")].find((li) =>
        li.textContent?.includes(fileName),
      );
      const text = [...(row?.querySelectorAll("span") ?? [])].find(
        (s) => s.textContent === fileName,
      );
      const remove = row?.querySelector("button");
      const panel = row?.closest("ul")?.parentElement;
      const box = (el: Element | null | undefined) =>
        el ? el.getBoundingClientRect().toJSON() : null;
      return {
        innerWidth: window.innerWidth,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        nameScroll: text?.scrollWidth ?? -1,
        nameClient: text?.clientWidth ?? -1,
        remove: box(remove),
        panel: box(panel),
      };
    }, name);

    // Health: the width asked for is the width that painted, and the probe
    // found the row, its name and its button.
    expect(m.innerWidth).toBe(390);
    expect(m.remove, "no remove button found in the row").not.toBeNull();
    expect(m.panel, "no panel found around the staged list").not.toBeNull();

    expect(
      m.scrollWidth,
      `the page is ${m.scrollWidth}px wide in a ${m.clientWidth}px viewport`,
    ).toBeLessThanOrEqual(m.clientWidth);
    // The name is cut short in its row (ellipsis), not laid out in full.
    expect(m.nameScroll).toBeGreaterThan(m.nameClient);
    // Its remove button is inside the panel, and the panel inside the page.
    expect(m.remove!.right).toBeLessThanOrEqual(m.panel!.right);
    expect(m.panel!.right).toBeLessThanOrEqual(m.clientWidth);
    await expect(
      page.getByRole("button", { name: `Remove ${name}` }),
    ).toBeInViewport({ ratio: 1 });

    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
    expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
  });
});

test("the Merge PDF suggestion is a link that carries both files into Merge PDF", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/workspace");
  await uploadFiles(page, [
    await writeTempPdf("a.pdf"),
    await writeTempPdf("b.pdf"),
  ]);

  // The suggestion LINK — the batch panel's button of the same name is
  // covered above; this is the row in "Suggested for your files".
  const merge = page
    .getByRole("region", { name: /suggested for your files/i })
    .getByRole("link", { name: /open merge pdf with 2 files/i });
  await expect(merge).toHaveAttribute("href", "/tools/merge-pdf");
  await merge.click();

  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(page.getByText("a.pdf")).toBeVisible();
  await expect(page.getByText("b.pdf")).toBeVisible();
  await expect(page.getByText(/loaded .* from your workspace/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /merge 2 pdfs/i }),
  ).toBeEnabled();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});
