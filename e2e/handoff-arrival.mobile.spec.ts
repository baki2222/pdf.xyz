import { test, expect } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import {
  ARRIVAL_CLS_CEILING,
  continueHop,
  guideDrop,
  stageTops,
} from "./handoff-arrival-probe";

/**
 * A TOOL PAGE ARRIVED AT WITH FILES MOVES NOTHING, on a phone (the `mobile`
 * project, 390 x 844). The desktop half and the history are in
 * `handoff-arrival.spec.ts`. Measured on c7abb986 (PR #180 review), counted:
 * a guide desk drop on how-to-compress-a-pdf 0.0303 (the row opening, then
 * closing: 0.0148 + 0.0155), Continue with on 400 ms of latency 0.0148.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
});

test("Continue with on a phone, 400 ms of latency: the arriving page moves nothing", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const m = await continueHop(page, { latencyMs: 400 });
  const tops = stageTops(m);
  console.log(
    `ARRIVAL hop 390x844 cls ${m.cls.toFixed(4)} ${m.listed} stage at ${tops.join(",")} first frame +${Math.round(m.firstArrived - m.at)}ms`,
  );
  expect(
    m.own.length,
    "the instrument saw no shift of its own",
  ).toBeGreaterThan(0);
  expect(m.frames.length, "no frame of the arriving page").toBeGreaterThan(5);
  expect(m.firstArrived - m.at).toBeGreaterThan(500);
  expect(m.frames.at(-1)!.present.rail).toBe(true);
  expect(tops, "the stage moved on the arriving page").toHaveLength(1);
  expect(m.cls, `counted CLS on arrival: ${m.listed}`).toBeLessThanOrEqual(
    ARRIVAL_CLS_CEILING,
  );
});

test("a file dropped on a guide on a phone: Compress PDF opens with it and moves nothing", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const m = await guideDrop(page, {
    guide: "how-to-compress-a-pdf",
    tool: "compress-pdf",
  });
  const tops = stageTops(m);
  console.log(
    `ARRIVAL guide 390x844 cls ${m.cls.toFixed(4)} ${m.listed} stage at ${tops.join(",")}`,
  );
  expect(
    m.own.length,
    "the instrument saw no shift of its own",
  ).toBeGreaterThan(0);
  expect(m.frames.length, "no frame of the arriving page").toBeGreaterThan(5);
  expect(m.frames.some((f) => f.present.rail)).toBe(false);
  expect(tops, "the stage moved on the arriving page").toHaveLength(1);
  expect(m.cls, `counted CLS on arrival: ${m.listed}`).toBeLessThanOrEqual(
    ARRIVAL_CLS_CEILING,
  );
});
