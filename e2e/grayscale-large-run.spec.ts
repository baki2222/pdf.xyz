import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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
 * and the JPEG (63% of the busy time) lost on every text page.
 *
 * DENSITY. The first fix skipped the JPEG only below a size floor, which
 * nearly blank pages meet and a page of body text does not; this spec then
 * wrote ONE short line a page, the only density where that fix held. Review
 * measured 6 lines a page at 2.78 times PDF to PNG, and 50 lines at 3.15 —
 * worse than the ratio that defined P3. So the ratio is now asserted at three
 * densities, up to a full page of body text.
 *
 * The bound is a RATIO, not a time: PDF to PNG draws the same pages at the
 * same 150 DPI through the same renderer, in the same browser, so machine
 * speed cancels. Grayscale runs FIRST (cold), which only makes it harder for
 * grayscale to pass.
 *
 * P4: those 80 s had no Cancel, although the runner already made an
 * AbortController and passed its signal down to the renderer.
 */

const PAGES = 40;
const LINE =
  "The quick brown fox jumps over the lazy dog, and the contract shall be governed by the laws of the state.";

/** `pages` Letter pages of Helvetica body text, `lines` lines on each. */
async function textPdf(pages: number, lines: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    for (let line = 0; line < lines; line++) {
      p.drawText(`${i + 1}.${line + 1} ${LINE}`.slice(0, 100), {
        x: 48,
        y: 740 - line * 13.5,
        size: 11,
        font,
      });
    }
  }
  const path = join(
    mkdtempSync(join(tmpdir(), "pdfxyz-e2e-")),
    `text-${lines}.pdf`,
  );
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
  // `waitFor`, not `expect().toBeVisible()`: the assertion retries on a
  // back-off of up to a second, which rounded these timings to 0.5 s steps.
  await page
    .getByRole("heading", { name: heading })
    .waitFor({ state: "visible", timeout: 240_000 });
  return Date.now() - started;
}

for (const lines of [1, 6, 50]) {
  test(`grayscale of a long text PDF, ${lines} line${lines === 1 ? "" : "s"} a page, takes at most 1.5x PDF to PNG on the same file`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const file = await textPdf(PAGES, lines);
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
      `${lines} lines: grayscale ${grayMs} ms, png ${pngMs} ms, ratio ${(grayMs / pngMs).toFixed(2)}`,
    );
    expect(grayMs).toBeLessThanOrEqual(1.5 * pngMs);
  });
}

/**
 * Counts every canvas the page creates. pdf.js draws each page on a fresh
 * one (`capturePdfPages`), so the count is how many pages have been drawn.
 */
async function countCanvases(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __canvases: number };
    w.__canvases = 0;
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (
      this: Document,
      tag: string,
      options?: ElementCreationOptions,
    ) {
      if (String(tag).toLowerCase() === "canvas") w.__canvases++;
      return create.call(this, tag, options);
    } as typeof Document.prototype.createElement;
  });
}

const canvases = (page: Page) =>
  page.evaluate(() => (window as unknown as { __canvases: number }).__canvases);

test("Cancel stops a grayscale run: no more pages are drawn, no result, no error, and focus stays on the run button", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await countCanvases(page);
  // Long enough that the run is still going when Cancel is pressed, however
  // fast the encoder gets.
  const file = await textPdf(400, 6);
  await page.goto("/tools/grayscale-pdf");
  await uploadFiles(page, file);
  const run = page.getByRole("button", { name: /convert to grayscale/i });
  await expect(run).toBeEnabled({ timeout: 30_000 });
  const before = await canvases(page);
  await run.click();

  const busy = page.locator('main [aria-busy="true"]');
  await expect(busy.first()).toBeVisible();
  // POSITIVE CONTROL for the counter: the run is drawing pages.
  await expect
    .poll(async () => (await canvases(page)) - before, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(3);

  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeEnabled();
  // From the keyboard, as the review did: focus it and press Enter.
  await cancel.focus();
  await page.keyboard.press("Enter");
  const atCancel = await canvases(page);

  await expect(busy).toHaveCount(0);
  await expect(run).toBeVisible();
  await expect(run).toBeEnabled();
  await expect(run).toBeFocused();
  await expect(cancel).toHaveCount(0);
  // Long enough for many more pages: a run that went on would draw them.
  // (It would NOT land a result: `reset` drops it, so the heading below
  // cannot see a run that keeps going. The canvas count can.)
  await page.waitForTimeout(3_000);
  expect(await canvases(page)).toBeLessThanOrEqual(atCancel + 1);
  await expect(
    page.getByRole("heading", { name: /grayscale pdf ready/i }),
  ).toHaveCount(0);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});

const fromRoot = createRequire(join(process.cwd(), "package.json"));
const AXE = fromRoot.resolve("axe-core/axe.min.js");

/**
 * `e2e/axe.spec.ts` checks landing pages at rest. The busy state, where the
 * Cancel button and the progress bar appear, is only seen here (review: axe
 * found aria-progressbar-name on it, already on main).
 */
test("axe WCAG 2.x A/AA finds nothing on Grayscale PDF while it is converting", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const file = await textPdf(400, 6);
  await page.goto("/tools/grayscale-pdf");
  await uploadFiles(page, file);
  const run = page.getByRole("button", { name: /convert to grayscale/i });
  await expect(run).toBeEnabled({ timeout: 30_000 });
  await run.click();
  // Health check: the state under test is on screen while axe runs.
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: object,
          ) => Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return r.violations.map((v) => `${v.id}:${v.nodes.length}`);
  });
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect(found).toEqual([]);
});
