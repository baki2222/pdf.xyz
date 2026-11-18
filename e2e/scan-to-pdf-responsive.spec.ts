import { expect, test } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { writeNoisePhotos } from "./generated-photos";
import { waitForHydration } from "./helpers";

/**
 * Perf sweep 2026-11-18, P1 and P2: Scan to PDF on 60 x 12 MP photos froze
 * the page for ~20 s in ONE task (every page's encode in one loop with only
 * microtask awaits), and the ~30 s run had no Cancel.
 *
 * The bound is a RATIO within one run on one machine, so it is not tuned to
 * any host: no single task may take more than two pages' share of the run.
 * Before the fix the share was most of the run in one task.
 *
 * Then, on the same page, a second run is stopped: while it is busy a Cancel
 * button is shown and enabled, and pressing it returns to the idle Create PDF
 * button within two pages' share — no result, no error.
 *
 * Two instruments, because one was found blind: the Long Tasks API never
 * reports work that resumes after `scheduler.yield()` (Chromium 149), so a
 * task is ALSO measured as the largest gap between animation frames (a rAF
 * heartbeat), which sees any block of the main thread. The bound applies to
 * both. Positive control for both: a 300 ms busy loop planted in the page
 * before the run must be seen by each (a blind instrument would make the
 * bound vacuous).
 */

const PHOTOS = 12;

/** Run in the page: the longest long task and frame gap since `since`. */
declare function worst(since: number): {
  longTaskMs: number;
  frameGapMs: number;
  longTasks: number;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
    const tasks: { start: number; duration: number }[] = [];
    (window as unknown as { __longTasks: typeof tasks }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        tasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
    const gaps: { at: number; ms: number }[] = [];
    (window as unknown as { __frameGaps: typeof gaps }).__frameGaps = gaps;
    let last = performance.now();
    const beat = (now: number) => {
      if (now - last > 50) gaps.push({ at: last, ms: now - last });
      last = now;
      requestAnimationFrame(beat);
    };
    requestAnimationFrame(beat);
    (window as unknown as { worst: typeof worst }).worst = (since) => {
      const t = tasks.filter((e) => e.start >= since - 5);
      const g = gaps.filter((e) => e.at >= since - 20);
      return {
        longTaskMs: Math.max(0, ...t.map((e) => e.duration)),
        frameGapMs: Math.max(0, ...g.map((e) => e.ms)),
        longTasks: t.length,
      };
    };
  }, CONSENT_STORAGE_KEY);
});

test("Scan to PDF keeps the page responsive and can be cancelled", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const paths = Array.from({ length: PHOTOS }, (_, i) =>
    testInfo.outputPath(`photo-${String(i + 1).padStart(2, "0")}.jpg`),
  );
  const sizes = await writeNoisePhotos(browser, paths);
  // Health check: real photo-sized JPEGs, not empty or tiny files.
  expect(Math.min(...sizes)).toBeGreaterThan(1_000_000);

  await page.goto("/tools/scan-to-pdf");
  await waitForHydration(
    page.getByRole("button", { name: "Take photo", exact: true }),
  );

  // Control: both instruments see a planted long task. Planted from a page
  // TASK (a timer): work run by the test driver's own evaluate is not
  // reported as a long task, which this control found.
  const planted = await page.evaluate(async () => {
    const start = performance.now();
    setTimeout(() => {
      const t = performance.now();
      while (performance.now() - t < 300) {
        /* busy */
      }
    }, 0);
    await new Promise((r) => setTimeout(r, 600));
    return worst(start);
  });
  // rAF timestamps are frame start times, so a gap reads up to two frames
  // short of the block (283 ms for this 300 ms plant was seen).
  expect(planted.longTaskMs).toBeGreaterThanOrEqual(290);
  expect(planted.frameGapMs).toBeGreaterThanOrEqual(250);

  await page.locator("[data-scan-camera]").setInputFiles(paths);
  await expect(page.locator("[data-scan-page]")).toHaveCount(PHOTOS, {
    timeout: 120_000,
  });
  const run = page.getByRole("button", { name: "Create PDF" });
  await expect(run).not.toHaveAttribute("aria-disabled", "true", {
    timeout: 60_000,
  });

  const t0 = await page.evaluate(() => performance.now());
  await run.click();
  await expect(
    page.getByRole("heading", { name: "Scan saved as PDF" }),
  ).toBeVisible({ timeout: 240_000 });
  const { resultMs, longTaskMs, frameGapMs, longTasks } = await page.evaluate(
    (t0) => ({ resultMs: performance.now() - t0, ...worst(t0) }),
    t0,
  );
  const share = resultMs / PHOTOS;
  console.log(
    JSON.stringify({
      resultMs: Math.round(resultMs),
      longTaskMs,
      frameGapMs: Math.round(frameGapMs),
      longTasks,
      share: Math.round(share),
    }),
  );
  // Health check: the run did block the thread for SOME work (a page's
  // encode), so a zero below cannot pass for "measured nothing".
  expect(frameGapMs).toBeGreaterThan(50);
  // Soft, so a red run reports the Cancel half too.
  for (const [name, ms] of [
    ["longest task", longTaskMs],
    ["longest frame gap", frameGapMs],
  ] as const) {
    expect
      .soft(
        ms,
        `${name} ${Math.round(ms)} ms in a ${Math.round(resultMs)} ms run of ${PHOTOS} photos`,
      )
      .toBeLessThanOrEqual(2 * share);
  }

  // Second run, stopped with Cancel.
  await page.getByRole("button", { name: "Back to adjust" }).click();
  await expect(run).toBeVisible();
  await run.click();
  await expect(page.locator('main [aria-busy="true"]').first()).toBeVisible();
  const cancel = page.getByRole("button", { name: /cancel/i });
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeEnabled();
  await expect(cancel).not.toHaveAttribute("aria-disabled", "true");
  // Into the run, so a page is being made when it is stopped.
  await page.waitForTimeout(Math.min(1_000, share));
  const c0 = Date.now();
  await cancel.click();
  await expect(run).toBeVisible({ timeout: 4 * share });
  await expect(run).not.toHaveAttribute("aria-busy", "true", {
    timeout: 4 * share,
  });
  const idleMs = Date.now() - c0;
  console.log(JSON.stringify({ cancelToIdleMs: idleMs }));
  expect(idleMs).toBeLessThanOrEqual(2 * share);
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  // Words in an alert, not the page's always-present empty live region.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Scan saved as PDF" }),
  ).toHaveCount(0);
  // The photos are still there to run again.
  await expect(page.locator("[data-scan-page]")).toHaveCount(PHOTOS);
});
