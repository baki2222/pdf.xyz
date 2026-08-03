import { test, expect } from "@playwright/test";
import { attachConsoleGuard, uploadFiles, writeTempPdf } from "./helpers";

/**
 * End-to-end proof that a "client" tool really runs in the browser: we generate
 * two PDFs, stage them, merge, and get a downloadable result — with the
 * production CSP active (the merge also spins up the pdfjs worker + wasm for
 * cover thumbnails, so a broken policy surfaces here).
 */
test("merge combines uploaded PDFs client-side and yields a download", async ({
  page,
}) => {
  const guard = attachConsoleGuard(page);
  const [alpha, beta] = await Promise.all([
    writeTempPdf("alpha.pdf", 2),
    writeTempPdf("beta.pdf", 3),
  ]);

  await page.goto("/tools/merge-pdf");

  await uploadFiles(page, [alpha, beta]);

  await expect(page.getByText("alpha.pdf")).toBeVisible();
  await expect(page.getByText("beta.pdf")).toBeVisible();

  const mergeButton = page.getByRole("button", { name: /merge 2 pdfs/i });
  await expect(mergeButton).toBeEnabled();
  await mergeButton.click();

  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /download merged pdf/i }),
  ).toBeVisible();

  // The finished run has to reach someone who cannot see it appear. Assert on
  // the NAMED group rather than on ":focus" containing some text — <body> also
  // satisfies the loose version, so it would pass on the broken build.
  const outcome = page.getByRole("group", { name: /pdfs merged/i });
  await expect(outcome).toBeFocused();

  // From the outcome, the download must be one Tab away, and that click has to
  // land. jsdom can verify neither: it implements no smooth scrolling, so every
  // unit test passes with or without `preventScroll`, while a real browser
  // glides — and this repo has already lost clicks to exactly that glide, press
  // and release resolving to different elements. Clicking here is the only place
  // that hazard is actually observed.
  await page.keyboard.press("Tab");
  const download = page.getByRole("button", { name: /download merged pdf/i });
  await expect(download).toBeFocused();
  await download.click();

  expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
});
