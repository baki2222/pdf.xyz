import { expect, test } from "@playwright/test";
import { expectFasterThan } from "../time-bound";

/**
 * The fixture of `src/tests/e2e-headroom-chain.test.ts`. No test takes the
 * `page` fixture, so no browser starts. Each test plants one line of the
 * headroom report; the parent reads the report back.
 */

test("e2e chain: a bound at 80%", () => {
  expectFasterThan("e2e-chain-eighty", 800, 1000);
});

test("e2e chain: an expect step at about 65% of expect.timeout", async () => {
  const t0 = Date.now();
  await expect.poll(() => Date.now() - t0 >= 650).toBe(true);
});

test("e2e chain: the same expect under its own 4000 ms timeout", async () => {
  const t0 = Date.now();
  await expect
    .poll(() => Date.now() - t0 >= 650, { timeout: 4_000 })
    .toBe(true);
});

test("e2e chain: a test at about 65% of its own timeout", async () => {
  test.setTimeout(1_000);
  await new Promise<void>((resolve) => setTimeout(resolve, 650));
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
