import { test, expect, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  EDIT,
  SIGN,
  prepareScrolled,
  resultDrawn,
  shiftOfOurOwn,
  stageNow,
  startHoldRecord,
  stopHoldRecord,
  worstPastFold,
  type HeldCase,
  type StageNow,
} from "./stage-hold-probe";

/**
 * AFTER A RUN, HELD BLANK BELOW THE RESULT NEVER EXTENDS PAST THE BOTTOM OF
 * THE SCREEN — on a desktop, read with the wheel (2026-10-17).
 *
 * The stage is held from the Run press so the result's arrival moves nothing
 * on screen (`src/components/tools/runner/stage-hold.ts`). Until this date
 * it kept its pre-run height until the reader's next pointerdown or key,
 * and a wheel or a trackpad fires neither: a reader who scrolled on past a
 * short result scrolled through the editor's old height as empty panel.
 * Measured on 36702d2c (batch C review): Sign PDF at 1280 x 720 held at
 * 1,075 px around a 362 px result, 713 px blank, 295 of it on screen, and
 * after a 500 px wheel the whole visible stage blank; Edit PDF at 1440 x 900
 * held at 1,379 px, 949 blank — after the wheel the entire 900 px screen was
 * an empty panel.
 *
 * The bound, read in EVERY painted frame from the result on, through a wheel
 * down and a wheel back up: held space past the bottom of the screen (and
 * past the result) is at most 1 px. Space below the screen can be given back
 * at any time without moving anything a reader sees, so none is kept there.
 * What a hold may still leave is the band between the result and the bottom
 * of the screen, at most one screen, until the reader's next click or key.
 *
 * Replaces, as a tested number, the property the inverted "shortest
 * analysis" test in `continue-chain.spec.ts` used to guard ("no blank band
 * under a result"), for the run phase it no longer covered. Beside it, the
 * page's CLS through the wheel: a wheel opens no input window, so the
 * obvious fix for the blank — giving the hold back at a wheel — would move
 * what follows the runner into view and count.
 *
 * Mutation-checked on the build (2026-10-17): the shrink to the fold taken
 * out of `fit` — 413, 490 and 559 px held past it, the numbers 94dc2b22
 * read; a release at a wheel added — "CLS through the wheel after the
 * result: 0.2189", 0.1915, 0.1556; the click and key releases taken out —
 * both release tests red. Each restored from a copy, no diff.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

/** Held space past the fold this test allows: the hold is a whole pixel. */
const PAST_FOLD_PX = 1;

const SCREENS: { c: HeldCase; width: number; height: number }[] = [
  { c: SIGN, width: 1280, height: 720 },
  { c: EDIT, width: 1440, height: 900 },
  { c: EDIT, width: 1280, height: 720 },
];

async function wheel(page: Page, dy: number) {
  const box = page.viewportSize()!;
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(700);
}

/** One run read with the wheel: at the result, after 500 px down, after 1,500 back up. */
async function readWithWheel(page: Page, c: HeldCase) {
  const run = await prepareScrolled(page, c);
  const pressedAt = await page.evaluate(() => Math.round(scrollY));
  await startHoldRecord(page);
  await run.click();
  await resultDrawn(page, c);
  const ownAt = await shiftOfOurOwn(page);
  const readFrom = await page.evaluate(() => performance.now());
  const atResult = await stageNow(page);
  await wheel(page, 500);
  const down = await stageNow(page);
  await wheel(page, -1500);
  const up = await stageNow(page);
  const rec = await stopHoldRecord(page);
  const own = rec.shifts.filter((s) => s.t >= ownAt && s.t < readFrom);
  const counted = rec.shifts.filter((s) => s.t >= readFrom && !s.input);
  return {
    pressedAt,
    atResult,
    down,
    up,
    rec,
    own,
    cls: counted.reduce((sum, s) => sum + s.value, 0),
    listed:
      counted
        .map((s) => `${s.value.toFixed(4)} [${s.sources.join(" | ")}]`)
        .join(" + ") || "none",
  };
}

