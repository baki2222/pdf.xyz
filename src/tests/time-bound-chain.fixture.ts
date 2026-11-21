// @vitest-environment jsdom
/**
 * The fixture `time-bound-chain.test.ts` runs in a child vitest, through
 * the real reporter. Not a test file (the suite's include glob does not
 * match it): its numbers are planted, so each line of the report is known
 * in advance — 80%, 10%, and 120% (which must fail and STILL report).
 */
import { beforeAll, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { expectFasterThan, expectRatioBelow, measureTime } from "./time-bound";

const realNow = () => performance.now();

beforeAll(async () => {
  // 600 ms of the child config's 1000 ms hookTimeout: the hook line's subject.
  await new Promise<void>((resolve) => setTimeout(resolve, 600));
});

test("chain: a bound at 80%", () => {
  expectFasterThan("chain-eighty", 800, 1000);
});

test("chain: a bound at 10%", () => {
  expectRatioBelow("chain-ten", 100, 1000, 1);
});

test("chain: a bound at 120% fails and still reports", () => {
  expectFasterThan("chain-over", 1200, 1000);
});

test("chain: a measure-only bound with its witness", () => {
  const encodes = 3;
  measureTime("chain-measured", 300, 1000, { witness: "encodes" });
  expect(encodes).toBe(3);
});

test("chain: a default wait at about 65% of the default", async () => {
  const t0 = realNow();
  await waitFor(() => {
    if (realNow() - t0 < 650) throw new Error("not yet");
  });
});

test("chain: the same wait under its own 4000 ms timeout", async () => {
  const t0 = realNow();
  await waitFor(
    () => {
      if (realNow() - t0 < 650) throw new Error("not yet");
    },
    { timeout: 4_000 },
  );
});

test("chain: a wait that times out is recorded too", async () => {
  await expect(
    waitFor(
      () => {
        throw new Error("never");
      },
      { timeout: 300 },
    ),
  ).rejects.toThrow("never");
});
