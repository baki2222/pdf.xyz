import { test, expect, type Page } from "@playwright/test";
import { attachConsoleGuard, uploadFiles, writeTempPdf } from "./helpers";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * How a hand-off travels, and what a page says once it has left.
 *
 *  1. THE TOKEN IS NOT IN ANY REQUEST. A hop used to navigate to
 *     `/tools/x?handoff=h_…`, so the page payload's fetch —
 *     `GET /tools/x?handoff=h_…&_rsc=…` — put the token in the server's
 *     access logs. Every request the browser makes during a hop is read
 *     here, as the server would receive it; none may carry `handoff=`.
 *     Health: the set holds the destination's own payload fetch, so an
 *     empty or mis-filtered capture cannot pass.
 *  2. BACK AFTER A CONTINUE. The origin page keeps no copy of the file
 *     (the next tool claimed it), so Back used to land on an empty tool
 *     with no word of where the file went. It now says so — and only on
 *     the history entry the file left from (CONTROL: a plain visit says
 *     nothing).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

async function mergeAlphaBeta(page: Page) {
  const [alpha, beta] = await Promise.all([
    writeTempPdf("alpha.pdf", 3),
    writeTempPdf("beta.pdf", 2),
  ]);
  await page.goto("/tools/merge-pdf");
  await uploadFiles(page, [alpha, beta]);
  await expect(page.getByText("beta.pdf")).toBeVisible();
  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
}

/** Every request URL from now on, as sent. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
}

const continueTo = (page: Page, name: RegExp) =>
  page
    .getByRole("group", { name: "Continue with" })
    .getByRole("link", { name });

test("a Continue hop sends no request carrying the hand-off token", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await mergeAlphaBeta(page);
  const urls = recordRequests(page);
  await continueTo(page, /compress pdf/i).click();
  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();

  // Health: the capture holds the destination's payload fetch.
  expect(
    urls.filter((u) => /\/tools\/compress-pdf\?(?:.*&)?_rsc=/.test(u)),
    urls.join("\n"),
  ).not.toEqual([]);
  expect(urls.filter((u) => u.includes("handoff="))).toEqual([]);

  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("a workspace launch sends no request carrying the hand-off token", async ({
  page,
}) => {
  await page.goto("/workspace");
  await uploadFiles(page, await writeTempPdf("turn.pdf", 2));
  const batch = page.getByRole("region", {
    name: /use one tool on several files/i,
  });
  await batch.getByLabel(/choose a tool/i).selectOption("rotate-pdf");
  await batch.getByRole("button", { name: /add all staged/i }).click();
  const urls = recordRequests(page);
  await batch.getByRole("button", { name: /open rotate pdf/i }).click();
  await expect(page).toHaveURL(/\/tools\/rotate-pdf$/);
  await expect(page.getByText(/loaded .* from your workspace/i)).toBeVisible();

  expect(
    urls.filter((u) => /\/tools\/rotate-pdf\?(?:.*&)?_rsc=/.test(u)),
    urls.join("\n"),
  ).not.toEqual([]);
  expect(urls.filter((u) => u.includes("handoff="))).toEqual([]);
});

test("after a hop, a reload opens the tool empty, with no hand-off notice", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  await continueTo(page, /compress pdf/i).click();
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toHaveCount(0);
  await expect(page.getByText(/hand-off expired/i)).toHaveCount(0);
});

test("Back after a Continue says where the file went, and Dismiss clears it for good", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await mergeAlphaBeta(page);
  await continueTo(page, /compress pdf/i).click();
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  const notice = page.getByText(/your file went on to Compress PDF/i);
  await expect(notice).toBeVisible();
  // The picker is there to start over.
  await expect(page.locator('input[type="file"]').first()).toBeAttached();

  // A reload of the same entry still knows; Dismiss forgets.
  await page.reload();
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await expect(notice).toHaveCount(0);

  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("Back twice after two hops: each page names the tool its file went on to", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  await continueTo(page, /add page numbers/i).click();
  await expect(page).toHaveURL(/\/tools\/page-numbers$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();
  await page.getByRole("button", { name: /^add page numbers$/i }).click();
  await expect(
    page.getByRole("heading", { name: /page numbers added/i }),
  ).toBeVisible();
  await continueTo(page, /add watermark/i).click();
  await expect(page).toHaveURL(/\/tools\/watermark-pdf$/);
  await expect(
    page.getByText("Loaded your result from Add Page Numbers."),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/tools\/page-numbers$/);
  await expect(
    page.getByText(/your file went on to Add Watermark/i),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
  await expect(
    page.getByText(/your file went on to Add Page Numbers/i),
  ).toBeVisible();
});

test("CONTROL: a plain visit to a tool says nothing about a file going on", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  await continueTo(page, /compress pdf/i).click();
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();
  // A NEW entry for the origin tool, not Back to the one the file left.
  await page.goto("/tools/merge-pdf");
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await expect(page.getByText(/went on to/i)).toHaveCount(0);
});
