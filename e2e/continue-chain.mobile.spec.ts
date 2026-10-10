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
 *    frame of its own, 234 ms before the editor arrived. Now the row is held
 *    from the frame "Bringing your files over…" is drawn.
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
  // The receipt is drawn in the panel's own frame — not into it later.
  expect(frames[first]!.present.receipt).toBe(true);
  // …it was still counting then, so the count settled in a later frame…
  expect(frames[first]!.present.counted).toBe(false);
  expect(frames.at(-1)!.present.counted).toBe(true);
  // …and Download never moved: not when the count settled, not after.
  expect(
    new Set(tops),
    `Download moved after it was painted: ${tops.join(" → ")}`,
  ).toEqual(new Set([tops[0]]));
});

test("the job's row is held before the job is known: the runner never moves when it fills", async ({
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

  // The row opens in the frame the block does — never alone.
  const held = frames.findIndex((f) => f.present.slot);
  expect(held, "the job's row never appeared").toBeGreaterThanOrEqual(0);
  expect(frames[held]!.tops.bringing).not.toBeNull();
  if (held > 0) expect(frames[held - 1]!.tops.bringing).toBeNull();

  // The job's steps appear in a row that was already there, and the
  // runner is where it was in that frame — or, if the claim was that fast,
  // in the very frame the block itself appeared (the runner's own change).
  const filled = frames.findIndex((f) => f.present.rail);
  expect(filled, "the job's steps never appeared").toBeGreaterThanOrEqual(held);
  const before = frames[filled - 1];
  if (before?.present.slot) {
    expect(
      frames[filled]!.tops.runner,
      `the runner moved when the job's steps appeared: ${before.tops.runner} → ${frames[filled]!.tops.runner}`,
    ).toBe(before.tops.runner);
  } else {
    expect(filled, "the steps appeared in a row of their own").toBe(held);
  }
  // Positive control on the instrument: where the row opened, with the
  // block, the runner DID go down by about the row's height — the probe
  // sees the very push it guards against, in the frame where the runner's
  // own change absorbs it.
  if (held > 0)
    expect(
      frames[held]!.tops.runner! - frames[held - 1]!.tops.runner!,
    ).toBeGreaterThan(20);
  expect(frames.at(-1)!.present.rail).toBe(true);
});
