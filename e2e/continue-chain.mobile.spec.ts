import { test, expect, type Page } from "@playwright/test";
import { uploadFiles, writeTempPdf } from "./helpers";
import { positionsFrom, startFrames, stopFrames, throttle } from "./frames";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";

/**
 * Every ending is a fork, on a phone (390 x 844, the `mobile` project): the
 * two things WP-08 put on the page that could move what a thumb is reaching
 * for, held frame by frame on a slowed phone (`./frames`).
 *
 *  - THE RECEIPT'S COUNT. It settles after the result is painted, above the
 *    Download row. At 50b2a243 it added a line of its own there, and on a
 *    phone that line wrapped: Download went down 52 px, outside the input
 *    window (WP-08 review, 2026-10-10). Now the count is one statement in
 *    one cell sized for all its states from the first render.
 *  - THE JOB'S ROW. It shares the panel's top row with the privacy sentence,
 *    which takes two lines here, so it is a line of its own — and when it
 *    appeared with the claimed hand-off it pushed the runner down 32 px in a
 *    frame of its own, 234 ms before the editor arrived. It was then held
 *    from the frame "Bringing your files over…" is drawn — which still moved
 *    the runner 32 px, and counted (below). Now it is on the arriving page
 *    from its first frame, and stays for the visit.
 *
 * Each test fails with its reservation removed (a mutation run on the build,
 * recorded in the WP-08 repair report): that is what makes them guards
 * rather than descriptions.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

async function merged(page: Page) {
  await page.goto("/tools/merge-pdf");
  await uploadFiles(page, [
    await writeTempPdf("alpha.pdf", 3),
    await writeTempPdf("beta.pdf", 2),
  ]);
  await expect(page.getByText("beta.pdf")).toBeVisible();
}

test("Download stays where it was painted while the receipt counts the pages", async ({
  page,
}) => {
  await merged(page);
  await throttle(page, { cpu: 4, latencyMs: 300, kbps: 200 });
  await startFrames(page, {
    tops: {
      download: {
        selector: "[data-result-panel] button",
        text: "Download merged PDF",
      },
    },
    present: {
      receipt: "[data-result-panel] [data-receipt]",
      counted: '[data-receipt] [data-settles="counted"]',
    },
  });
  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  await expect(
    page.locator('[data-receipt] [data-settles="counted"]'),
  ).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const frames = await stopFrames(page);

  const { first, tops } = positionsFrom(frames, "download");
  // Download never moved: not when the receipt came, not when the count
  // settled, not after…
  expect(
    new Set(tops),
    `Download moved after it was painted: ${tops.join(" → ")}`,
  ).toEqual(new Set([tops[0]]));
  // …the receipt was drawn in the panel's own frame — not into it later…
  expect(frames[first]!.present.receipt).toBe(true);
  // …and it was still counting then, so the count settled in a later frame:
  // the test saw the very change it holds still.
  expect(frames[first]!.present.counted).toBe(false);
  expect(frames.at(-1)!.present.counted).toBe(true);
});

/**
 * INVERTED 2026-10-17. This was "the job's row is held before the job is
 * known: the runner never moves when it fills", and its history is kept:
 *
 *   The row opened in the frame the "Bringing your files over…" block did,
 *   and its POSITIVE CONTROL asserted that in that frame the runner DID go
 *   down by about the row's height (> 20 px) — "the runner's own change
 *   absorbs it". It does not. A layout shift is the runner's START moving,
 *   whatever else changes in the frame, and the browser counted it: on
 *   c7abb986 (PR #180 review) the stage went 408 -> 440 at 390 and 401 ->
 *   433 at 1280, and on a hand-off with no job (a guide's desk) closed back
 *   — counted 0.0303 at 390 on a guide drop, 0.0148 on this very hop with
 *   400 ms of latency. On loopback the hop draws inside the click's input
 *   window, which forgave it; so this test passed while pinning the defect.
 *
 * Now the row is on the arriving page from its FIRST frame (the address
 * carries the hand-off, `TicketRail`) and is never closed within the visit:
 * the runner is at one position in every frame, and the steps are drawn
 * into a row that was already there. The counted half, on a slowed line,
 * is `e2e/handoff-arrival.mobile.spec.ts`.
 */
test("the job's row is on the arriving page from its first frame: the runner never moves", async ({
  page,
}) => {
  await merged(page);
  await page.getByRole("button", { name: /merge 2 pdfs/i }).click();
  await expect(
    page.getByRole("heading", { name: /pdfs merged/i }),
  ).toBeVisible();
  await throttle(page, { cpu: 4, latencyMs: 40, kbps: 2000 });
  await startFrames(page, {
    tops: {
      // The runner: the panel's element after its top row.
      runner: { selector: "[data-tool-panel] > :nth-child(2)" },
      bringing: {
        selector: '[data-tool-panel] [role="status"]',
        text: "Bringing your files over",
      },
    },
    present: {
      slot: "[data-ticket-rail-slot]",
      rail: "[data-ticket-rail]",
    },
  });
  await page
    .getByRole("group", { name: "Continue with" })
    .getByRole("link", { name: /add page numbers/i })
    .click();
  await expect(page).toHaveURL(/\/tools\/page-numbers$/);
  await expect(
    page.getByRole("button", { name: /^add page numbers$/i }),
  ).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);
  const frames = (await stopFrames(page)).filter(
    (f) => f.path === "/tools/page-numbers",
  );
  expect(frames.length, "no frames on the arriving page").toBeGreaterThan(5);

  // The row is there in the arriving page's first frame, and in every one.
  expect(
    frames.map((f) => f.present.slot),
    "a frame of the arriving page without the job's row",
  ).not.toContain(false);
  // The runner is where it was first painted, in every frame: through the
  // block, the steps filling in and the editor.
  const { tops } = positionsFrom(frames, "runner");
  expect(
    new Set(tops),
    `the runner moved on the arriving page: ${tops.join(" → ")}`,
  ).toEqual(new Set([tops[0]]));
  // Health: the frames saw the change the row is held for — the steps
  // drawn into it, after the first frame.
  expect(frames[0]!.present.rail).toBe(false);
  expect(frames.at(-1)!.present.rail).toBe(true);
});

