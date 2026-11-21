// @vitest-environment node
/**
 * The harvest's pure half, held to a planted `gh run view --log` text: it
 * reads records from any job and the unit suite's duration from its own
 * step, keeps each run's worst value per id (failed runs included), and
 * restarts an entry whose test body changed.
 */
import { describe, expect, it } from "vitest";
import { timeBoundLine, type TimeBound } from "./time-bound-core";
import { harvestLog, mergeRun, repoRelative } from "./time-bounds-harvest-core";

const rec = (measured: number, over: Partial<TimeBound> = {}): TimeBound => ({
  id: "decode",
  kind: "ceiling",
  measured,
  bound: 40_000,
  mode: "assert",
  file: "/home/runner/work/pdf.xyz/pdf.xyz/src/tests/hostile/bounded.ts",
  test: "t",
  line: 9,
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

const empty = { slowRunnerFloorS: 1300, runs: {}, entries: {} };

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
    let cal = mergeRun(
      empty,
      "1",
      "failure",
      harvestLog(log(1500, rec(20_000), rec(27_000))),
      () => "h1",
    ).calibration;
    cal = mergeRun(
      cal,
      "2",
      "success",
      harvestLog(log(1100, rec(18_000))),
      () => "h1",
    ).calibration;
    expect(cal.entries.decode).toMatchObject({
      n: 2,
      ciMax: 27_000,
      ciP50: 22_500,
      runs: ["1", "2"],
      bodyHash: "h1",
    });
    expect(cal.runs).toEqual({
      "1": { conclusion: "failure", unitSuiteS: 1500.25 },
      "2": { conclusion: "success", unitSuiteS: 1100.25 },
    });
    const edited = mergeRun(
      cal,
      "3",
      "success",
      harvestLog(log(1200, rec(5_000))),
      () => "h2",
    ).calibration;
    expect(edited.entries.decode).toMatchObject({
      n: 1,
      ciMax: 5_000,
      runs: ["3"],
      bodyHash: "h2",
    });
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