/** Google's line for a "good" CLS is 0.1; this page is held to a tenth of it. */
const PAGE_CLS_CEILING = 0.01;

const said = (s: StageNow) =>
  `scrollY ${s.scrollY}, held ${s.held || "none"}, stage ${s.stageTop}..${s.stageBottom}, content to ${s.contentBottom}, ${s.blankOnScreen} px blank on a ${s.fold} px screen, ${s.heldPastFold} px held past it`;

for (const { c, width, height } of SCREENS) {
  test(`${c.slug} at ${width} x ${height}: after a run, held blank below the result never extends past the bottom of the screen, through a wheel scroll down and back`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    const m = await readWithWheel(page, c);
    const report = [
      `at the result: ${said(m.atResult)}`,
      `after 500 px down: ${said(m.down)}`,
      `after 1,500 px up: ${said(m.up)}`,
    ].join("\n");
    console.log(`STAGE_HOLD ${c.slug} ${width}x${height}\n${report}`);
    // Health: the run was read scrolled (the case the hold is for), the
    // page held the stage from the press, the result was drawn in frames
    // this read, and the wheel moved the page both ways.
    expect(
      m.pressedAt,
      "Run was pressed at the top of the page",
    ).toBeGreaterThan(0);
    expect(
      m.rec.frames.some((f) => !f.result && f.inline !== ""),
      "the page never held the stage from the press",
    ).toBe(true);
    const { frames, worst } = worstPastFold(m.rec);
    expect(frames, "no frame drew the result").toBeGreaterThan(10);
    expect(
      m.down.scrollY - m.atResult.scrollY,
      "the wheel did not scroll down",
    ).toBeGreaterThan(200);
    expect(
      m.down.scrollY - m.up.scrollY,
      "the wheel did not scroll back up",
    ).toBeGreaterThan(200);
    // THE BOUND, in every frame after the result.
    expect(
      worst!.pastFold,
      `held past the bottom of the screen after the result, worst frame: ${JSON.stringify(worst)}\n${report}`,
    ).toBeLessThanOrEqual(PAST_FOLD_PX);
    for (const s of [m.atResult, m.down, m.up])
      expect(s.heldPastFold, report).toBeLessThanOrEqual(PAST_FOLD_PX);
    // And what the hold gave back as the wheel scrolled moved nothing on
    // screen: a wheel opens no input window, so any shift it made counts.
    expect(
      m.own.length,
      "the instrument saw no shift of its own making",
    ).toBeGreaterThan(0);
    expect(
      m.cls,
      `CLS through the wheel after the result: ${m.listed}
${report}`,
    ).toBeLessThanOrEqual(PAGE_CLS_CEILING);
  });
}

/**
 * POSITIVE CONTROL, through the same measurement: a stage held by a
 * stylesheet at 1,600 px — what the hold was before this date, an editor's
 * height kept under a short result — is seen held past the fold.
 */
test("CONTROL: Sign PDF at 1280 x 720, the stage held at 1,600 px — the bound sees blank past the fold", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const add = () => {
      const style = document.createElement("style");
      style.dataset.probe = "";
      style.textContent = "[data-runner-stage]{min-height:1600px !important}";
      document.head.append(style);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const m = await readWithWheel(page, SIGN);
  await expect(page.locator("style[data-probe]")).toHaveCount(1);
  const { worst } = worstPastFold(m.rec);
  expect(worst!.pastFold, JSON.stringify(worst)).toBeGreaterThan(PAST_FOLD_PX);
  expect(m.atResult.heldPastFold).toBeGreaterThan(PAST_FOLD_PX);
});

/**
 * The band the hold may leave on screen goes at the reader's next key or
 * mouse click — inside that input's window, so its move costs the page
 * nothing. (The tap is `stage-hold.mobile.spec.ts`'s.)
 */
