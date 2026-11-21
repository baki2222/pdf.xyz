// @vitest-environment jsdom
/**
 * The fixture `time-bound-chain.test.ts` runs in a child vitest, through
 * the real reporter. Not a test file (the suite's include glob does not
 * match it; the guard's corpus reaches it by name from the child config):
 * its numbers are planted, so each line of the report is known in advance —
 * 80%, 10%, and 120% (which must fail and STILL report).
 *
 * MARGINS. Everything timed here is planted at about 65% of a 3000 ms
 * budget, a margin near 1000 ms either way. On f8d48720 the planted waits
 * sat at 650 of 1000 ms and the parent asserted exact counts: about 150 ms
 * of runner lag turned a passing instrument red (reviewer, 2026-11-21).
 */
import { beforeAll, expect, test, vi } from "vitest";
import { configure, waitFor } from "@testing-library/react";
import {
  expectAtLeast,
  expectFasterThan,
  expectRatioBelow,
  measureTime,
  observeFor,
} from "./time-bound";

const realNow = () => performance.now();

// The default every un-timed wait below runs under.
configure({ asyncUtilTimeout: 3_000 });

beforeAll(async () => {
  await observeFor(
    "chain-hook",
    1_950,
    "65% of the child config's 3000 ms hookTimeout: the hook line's subject",
  );
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

test("chain: the helper returns the record it printed", () => {
  const count = 1;
  const ceiling = expectFasterThan("chain-shape-ceiling", 10, 1000, {
    instance: "a",
  });
  const ratio = expectRatioBelow("chain-shape-ratio", 10, 100, 1);
  const floor = expectAtLeast("chain-shape-floor", 1000, 10);
  const measured = measureTime("chain-shape-measure", 10, 1000, {
    witness: "count",
  });
  expect(count).toBe(1);
  expect(ceiling).toMatchObject({
    id: "chain-shape-ceiling",
    instance: "a",
    kind: "ceiling",
    mode: "assert",
    test: "chain: the helper returns the record it printed",
  });
  expect(ratio.kind).toBe("ratio");
  expect(floor.kind).toBe("floor");
  expect(measured.mode).toBe("measure");
  for (const rec of [ceiling, ratio, floor, measured]) {
    // Filled at record time, so the printed line carries them (finding C1).
    expect(rec.file.replace(/\\/g, "/")).toMatch(
      /src\/tests\/time-bound-chain\.fixture\.ts$/,
    );
    expect(rec.line).toBeGreaterThan(0);
    expect(rec.bodyHash).toMatch(/^[0-9a-f]{16}$/);
  }
});

test("chain: a default wait at about 65% of the default", async () => {
  const t0 = realNow();
  await waitFor(() => {
    if (realNow() - t0 < 1_950) throw new Error("not yet");
  });
});

test("chain: the same wait under its own 12000 ms timeout", async () => {
  const t0 = realNow();
  await waitFor(
    () => {
      if (realNow() - t0 < 1_950) throw new Error("not yet");
    },
    { timeout: 12_000 },
  );
});

test("chain: a vi.waitFor under its own 12000 ms timeout", async () => {
  const t0 = realNow();
  await vi.waitFor(
    () => {
      if (realNow() - t0 < 1_950) throw new Error("not yet");
    },
    { timeout: 12_000, interval: 50 },
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
