import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  SIGN,
  prepareScrolled,
  releaseOnPointerdown,
  resultDrawn,
  shiftOfOurOwn,
  stageNow,
  startHoldRecord,
  stopHoldRecord,
  type HoldRecord,
} from "./stage-hold-probe";

/**
 * THE FIRST TOUCH AFTER A RUN, ON A TOUCH PHONE (the `mobile` project:
 * 390 x 844, `hasTouch`, `isMobile`), 2026-10-17.
 *
 * The stage held from a Run press (`src/components/tools/runner/stage-hold.ts`)
 * was given back at the reader's next pointerdown. On a phone that
 * pointerdown is usually the start of a scroll, and Chromium reports a shift
 * made while a touch turns into a scroll with hadRecentInput = false: the
 * release moved the About section by the held band, and it counted. Measured
 * on 36702d2c (batch C review): Sign PDF at 390 x 844, held at 1,099 px
 * around a 566 px result, one release 0.1135 — over Google's 0.1 "good" line
 * by itself — 3 runs of 3. No e2e drove a touch then; every press was a
 * mouse click, which hid it.
 *
 * Driven here through the real touch path: the Run press a tap
 * (`page.touchscreen`), the scroll a CDP `Input.dispatchTouchEvent`
 * touchStart, twelve touchMoves of 25 px and a touchEnd — which fires a
 * pointerdown and then a pointercancel, and no click.
 *
 * Mutation-checked on the build (2026-10-17): the release listening to
 * pointerdown instead of click — "CLS from the first touch after the run,
 * which became a scroll: 0.0458" (smaller than 94dc2b22's 0.1339: the band
 * left on screen is now at most the fold's); the click and key releases
 * taken out — "the tap did not give the band back". Restored from a copy.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

/** Google's line for a "good" CLS is 0.1; this page is held to a tenth of it. */
const PAGE_CLS_CEILING = 0.01;

/** A finger put down at mid-screen and drawn up 300 px: the page scrolls down. */
async function touchScroll(cdp: CDPSession, x: number, y: number) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - i * 25 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

/** Sign PDF, Run tapped while scrolled, the result drawn, then one touch scroll. */
async function touchAfterRun(page: Page) {
  const run = await prepareScrolled(page, SIGN, "start");
  await startHoldRecord(page);
  const box = (await run.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await resultDrawn(page, SIGN);
  const ownAt = await shiftOfOurOwn(page);
  await page.waitForTimeout(600);
  const before = await stageNow(page);
  const touchAt = await page.evaluate(() => performance.now());
  const cdp = await page.context().newCDPSession(page);
  const vp = page.viewportSize()!;
  await touchScroll(cdp, vp.width / 2, Math.round(vp.height * 0.7));
  await page.waitForTimeout(1000);
  const after = await stageNow(page);
  const rec = await stopHoldRecord(page);
  return { rec, ownAt, touchAt, before, after };
}

function readTouch(m: { rec: HoldRecord; ownAt: number; touchAt: number }) {
  const own = m.rec.shifts.filter((s) => s.t >= m.ownAt && s.t < m.touchAt);
  const counted = m.rec.shifts.filter((s) => s.t >= m.touchAt && !s.input);
  const gesture = m.rec.pointer.filter((p) => p.t >= m.touchAt);
  return {
    own,
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    listed:
      counted
        .map((s) => `${s.value.toFixed(4)} [${s.sources.join(" | ")}]`)
        .join(" + ") || "none",
    gesture: gesture.map((p) => `${p.type}:${p.pointerType}`),
  };
}

test("Sign PDF on a touch phone: the first touch after a run, which becomes a scroll, moves nothing on the page", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const m = await touchAfterRun(page);
  const r = readTouch(m);
  console.log(
    `STAGE_HOLD touch sign-pdf 390x844 before ${JSON.stringify(m.before)} after ${JSON.stringify(m.after)} gesture ${r.gesture.join(",")} cls ${r.cls.toFixed(4)} ${r.listed}`,
  );
  // Health: the browser reports this page's shifts; the gesture went down
  // the touch path the old release listened on (a pointerdown), became a
  // scroll (a pointercancel, no click) and moved the page; and the stage
  // was still held, with a band on screen, when the finger went down — the
  // case where giving it back would move what follows.
  expect(
    r.own.length,
    "the instrument saw no shift of its own making",
  ).toBeGreaterThan(0);
  expect(r.gesture, "the touch fired no pointerdown").toContain(
    "pointerdown:touch",
  );
  expect(r.gesture, "the touch did not become a scroll").toContain(
    "pointercancel:touch",
  );
  expect(r.gesture.some((g) => g.startsWith("click"))).toBe(false);
  expect(
    m.after.scrollY - m.before.scrollY,
    "the touch did not scroll",
  ).toBeGreaterThan(100);
  expect(
    m.before.held,
    "the stage was not held when the finger went down",
  ).not.toBe("");
  expect(m.before.blankOnScreen).toBeGreaterThan(50);
  // THE BOUND: nothing that moved from the touch on counts.
  expect(
    r.cls,
    `CLS from the first touch after the run, which became a scroll: ${r.listed}`,
  ).toBeLessThanOrEqual(PAGE_CLS_CEILING);
});