for (const via of ["key", "click"] as const) {
  test(`Sign PDF at 1280 x 720: a ${via} after the run gives the held band back, inside the ${via}'s input window`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    const run = await prepareScrolled(page, SIGN);
    await startHoldRecord(page);
    await run.click();
    await resultDrawn(page, SIGN);
    const before = await stageNow(page);
    const at = await page.evaluate(() => performance.now());
    // Escape: a key that is neither a modifier (the start of a chord, not a
    // release) nor a scroll key (a wheel).
    if (via === "key") await page.keyboard.press("Escape");
    else {
      // On the result's heading: nothing there to press.
      const h = (await page
        .getByRole("heading", { name: SIGN.done })
        .boundingBox())!;
      await page.mouse.click(h.x + 4, h.y + h.height / 2);
    }
    await page.waitForTimeout(600);
    const after = await stageNow(page);
    const rec = await stopHoldRecord(page);
    // Health: there was a band on screen to give back.
    expect(before.held, said(before)).not.toBe("");
    expect(before.blankOnScreen, said(before)).toBeGreaterThan(50);
    expect(after.held, said(after)).toBe("");
    const counted = rec.shifts.filter((s) => s.t >= at && !s.input);
    expect(
      counted,
      `shifts outside the ${via}'s window: ${JSON.stringify(counted)}`,
    ).toEqual([]);
    // The release moved the page (what follows the runner came up), and
    // that move was inside the input's window.
    expect(rec.shifts.some((s) => s.t >= at && s.input)).toBe(true);
  });
}

/**
 * A KEY THAT SCROLLS IS A WHEEL (2026-10-17). Given back at the keydown,
 * the band went and then the page scrolled: what follows the runner came
 * up by the band, and the scroll carried the reader past it. On c7abb986
 * (PR #180 review): PageDown skipped 59 px of the About heading on Sign PDF
 * at 1280 x 720 and 107 px on Edit PDF at 1440 x 900; ArrowDown jumped
 * 335 px for a 40 px scroll. Read here as the About section's place in the
 * document (`offsetTop`, which no scroll changes) across the key: a hold
 * given back moves it up by the band.
 */
for (const { c, key, width, height } of [
  { c: SIGN, key: "PageDown", width: 1280, height: 720 },
  { c: SIGN, key: "Space", width: 1280, height: 720 },
  { c: SIGN, key: "ArrowDown", width: 1280, height: 720 },
  { c: SIGN, key: "End", width: 1280, height: 720 },
  { c: EDIT, key: "PageDown", width: 1440, height: 900 },
] as const) {
  test(`${c.slug} at ${width} x ${height}: ${key} after the run scrolls the page and skips nothing — the held band is not given back by a scroll key`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    const run = await prepareScrolled(page, c);
    await startHoldRecord(page);
    await run.click();
    await resultDrawn(page, c);
    const aboutDocTop = () =>
      page.evaluate(() => {
        const h2 = [...document.querySelectorAll("main h2")].find(
          (h) => h.textContent === "About this tool",
        );
        let top = 0;
        for (
          let n = (h2?.closest("div.grid") ?? h2) as HTMLElement | null;
          n;
          n = n.offsetParent as HTMLElement | null
        )
          top += n.offsetTop;
        return top;
      });
    const before = await stageNow(page);
    const aboutBefore = await aboutDocTop();
    await page.keyboard.press(key);
    await page.waitForTimeout(700);
    const after = await stageNow(page);
    const aboutAfter = await aboutDocTop();
    await stopHoldRecord(page);
    const report = `before: ${said(before)}, About at ${aboutBefore}\nafter ${key}: ${said(after)}, About at ${aboutAfter}`;
    // Health: there was a band to give back, and the key scrolled the page.
    expect(before.held, report).not.toBe("");
    expect(before.blankOnScreen, report).toBeGreaterThan(50);
    expect(after.scrollY - before.scrollY, report).toBeGreaterThan(20);
    // The bound: what follows the runner did not move up the document.
    expect(
      aboutBefore - aboutAfter,
      `${key} gave the band back and skipped content\n${report}`,
    ).toBeLessThanOrEqual(1);
  });
}
