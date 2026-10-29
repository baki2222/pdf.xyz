import { test, expect, type Page, type Route } from "@playwright/test";
import { uploadFiles, writeTempPdf } from "./helpers";

/**
 * pdf.js's worker script is fetched ONCE per page, and on file arrival — not
 * after the run button.
 *
 * Measured on production 2026-10-29: Compare PDF with two 1-page PDFs took
 * 9–14 s from "Compare PDFs" to the result on a cold page. After the click,
 * `pdf.worker.min.<hash>.mjs` (1.18 MB raw / 361 KB gz) was requested TWICE
 * IN PARALLEL — one worker per document — for ~1.6 s, and the result came
 * ~250 ms after it. This reads the WIRE, at the point of consumption: every
 * request the page makes for the worker script, through a route that also
 * holds each one for {@link WORKER_DELAY_MS} (a slow link; Playwright's
 * routing disables the HTTP cache, so each worker started is one request).
 *
 *  - count: exactly 1 `pdf.worker` request for the whole page visit — file
 *    arrival, page board, thumbnails and the run included;
 *  - order: that request STARTED before the click (the Dropzone warmed it),
 *    asserted on the run with a dwell (see below);
 *  - control: a second worker, forced in the page, shows as a second request
 *    — so a count of 1 is the page's, not a counter that cannot see more.
 *
 * Each flow runs twice: clicking the moment the button is enabled (the worst
 * case for a warm-up — it has had only the staging time) and after a
 * {@link DWELL_MS} pause, a hand travelling from the picker to the button.
 * The click-to-result times are written to the test's annotations (and the
 * console) for the PR's before/after; they are not asserted, because a time
 * is a property of the machine.
 */

const WORKER_DELAY_MS = 1500;
const DWELL_MS = 1500;
const WORKER = /\/pdf\.worker[^/]*\.mjs(\?|$)/;

interface WorkerWire {
  /** Each worker-script request, ms since the page visit began. */
  starts: number[];
  urls: string[];
}

async function throttleWorker(page: Page, t0: number): Promise<WorkerWire> {
  const wire: WorkerWire = { starts: [], urls: [] };
  await page.context().route(WORKER, async (route: Route) => {
    wire.starts.push(Date.now() - t0);
    wire.urls.push(route.request().url());
    await new Promise((r) => setTimeout(r, WORKER_DELAY_MS));
    await route.continue();
  });
  return wire;
}

interface Flow {
  slug: string;
  files: () => Promise<string[]>;
  /** Visible once the files are staged and the run can start. */
  staged: (page: Page) => ReturnType<Page["getByText"]>;
  run: RegExp;
  result: RegExp;
}

const FLOWS: Flow[] = [
  {
    slug: "compare-pdf",
    files: async () => [
      await writeTempPdf("left.pdf", 1),
      await writeTempPdf("right.pdf", 1),
    ],
    staged: (page) =>
      page.locator("[data-tool-panel]").getByText("2/2 selected"),
    run: /compare pdfs/i,
    result: /differences found/i,
  },
  {
    slug: "pdf-to-jpg",
    files: async () => [await writeTempPdf("poster.pdf", 1)],
    staged: (page) => page.getByRole("button", { name: /render 1 page/i }),
    run: /render 1 page/i,
    result: /1 jpg image ready/i,
  },
];

for (const flow of FLOWS) {
  test.describe(`${flow.slug}: one pdf.js worker, warmed on arrival`, () => {
    for (const dwell of [0, DWELL_MS])
      test(`fetches the worker once, before the click (click after ${dwell} ms)`, async ({
        page,
      }) => {
        test.setTimeout(60_000);
        const t0 = Date.now();
        const wire = await throttleWorker(page, t0);
        await page.goto(`/tools/${flow.slug}`);
        // Never on page load: the first load stays lean.
        await page.waitForLoadState("networkidle");
        expect(wire.starts, "the worker was fetched on page load").toEqual([]);

        await uploadFiles(page, await flow.files());
        const button = page.getByRole("button", { name: flow.run });
        await expect(flow.staged(page)).toBeVisible();
        await expect(button).toBeEnabled();
        if (dwell) await page.waitForTimeout(dwell);

        const clickedAt = Date.now() - t0;
        await button.click();
        await expect(
          page.locator("[data-tool-panel]").getByText(flow.result).first(),
        ).toBeVisible({ timeout: 30_000 });
        const resultAt = Date.now() - t0;
        const clickToResult = resultAt - clickedAt;

        const summary = {
          tool: flow.slug,
          dwellMs: dwell,
          workerRequests: wire.starts.length,
          workerStartsMs: wire.starts,
          clickMs: clickedAt,
          clickToResultMs: clickToResult,
        };
        console.log(`[pdfjs-worker] ${JSON.stringify(summary)}`);
        test.info().annotations.push({
          type: "pdfjs-worker",
          description: JSON.stringify(summary),
        });

        expect(
          wire.starts.length,
          `pdf.worker requested ${wire.starts.length}x: ${wire.urls.join(", ")}`,
        ).toBe(1);
        // Order is asserted after the dwell only: clicking the instant the
        // button enables races the warm-up (measured 4-6 ms apart on Compare,
        // whose staging is fast), and a race is not a property of the code.
        // Before this change the request came AFTER the click at any dwell.
        if (dwell)
          expect(
            wire.starts[0]!,
            "the worker request started after the click — the warm-up on file arrival did not run",
          ).toBeLessThan(clickedAt);

        // Control: a second worker in this page is a second request on the
        // same route. Without it, "1" could be a counter blind past the first.
        const url = wire.urls[0]!;
        await page.evaluate((src) => {
          new Worker(src, { type: "module" });
        }, url);
        await expect.poll(() => wire.starts.length).toBe(2);
      });
  });
}
