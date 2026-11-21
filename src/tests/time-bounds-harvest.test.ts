// @vitest-environment node
/**
 * The harvest's pure half, held to a planted `gh run view --log` text: it
 * reads records from any job and the unit suite's duration from its own
 * step, keeps each attempt's worst value per id (failed attempts included,
 * each keyed `run/attempt`), and counts a value only for the test body it
 * was MEASURED on (the record's own `bodyHash`, computed when it ran).
 *
 * The composed chain — a line printed by the real helper in a real child
 * vitest, harvested by the script's own hash function — is checked in
 * `time-bound-chain.test.ts`: on f8d48720 this file's planted log carried a
 * `file` the real vitest log never did, and the test passed while the real
 * harvest calibrated nothing (finding C1, 2026-11-21).
 */
import { describe, expect, it } from "vitest";
import { timeBoundLine, type TimeBound } from "./time-bound-core";
import { calibrationProblem } from "./time-bound-calibration";
import { harvestLog, mergeRun, repoRelative } from "./time-bounds-harvest-core";
import { scanSource } from "./wall-clock-detector";

const rec = (measured: number, over: Partial<TimeBound> = {}): TimeBound => ({
  id: "decode",
  kind: "ceiling",
  measured,
  bound: 40_000,
  mode: "assert",
  file: "/home/runner/work/pdf.xyz/pdf.xyz/src/tests/hostile/bounded.ts",
  test: "t",
  line: 9,
  bodyHash: "h1",
  ...over,
});

const log = (unitS: number, ...recs: TimeBound[]) =>
  [
    `Typecheck · Lint · Test · Build\tUnit tests\t2026-11-21T10:00:00Z ${timeBoundLine(recs[0]!)}`,
    ...recs
      .slice(1)
      .map(
        (r) =>
          `Playwright smoke\tRun Playwright smoke tests\t2026-11-21T10:01:00Z ${timeBoundLine(r)}`,
      ),
    // As gh prints it (run 44418885729): no step name, colour codes written
    // as the two characters "^[" (raw ESC bytes on a TTY), and the bundle
    // step's own, shorter vitest run in the same job.
    `Typecheck · Lint · Test · Build\tUNKNOWN STEP\t2026-11-21T10:30:00Z ^[[2m   Duration ^[[22m ${unitS}.25s^[[2m (transform 56.16s, setup 120.82s)`,
    `Typecheck · Lint · Test · Build\tUNKNOWN STEP\t2026-11-21T10:32:00Z \u001b[2m   Duration \u001b[22m 23.25s\u001b[2m (transform 5.70s)`,
  ].join("\n");

const empty = {
  slowRunnerFloorS: 1300,
  window: { workflow: "ci.yml", attempts: [] as string[] },
  runs: {},
  entries: {},
};

describe("the harvest", () => {
  it("reads every job's records and the unit suite's own duration", () => {
    const h = harvestLog(
      log(
        1402,
        rec(20_000),
        rec(1.4, { id: "gray", kind: "ratio", control: 1, bound: 2.2 }),
      ),
    );
    expect(h.records.map((r) => r.id)).toEqual(["decode", "gray"]);
    expect(h.unitSuiteS).toBe(1402.25);
  });

  it("keeps each run's worst value, failed runs included, and restarts an entry whose body changed", () => {
    // Run 1 failed on its first attempt and passed on its second: both
    // attempts count (on f8d48720 only the latest attempt was read, so the
    // failure vanished and the run was logged as a success).
    let cal = mergeRun(
      empty,
      "1/1",
      "failure",
      harvestLog(log(1500, rec(20_000), rec(27_000))),
      () => "h1",
    ).calibration;
    cal = mergeRun(
      cal,
      "1/2",
      "success",
      harvestLog(log(1100, rec(18_000))),
      () => "h1",
    ).calibration;
    expect(cal.entries.decode).toMatchObject({
      n: 2,
      ciMax: 27_000,
      ciP50: 22_500,
      runs: ["1/1", "1/2"],
      bodyHash: "h1",
    });
    expect(cal.runs).toEqual({
      "1/1": { conclusion: "failure", unitSuiteS: 1500.25 },
      "1/2": { conclusion: "success", unitSuiteS: 1100.25 },
    });
    // Today's body is h2 and the run measured h2: the entry starts again.
    const edited = mergeRun(
      cal,
      "3/1",
      "success",
      harvestLog(log(1200, rec(5_000, { bodyHash: "h2" }))),
      () => "h2",
    ).calibration;
    expect(edited.entries.decode).toMatchObject({
      n: 1,
      ciMax: 5_000,
      runs: ["3/1"],
      bodyHash: "h2",
    });
  });

  it("a value measured on an OLD body never certifies today's, whatever today's tree says", () => {
    // On f8d48720 every value was stamped with the hash of today's body, so
    // five runs from before an edit calibrated the edited test (finding S2).
    const { calibration, skipped } = mergeRun(
      empty,
      "9/1",
      "success",
      harvestLog(log(1400, rec(20_000, { bodyHash: "before-the-edit" }))),
      () => "after-the-edit",
    );
    expect(calibration.entries).toEqual({});
    expect(skipped[0]).toMatch(
      /^decode: measured on test body before-the-edit, today's is after-the-edit/,
    );
    const old = mergeRun(
      empty,
      "9/1",
      "success",
      harvestLog(log(1400, rec(20_000, { bodyHash: undefined }))),
      () => "after-the-edit",
    );
    expect(old.calibration.entries).toEqual({});
    expect(old.skipped[0]).toMatch(/printed no body hash/);
  });

  it("calibration counts only attempts inside the harvested window (no hand-picked runs)", () => {
    const call = scanSource(
      `test("t", () => { expectFasterThan("decode", performance.now() - t0, 60_000); });`,
      "src/tests/hostile/bounded.ts",
    ).routed[0]!;
    const runs = ["1/1", "2/1", "3/1", "4/1", "5/1"];
    const cal = {
      slowRunnerFloorS: 1300,
      window: { workflow: "ci.yml", attempts: runs.slice(0, 4) },
      runs: Object.fromEntries(
        runs.map((r) => [r, { conclusion: "success", unitSuiteS: 1400 }]),
      ),
      entries: {
        decode: {
          kind: "ceiling" as const,
          n: 5,
          ciMax: 20_000,
          ciP50: 18_000,
          runs,
          source: "time-bound lines" as const,
          bodyHash: call.bodyHash,
        },
      },
    };
    expect(calibrationProblem(call, cal)).toMatch(
      /outside the harvested window: 5\/1/,
    );
    cal.window.attempts = runs;
    expect(calibrationProblem(call, cal)).toBeNull();
  });

  it("skips a record whose routed call is gone, and maps runner paths into the repo", () => {
    const { calibration, skipped } = mergeRun(
      empty,
      "1",
      "success",
      harvestLog(log(1000, rec(1))),
      () => undefined,
    );
    expect(calibration.entries).toEqual({});
    expect(skipped[0]).toMatch(/^decode: no routed call/);
    expect(
      repoRelative("/home/runner/work/pdf.xyz/pdf.xyz/e2e/helpers.ts"),
    ).toBe("e2e/helpers.ts");
  });
});
