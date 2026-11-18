import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { uploadFiles } from "./helpers";

/**
 * Grayscale PDF on a long text document (perf sweep 2026-11-18, P3 and P4).
 *
 * P3: on a 1,000-page text PDF the run took about 80 s to "Grayscale PDF
 * ready", against about 33 s for PDF to PNG on the same file — a ratio of
 * about 2.4. Every page was encoded twice, as a JPEG and as a Flate image,
 * and the JPEG (63% of the busy time) was thrown away on every text page.
 *
 * P4: those 80 s had no Cancel, although the runner already made an
 * AbortController and passed its signal down to the renderer.
 *
 * The bound is a RATIO, not a time: PDF to PNG draws the same pages at the
 * same 150 DPI through the same renderer, in the same browser, so machine
 * speed cancels. Grayscale runs FIRST (cold), which only makes it harder for
 * grayscale to pass.
 */

const PAGES = 60;

/** The sweep's F1 generator, cut to {@link PAGES} pages. */
async function textPdf(pages = PAGES): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(
      `Perf fixture F1, page ${i + 1} of ${pages}. The quick brown fox jumps over the lazy dog.`,
      { x: 48, y: 720, size: 12, font },
    );
  }
  const path = join(mkdtempSync(join(tmpdir(), "pdfxyz-e2e-")), "long.pdf");
  writeFileSync(path, await doc.save());
  return path;
}

/** Open `slug`, add the file, press its run button: ms to `heading`. */
async function timedRun(
  page: Page,
  slug: string,
  file: string,
  heading: RegExp,
): Promise<number> {
  await page.goto(`/tools/${slug}`);
  await uploadFiles(page, file);
  const trigger = page.locator("main [data-run-trigger]").first();
  await expect(trigger).toBeEnabled({ timeout: 30_000 });
  await expect(trigger).not.toHaveAttribute("aria-disabled", "true");
  const started = Date.now();
  await trigger.click();
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({
    timeout: 240_000,
  });
  return Date.now() - started;
}

test("grayscale of a long text PDF takes at most 1.5x PDF to PNG on the same file", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const file = await textPdf();
  const grayMs = await timedRun(
    page,
    "grayscale-pdf",
    file,
    /^Grayscale PDF ready$/,
  );
  const pngMs = await timedRun(
    page,
    "pdf-to-png",
    file,
    new RegExp(`^${PAGES} PNG images ready$`),
  );
  console.log(
    `grayscale ${grayMs} ms, png ${pngMs} ms, ratio ${(grayMs / pngMs).toFixed(2)}`,
  );
  expect(grayMs).toBeLessThanOrEqual(1.5 * pngMs);
});

test("Cancel stops a grayscale run and returns to the start, with no result and no error", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Long enough that the run is still going when Cancel is pressed, however
  // fast the encoder gets.
  const file = await textPdf(400);
  await page.goto("/tools/grayscale-pdf");
  await uploadFiles(page, file);
  const run = page.getByRole("button", { name: /convert to grayscale/i });
  await expect(run).toBeEnabled({ timeout: 30_000 });
  await run.click();

  const busy = page.locator('main [aria-busy="true"]');
  await expect(busy.first()).toBeVisible();
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeEnabled();
  await cancel.click();

  await expect(busy).toHaveCount(0);
  await expect(run).toBeVisible();
  await expect(run).toBeEnabled();
  await expect(cancel).toHaveCount(0);
  // Longer than a page takes, so a run that went on would land a result here.
  await page.waitForTimeout(3_000);
  await expect(
    page.getByRole("heading", { name: /grayscale pdf ready/i }),
  ).toHaveCount(0);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});
