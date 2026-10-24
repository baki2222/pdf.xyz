import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  HELD_CASES,
  prepareScrolled,
  releaseOnPointerdown,
  resultDrawn,
  shiftOfOurOwn,
  stageNow,
  startHoldRecord,
  stopHoldRecord,
  type HeldCase,
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

/*
 * THE SUBJECT IS DISCOVERED, by the property the control needs: a released
 * hold has to move what follows the runner by a measurable amount, so the
 * subject is the (case, phone) that leaves the most held band on screen once
 * its result is drawn (`blankOnScreen`).
 *
 * WHY (2026-10-24, PR #209). These tests were written on Sign PDF at the
 * project's 390 x 844, where the band was the fold less a 566 px result. Sign
 * PDF then moved onto the shared editor; its result came out 650 px, the band
 * 130 px, and the CONTROL measured 0.0139 locally and 0.0090 on CI's Linux
 * (whose fonts set the result taller) against a ceiling of 0.01 — a control
 * that can no longer fail the bound is the guard going blind, not a pass.
 * Measured then, band at 390 x 844 / 430 x 932: Sign 130 / 218, Edit 46 /
 * 198, Page numbers 46 / 134, Watermark 26 / 114, Crop 9 / 9. No runner
 * leaves enough at 390 x 844; a taller real phone does, and which one wins is
 * the build's to say, not this file's.
 */

/** Real phone screens the subject may be read on: the project's, and a tall one. */
const PHONE_SCREENS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

/**
 * The least band a subject must leave. At 130 px the control measured
 * 0.0139 and 0.0090 — on both sides of the ceiling; at 218 px (Sign PDF,
 * 430 x 932) it measured 0.0394, locally on Windows, 2026-10-24.
 */
const MIN_BAND = 180;

type Subject = { c: HeldCase; screen: { width: number; height: number } };
let subject: Subject | null = null;

/** The held band left on screen after `c`'s result is drawn on `screen`. */
async function bandOf(page: Page, s: Subject): Promise<number> {
  await page.setViewportSize(s.screen);
  const run = await prepareScrolled(page, s.c, "start");
  await startHoldRecord(page);
  const box = (await run.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await resultDrawn(page, s.c);
  await page.waitForTimeout(600);
  return (await stageNow(page)).blankOnScreen;
}

test.describe.configure({ mode: "serial" });

test("subject: the case and phone whose released hold has the most to move", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const read: { s: Subject; band: number }[] = [];
  for (const screen of PHONE_SCREENS) {
    for (const c of HELD_CASES) {
      const context = await browser.newContext({
        viewport: screen,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      });
      const page = await context.newPage();
      await page.addInitScript((key) => {
        window.localStorage.setItem(key, "denied");
      }, CONSENT_STORAGE_KEY);
      read.push({ s: { c, screen }, band: await bandOf(page, { c, screen }) });
      await context.close();
    }
  }
  const listed = read
    .map(
      (r) => `${r.s.c.slug} ${r.s.screen.width}x${r.s.screen.height} ${r.band}`,
    )
    .join(", ");
  console.log(`STAGE_HOLD subjects ${listed}`);
  // Health: every candidate was read, and the cases are more than one.
  expect(read.length).toBe(PHONE_SCREENS.length * HELD_CASES.length);
  expect(HELD_CASES.length).toBeGreaterThanOrEqual(3);
  const best = read.reduce((a, b) => (b.band > a.band ? b : a));
  expect(
    best.band,
    `no case leaves a band the control can measure: ${listed}`,
  ).toBeGreaterThanOrEqual(MIN_BAND);
  subject = best.s;
});

/** The discovered subject, or a failure naming the step that did not run. */
function theSubject(): Subject {
  if (!subject) throw new Error("the subject test did not run or failed");
  return subject;
}

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

/** The subject, Run tapped while scrolled, the result drawn, then one touch scroll. */
async function touchAfterRun(page: Page, s: Subject) {
  await page.setViewportSize(s.screen);
  const run = await prepareScrolled(page, s.c, "start");
  await startHoldRecord(page);
  const box = (await run.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await resultDrawn(page, s.c);
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

test("on a touch phone: the first touch after a run, which becomes a scroll, moves nothing on the page", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const s = theSubject();
  const m = await touchAfterRun(page, s);
  const r = readTouch(m);
  console.log(
    `STAGE_HOLD touch ${s.c.slug} ${s.screen.width}x${s.screen.height} before ${JSON.stringify(m.before)} after ${JSON.stringify(m.after)} gesture ${r.gesture.join(",")} cls ${r.cls.toFixed(4)} ${r.listed}`,
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
  const m = await touchAfterRun(page, theSubject());
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
test("on a touch phone: a tap after the run gives the held band back, inside the tap's input window", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const s = theSubject();
  await page.setViewportSize(s.screen);
  const run = await prepareScrolled(page, s.c, "start");
  await startHoldRecord(page);
  const box = (await run.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await resultDrawn(page, s.c);
  const before = await stageNow(page);
  // A tap on the result's heading: nothing there to press.
  const heading = page.getByRole("heading", { name: s.c.done });
  const h = (await heading.boundingBox())!;
  const tapAt = await page.evaluate(() => performance.now());
  await page.touchscreen.tap(h.x + 4, h.y + h.height / 2);
  await page.waitForTimeout(600);
  const after = await stageNow(page);
  const rec = await stopHoldRecord(page);
  const gesture = rec.pointer.filter((p) => p.t >= tapAt).map((p) => p.type);
  console.log(
    `STAGE_HOLD tap ${s.c.slug} ${s.screen.width}x${s.screen.height} before ${JSON.stringify(before)} after ${JSON.stringify(after)} gesture ${gesture.join(",")} shifts ${JSON.stringify(rec.shifts.filter((s) => s.t >= tapAt))}`,
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
