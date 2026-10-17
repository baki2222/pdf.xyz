import { test, expect } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  ARRIVAL_CLS_CEILING,
  FILE_HEADER,
  RECEIPT,
  continueHop,
  guideDrop,
  slotOpensWithTheSteps,
  stageTops,
} from "./handoff-arrival-probe";

/**
 * A TOOL PAGE ARRIVED AT WITH FILES MOVES NOTHING (2026-10-17), desktop.
 *
 * The job's row (`TicketRail`, 24 px and its gap: 32 px) used to open when
 * the runner drew "Bringing your files over…" and close again, on a
 * hand-off with no job, when the editor came. Either way it moved the
 * runner's stage 32 px in a frame of the arriving page. Measured on
 * c7abb986 (PR #180 review), counted (outside any input window):
 *
 *   guide desk drop, how-to-compress-a-pdf at 1280 x 720   0.0183 / 0.0192
 *   guide desk drop, how-to-add-text-to-a-pdf at 1440 x 900  0.0193
 *   Continue with, 400 ms of latency, 1280 x 720               0.0091
 *   Continue with, 400 ms of latency, 1440 x 900               0.0094
 *
 * On loopback the hop draws inside the click's window, where every shift is
 * forgiven — so every test before this read 0. Here the line is slowed, and
 * the bound is the arrival's: ≤ 0.001, and the stage at ONE document
 * position in every frame of the arriving page.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

for (const screen of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
] as const) {
  test(`Continue with at ${screen.width} x ${screen.height}, 400 ms of latency: the arriving page moves nothing`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(screen);
    const m = await continueHop(page, { latencyMs: 400 });
    const tops = stageTops(m);
    console.log(
      `ARRIVAL hop ${screen.width}x${screen.height} cls ${m.cls.toFixed(4)} ${m.listed} stage at ${tops.join(",")} first frame +${Math.round(m.firstArrived - m.at)}ms`,
    );
    // Health: the instrument listens, the arriving page was painted, and
    // it was painted past the click's 500 ms window — where a shift counts.
    expect(
      m.own.length,
      "the instrument saw no shift of its own",
    ).toBeGreaterThan(0);
    expect(m.frames.length, "no frame of the arriving page").toBeGreaterThan(5);
    expect(m.firstArrived - m.at).toBeGreaterThan(500);
    // The job's steps were drawn — the row this is about.
    expect(m.frames.at(-1)!.present.rail).toBe(true);
    expect(tops, "the stage moved on the arriving page").toHaveLength(1);
    expect(m.cls, `counted CLS on arrival: ${m.listed}`).toBeLessThanOrEqual(
      ARRIVAL_CLS_CEILING,
    );
  });
}

for (const { guide, tool, done, width, height } of [
  {
    guide: "how-to-compress-a-pdf",
    tool: "compress-pdf",
    done: RECEIPT,
    width: 1280,
    height: 720,
  },
  {
    guide: "how-to-add-text-to-a-pdf",
    tool: "edit-pdf",
    done: FILE_HEADER,
    width: 1440,
    height: 900,
  },
] as const) {
  test(`a file dropped on ${guide} at ${width} x ${height}: ${tool} opens with it and moves nothing`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    const m = await guideDrop(page, { guide, tool, done });
    const tops = stageTops(m);
    console.log(
      `ARRIVAL guide ${guide} ${width}x${height} cls ${m.cls.toFixed(4)} ${m.listed} stage at ${tops.join(",")}`,
    );
    expect(
      m.own.length,
      "the instrument saw no shift of its own",
    ).toBeGreaterThan(0);
    expect(m.frames.length, "no frame of the arriving page").toBeGreaterThan(5);
    // A hand-off with no job: no steps to draw, ever.
    expect(m.frames.some((f) => f.present.rail)).toBe(false);
    expect(tops, "the stage moved on the arriving page").toHaveLength(1);
    expect(m.cls, `counted CLS on arrival: ${m.listed}`).toBeLessThanOrEqual(
      ARRIVAL_CLS_CEILING,
    );
  });
}

/**
 * POSITIVE CONTROL, through the same measurement: the row opened only once
 * the job's steps are drawn into it (a stylesheet) — the hop's arrival
 * moves the stage, and it counts.
 */
test("CONTROL: Continue with at 1280 x 720, the row opening with the steps — the bound sees the stage move", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await slotOpensWithTheSteps(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const m = await continueHop(page, { latencyMs: 400 });
  await expect(page.locator("style[data-probe]")).toHaveCount(1);
  console.log(`ARRIVAL CONTROL cls ${m.cls.toFixed(4)} ${m.listed}`);
  expect(m.firstArrived - m.at).toBeGreaterThan(500);
  expect(stageTops(m).length).toBeGreaterThan(1);
  expect(m.cls, m.listed).toBeGreaterThan(ARRIVAL_CLS_CEILING);
});
