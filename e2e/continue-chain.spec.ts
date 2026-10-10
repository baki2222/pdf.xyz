import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import {
  attachConsoleGuard,
  fileInput,
  uploadFiles,
  waitForHydration,
  writeTempPdf,
} from "./helpers";
import {
  captureDownload,
  pdfPageTexts,
  pdfRotations,
} from "./client-proof/artifacts";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { USER_PASSWORD_PDF_BASE64 } from "../src/tests/fixtures-encrypted";

/**
 * Every ending is a fork (redesign WP-08), proved through the page — a real
 * browser, the production build, the files a visitor downloads:
 *
 *  - the receipt's page count is the FILE's: a merge of 3 + 2 pages says
 *    "5 pages", and an independent count of the downloaded bytes (pdfjs, in
 *    this process) says the same — so an off-by-one in the receipt's
 *    re-count, or a merge that drops a page, turns this red;
 *  - "Continue with" carries the result to the next tool with where it came
 *    from, and the job's steps follow it; a chain of three ends in a file
 *    that holds the first tool's pages with the second tool's numbers;
 *  - Back to adjust returns to the settings as they were;
 *  - the control: a browser that will not store the file is told so, and
 *    nothing navigates;
 *  - a known refusal offers its fix once; unapplied edits are asked about
 *    before a link leaves the page.
 *
 * The consent banner is answered first: it is fixed to the bottom of the
 * screen, where it would sit over a receipt's last rows.
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

const continueRow = (page: Page) =>
  page.getByRole("group", { name: "Continue with" });

test("the merged file's receipt is its own count: 5 pages, re-opened here and in this process", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  await mergeAlphaBeta(page);
  const proof = page.getByText(
    /re-opened and counted in this browser: (\d+) pages?\./i,
  );
  await expect(proof).toBeVisible();
  const counted = Number(
    /: (\d+) page/.exec((await proof.textContent()) ?? "")?.[1],
  );
  // The merge meant to write 5, and the receipt found 5: no warning.
  expect(counted).toBe(5);
  await expect(page.getByText(/expected \d+ pages?, counted/i)).toHaveCount(0);

  const merged = await captureDownload(
    page,
    page.getByRole("button", { name: /download merged pdf/i }),
  );
  // Independent of the browser: pdfjs in this process opens what was saved.
  const pages = await pdfPageTexts(merged);
  expect(pages).toHaveLength(counted);
  expect(pages[0]).toContain("alpha.pdf — page 1");
  expect(pages[3]).toContain("beta.pdf — page 1");
  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  expect(guard.pageErrors, guard.pageErrors.join("\n")).toEqual([]);
});

test("Continue with carries the result, says where it came from, and the job's steps follow it", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  const row = continueRow(page);
  await expect(row).toBeVisible();
  // Compress PDF is offered first after a merge (`Tool.next`), and the row
  // says what it carries.
  const compress = row.getByRole("link", { name: /compress pdf/i });
  await expect(compress).toContainText("carries alpha-merged.pdf");
  await expect(row.getByRole("link")).toHaveCount(4);
  await compress.click();

  await expect(page).toHaveURL(/\/tools\/compress-pdf$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();
  // The file that arrived is the merge's output, by its name.
  await expect(
    page.getByText("alpha-merged.pdf", { exact: true }).first(),
  ).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Job steps" });
  await expect(rail.getByRole("listitem")).toHaveText([
    "Merge PDF (done)",
    "Compress PDF",
  ]);
  await expect(rail.locator('[aria-current="step"]')).toHaveText(
    "Compress PDF",
  );
});

test("a job of three: merge, then page numbers, and the file holds both", async ({
  page,
}) => {
  await mergeAlphaBeta(page);
  await continueRow(page)
    .getByRole("link", { name: /add page numbers/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/page-numbers$/);
  await expect(
    page.getByText("Loaded your result from Merge PDF."),
  ).toBeVisible();

  await page.getByRole("button", { name: /^add page numbers$/i }).click();
  await expect(
    page.getByRole("heading", { name: /page numbers added/i }),
  ).toBeVisible();
  await expect(
    page.getByText("Re-opened and counted in this browser: 5 pages."),
  ).toBeVisible();
  // This step is ticked now its result is on screen.
  const rail = page.getByRole("navigation", { name: "Job steps" });
  await expect(rail.getByRole("listitem")).toHaveText([
    "Merge PDF (done)",
    "Add Page Numbers (done)",
  ]);
  // A step the job already took is not offered again.
  const row = continueRow(page);
  await expect(row).toBeVisible();
  await expect(row.getByRole("link", { name: /merge pdf/i })).toHaveCount(0);

  const numbered = await captureDownload(
    page,
    page.getByRole("button", { name: /download numbered pdf/i }),
  );
  const pages = await pdfPageTexts(numbered);
  expect(pages).toHaveLength(5);
  expect(pages[0]).toContain("alpha.pdf — page 1");
  expect(pages[0]).toContain("Page 1 of 5");
  expect(pages[4]).toContain("beta.pdf — page 2");
  expect(pages[4]).toContain("Page 5 of 5");
});

test("Back to adjust returns to Rotate's settings as they were, with the same file", async ({
  page,
}) => {
  const file = await writeTempPdf("spin.pdf", 2);
  await page.goto("/tools/rotate-pdf");
  await uploadFiles(page, file);
  await page.getByRole("button", { name: /^right$/i }).click();
  await page.getByRole("button", { name: /apply rotation/i }).click();
  await expect(page.getByText(/2 pages rotated/)).toBeVisible();

  await page.getByRole("button", { name: "Back to adjust" }).click();
  // Focus is on the run trigger, and the rotation chosen before is still
  // there: Apply is live without touching anything.
  const apply = page.getByRole("button", { name: /apply rotation/i });
  await expect(apply).toBeFocused();
  await expect(apply).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("spin.pdf", { exact: true })).toBeVisible();

  // A second quarter turn on top of the first: the file ends at 180°.
  await page.getByRole("button", { name: /^right$/i }).click();
  await apply.click();
  const rotated = await captureDownload(
    page,
    page.getByRole("button", { name: /download rotated pdf/i }),
  );
  expect(await pdfRotations(rotated)).toEqual([180, 180]);
});

test("CONTROL: a browser that will not store the file is told so, and nothing navigates", async ({
  page,
}) => {
  // Every IndexedDB open fails, as in a browser with site storage blocked:
  // the hand-off cannot be stashed.
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException("blocked for this test", "SecurityError");
    };
  });
  await mergeAlphaBeta(page);
  await continueRow(page)
    .getByRole("link", { name: /compress pdf/i })
    .click();
  const alert = continueRow(page).getByRole("alert");
  await expect(alert).toContainText(
    "Couldn't carry the file — this browser's storage is unavailable. Download it, then open Compress PDF",
  );
  await expect(
    alert.getByRole("link", { name: "Compress PDF" }),
  ).toHaveAttribute("href", "/tools/compress-pdf");
  await expect(page).toHaveURL(/\/tools\/merge-pdf$/);
});

test("a password-protected PDF in Rotate offers Unlock PDF once, and says which password", async ({
  page,
}) => {
  await page.goto("/tools/rotate-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(USER_PASSWORD_PDF_BASE64, "base64"),
  });
  // Not the router's own (empty) announcer, which is an alert too.
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "This PDF is password-protected." });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("link")).toHaveCount(1);
  await expect(alert.getByRole("link")).toHaveText("Open Unlock PDF");
  await expect(alert).toContainText("with the password that opens it.");
  await expect(alert).toContainText(
    "it uploads to the secure worker only when you start it",
  );
});

test("unapplied edits are asked about before a header link leaves the page", async ({
  page,
}) => {
  // A Letter page: the editor's default position for new text is inside
  // it (on the small default fixture it would be refused as off the page).
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto("/tools/edit-pdf");
  const input = fileInput(page);
  await waitForHydration(input);
  await input.setInputFiles({
    name: "revise.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  });
  await page.getByLabel("Text", { exact: true }).fill("E2E-EDIT-MARK");
  await page.getByRole("button", { name: /add to page/i }).click();
  await expect(page.getByRole("list", { name: "Placed edits" })).toBeVisible();

  const header = page.getByRole("navigation", { name: "Primary" }).first();
  const messages: string[] = [];
  page.once("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  await header.getByRole("link", { name: "All tools" }).click();
  await expect
    .poll(() => messages)
    .toEqual([
      "You have unsaved changes: your edits in Edit PDF. Discard them?",
    ]);
  // "Cancel": the page and the edit stay.
  await expect(page).toHaveURL(/\/tools\/edit-pdf$/);
  await expect(page.getByRole("list", { name: "Placed edits" })).toBeVisible();

  // "OK": the link goes where it goes.
  page.once("dialog", (dialog) => void dialog.accept());
  await header.getByRole("link", { name: "All tools" }).click();
  await expect(page).toHaveURL(/\/tools$/);
});
