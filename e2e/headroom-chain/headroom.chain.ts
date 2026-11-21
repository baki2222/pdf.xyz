import { expect, test } from "@playwright/test";
import { expectFasterThan, observeFor } from "../time-bound";

/**
 * The fixture of `src/tests/e2e-headroom-chain.test.ts`. No test takes the
 * `page` fixture, so no browser starts. Each test plants one line of the
 * headroom report; the parent reads the report back.
 *
 * MARGINS. Everything timed is planted at about 65% of a 3000 ms budget,
 * polled every 50 ms, so it lands about 1000 ms from either edge. On
 * f8d48720 the planted expect sat at 650 ms of 1000 ms under Playwright's
 * default poll intervals, which put the passing poll at about 850 ms and
 * the next at about 1850 ms: 150 ms of runner lag failed attempt 1, the
 * retry passed, and the parent's exact `retries masked: 1` went red
 * (reviewer, 2026-11-21).
 */

test("e2e chain: a bound at 80%", () => {
  expectFasterThan("e2e-chain-eighty", 800, 1000);
});

test("e2e chain: an expect step at about 65% of expect.timeout", async () => {
  const t0 = Date.now();
  await expect
    .poll(() => Date.now() - t0 >= 1_950, { intervals: [50] })
    .toBe(true);
});

test("e2e chain: the same expect under its own 12000 ms timeout", async () => {
  const t0 = Date.now();
  await expect
    .poll(() => Date.now() - t0 >= 1_950, { intervals: [50], timeout: 12_000 })
    .toBe(true);
});

test("e2e chain: a test at about 65% of its own timeout", async () => {
  test.setTimeout(3_000);
  await observeFor(
    "e2e-chain-test-share",
    1_950,
    "65% of this test's own 3000 ms timeout: the timeout line's subject",
  );
});

test("e2e chain: a test that fails once and passes on the retry", () => {
  expect(
    test.info().retry,
    "the first attempt fails on purpose",
  ).toBeGreaterThan(0);
});

test.describe(() => {
  test.describe.configure({ retries: 0 });
  test("e2e chain: a bound at 120% fails and still reports", () => {
    expectFasterThan("e2e-chain-over", 1200, 1000);
  });
});