/**
 * POSITIVE CONTROL, through the same measurement: the hold given back at a
 * pointerdown, as it was until this date — the touch that becomes a scroll
 * moves what follows the runner, and it counts.
 */
test("CONTROL: the hold given back at a pointerdown — the bound sees the touch scroll's shift", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await releaseOnPointerdown(page);
  const m = await touchAfterRun(page);
  const r = readTouch(m);
  console.log(`STAGE_HOLD touch CONTROL cls ${r.cls.toFixed(4)} ${r.listed}`);
  expect(r.own.length).toBeGreaterThan(0);
  expect(r.gesture).toContain("pointerdown:touch");
  expect(m.before.blankOnScreen).toBeGreaterThan(50);
  expect(m.after.held, "the control's release did not land").toBe("");
  expect(r.cls, r.listed).toBeGreaterThan(PAGE_CLS_CEILING);
});

/**
 * The band the hold may leave on screen goes at the reader's next TAP — a
 * click, which a touch that becomes a scroll never fires — inside the tap's
 * own input window, so its move costs the page nothing.
 */
test("Sign PDF on a touch phone: a tap after the run gives the held band back, inside the tap's input window", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const run = await prepareScrolled(page, SIGN, "start");
  await startHoldRecord(page);
  const box = (await run.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await resultDrawn(page, SIGN);
  const before = await stageNow(page);
  // A tap on the result's heading: nothing there to press.
  const heading = page.getByRole("heading", { name: SIGN.done });
  const h = (await heading.boundingBox())!;
  const tapAt = await page.evaluate(() => performance.now());
  await page.touchscreen.tap(h.x + 4, h.y + h.height / 2);
  await page.waitForTimeout(600);
  const after = await stageNow(page);
  const rec = await stopHoldRecord(page);
  const gesture = rec.pointer.filter((p) => p.t >= tapAt).map((p) => p.type);
  console.log(
    `STAGE_HOLD tap sign-pdf 390x844 before ${JSON.stringify(before)} after ${JSON.stringify(after)} gesture ${gesture.join(",")} shifts ${JSON.stringify(rec.shifts.filter((s) => s.t >= tapAt))}`,
  );
  // Health: a band was on screen to give back, and the tap was a click.
  expect(before.held, JSON.stringify(before)).not.toBe("");
  expect(before.blankOnScreen).toBeGreaterThan(50);
  expect(gesture).toContain("click");
  expect(after.held, "the tap did not give the band back").toBe("");
  const counted = rec.shifts.filter((s) => s.t >= tapAt && !s.input);
  expect(
    counted,
    `shifts outside the tap's window: ${JSON.stringify(counted)}`,
  ).toEqual([]);
  // The release moved what follows the runner up, inside the tap's window.
  expect(rec.shifts.some((s) => s.t >= tapAt && s.input)).toBe(true);
});
