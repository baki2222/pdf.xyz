// @vitest-environment node
/**
 * The time-bound helper, its core and the reporter's new blocks, unit by
 * unit. The composed chain (helper → meta → reporter → stdout) is checked
 * through a real child vitest in `time-bound-chain.test.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  brokenPipeLines,
  callTimeoutAt,
  parseTimeBoundLines,
  shareOf,
  timeBoundLine,
  timeBoundReport,
  waitReport,
  type TimeBound,
} from "./time-bound-core";
import {
  expectAtLeast,
  expectFasterThan,
  expectRatioBelow,
  measureTime,
} from "./time-bound";
import { TimeoutHeadroomReporter } from "./timeout-headroom";
import { installWaitRecorder, waitCallSite } from "./wait-recorder";

const bound = (over: Partial<TimeBound>): TimeBound => ({
  id: "x",
  kind: "ceiling",
  measured: 400,
  bound: 1000,
  mode: "assert",
  file: "/r/src/a.ts",
  test: "t",
  line: 3,
  ...over,
});

describe("the core", () => {
  it("a share is measured/bound, (a/b)/bound, or bound/measured", () => {
    expect(shareOf(bound({}))).toBeCloseTo(0.4);
    expect(
      shareOf(bound({ kind: "ratio", measured: 300, control: 200, bound: 2 })),
    ).toBeCloseTo(0.75);
    expect(
      shareOf(bound({ kind: "floor", measured: 400, bound: 100 })),
    ).toBeCloseTo(0.25);
  });

  it("the line keeps the grep convention and carries the whole record back out of a log", () => {
    const rec = bound({ id: "decode", instance: "nup", detail: "2 attempts" });
    const line = timeBoundLine(rec);
    expect(line).toMatch(
      /^\[time-bound\] decode nup: 400 ms of 1000 ms \(40%\) — 2 attempts json=\{/,
    );
    const log = `2026-11-21T10:00:00.000Z stdout | x\n2026-11-21T10:00:00.001Z ${line}\n[time-bound] an old line without a record\n`;
    expect(parseTimeBoundLines(log)).toEqual([rec]);
    expect(
      timeBoundLine(
        bound({ kind: "ratio", measured: 612, control: 400, bound: 2.2 }),
      ),
    ).toContain("1.53x of 2.2x (612 / 400) (70%)");
    expect(timeBoundLine(bound({ mode: "measure", witness: "n" }))).toContain(
      "(40%) [measure]",
    );
  });

  it("reads a call site's own timeout: literal, same-file const, unresolved, default", () => {
    const src = [
      `const SETTLE_MS = 4_000;`,
      `await screen.findByText("a");`,
      `await screen.findByText("b", {}, { timeout: 2_500 });`,
      `await waitFor(() => go(), { timeout: SETTLE_MS });`,
      `await waitFor(() => go(), { timeout: base + 1000 });`,
      `await expect`,
      `  .poll(() => n(), { timeout: 7000 })`,
      `  .toBe(1);`,
      `await expect(x).toBeVisible({ timeout });`,
    ].join("\n");
    expect(callTimeoutAt(src, 2)).toEqual({ kind: "default" });
    expect(callTimeoutAt(src, 3)).toEqual({ kind: "explicit", ms: 2500 });
    expect(callTimeoutAt(src, 4)).toEqual({ kind: "explicit", ms: 4000 });
    expect(callTimeoutAt(src, 5)).toEqual({
      kind: "unresolved",
      text: "timeout: base",
    });
    // Playwright places the step at the matcher, two lines below the timeout.
    expect(callTimeoutAt(src, 8, 3, { backToExpect: true })).toEqual({
      kind: "explicit",
      ms: 7000,
    });
    expect(callTimeoutAt(src, 9).kind).toBe("unresolved");
  });

  it("the time-bound block counts assert-mode bounds over half and lists measure-only ones apart", () => {
    const lines = timeBoundReport(
      [
        bound({ id: "near", measured: 800 }),
        bound({ id: "roomy", measured: 100 }),
        bound({ id: "proposed", measured: 700, mode: "measure", witness: "n" }),
      ],
      { github: true, root: "/r" },
    );
    expect(lines[0]).toBe(
      "time-bound headroom: 1 of 2 wall-clock bounds used more than 50% of their bound (worst: near 80%)",
    );
    expect(lines).toContain(
      "::warning file=src/a.ts,line=3,title=Time bound near its limit::src/a.ts > t > near: 800 ms of 1000 ms",
    );
    expect(lines.join("\n")).not.toMatch(/::warning[^\n]*proposed/);
    expect(lines).toContain(
      "time-bound measure-only: 1 bounds recorded, not asserted (worst vs proposed: proposed 70%)",
    );
  });

  it("the wait block holds each wait to its own timeout, and says when it cannot read one", () => {
    const src = `a();\nawait waitFor(() => b(), { timeout: 4000 });\nawait findByText("c");\nawait waitFor(() => d(), { timeout: later });\n`;
    const lines = waitReport(
      [
        {
          ms: 900,
          file: "/r/a.ts",
          line: 2,
          column: 7,
          defaultTimeoutMs: 1000,
          timedOut: false,
        },
        {
          ms: 700,
          file: "/r/a.ts",
          line: 3,
          column: 7,
          defaultTimeoutMs: 1000,
          timedOut: false,
        },
        {
          ms: 800,
          file: "/r/a.ts",
          line: 4,
          column: 7,
          defaultTimeoutMs: 1000,
          timedOut: true,
        },
      ],
      { github: false, root: "/r", source: () => src },
    );
    expect(lines[0]).toBe(
      "wait headroom: 1 of 3 testing-library waits took more than 50% of their timeout (default asyncUtilTimeout 1000 ms; 1 timed out)",
    );
    expect(lines.join("\n")).toContain("a.ts:3: 700 ms of 1000 ms (default)");
    expect(lines.join("\n")).toContain(
      "a.ts:2: 900 ms of 4000 ms (its own timeout)",
    );
    expect(lines.join("\n")).toContain(
      "1 slow waits pass a timeout this report could not read from source",
    );
  });

  it("the pipe check compares lines printed with records received, and falls back on size", () => {
    expect(
      brokenPipeLines({
        printed: 3,
        recorded: 3,
        testsSeen: 9000,
        github: false,
      }),
    ).toEqual([]);
    expect(
      brokenPipeLines({
        printed: 3,
        recorded: 1,
        testsSeen: 10,
        github: false,
      })[0],
    ).toMatch(/3 \[time-bound\] lines were printed but only 1 records/);
    expect(
      brokenPipeLines({
        printed: 0,
        recorded: 0,
        testsSeen: 6000,
        github: true,
      })[0],
    ).toMatch(
      /^::warning title=time-bound pipe::time-bound pipe broken: 6000 tests ran/,
    );
  });
});

/**
 * Called through an object, so the guard's routed-call scan (which reads
 * bare calls to the helpers) does not take these planted controls for
 * bounds that need a CI calibration. Only passing, low-share calls record
 * anything; the failure path is checked through the child run in
 * `time-bound-chain.test.ts`, so CI's report is not fed a planted 120%.
 */
const helper = {
  expectAtLeast,
  expectFasterThan,
  expectRatioBelow,
  measureTime,
};

describe("the vitest helper", () => {
  it("records, prints and passes inside its bound", () => {
    const rec = helper.expectFasterThan("unit-pass", 10, 1000, {
      instance: "a",
    });
    expect(rec).toMatchObject({
      id: "unit-pass",
      instance: "a",
      kind: "ceiling",
      mode: "assert",
    });
    expect(rec.line).toBeGreaterThan(0);
    expect(helper.expectRatioBelow("unit-ratio", 10, 100, 1).kind).toBe(
      "ratio",
    );
    expect(helper.expectAtLeast("unit-floor", 300, 250).kind).toBe("floor");
  });

  it("refuses a broken measurement and a dead control before recording or comparing anything", () => {
    expect(() => helper.expectFasterThan("unit-nan", Number.NaN, 1000)).toThrow(
      /not a finite time/,
    );
    expect(() => helper.expectFasterThan("unit-neg", -1, 1000)).toThrow(
      /not a finite time/,
    );
    expect(() => helper.expectRatioBelow("unit-dead", 5, 0, 2)).toThrow(
      /the control did no work/,
    );
  });

  it("measure mode never fails, and needs a witness or a pending entry", () => {
    expect(
      helper.measureTime("unit-measure", 50, 1000, { witness: "count" }).mode,
    ).toBe("measure");
    expect(() => helper.measureTime("unit-blind", 10, 1000)).toThrow(
      /needs a witness/,
    );
    expect(() =>
      helper.expectFasterThan("unit-blind-2", 10, 1000, { mode: "measure" }),
    ).toThrow(/needs a witness/);
  });

  describe("outside a test", () => {
    let error: unknown;
    beforeAll(() => {
      try {
        helper.expectFasterThan("unit-hook", 1, 10);
      } catch (e) {
        error = e;
      }
    });
    it("throws 'call inside a test'", () => {
      expect(String(error)).toMatch(/call inside a test/);
    });
  });
});

describe("the wait recorder", () => {
  it("is installed once per realm by setup.ts", () => {
    expect(installWaitRecorder()).toBe(false);
  });

  it("takes the call site from the first test or support frame", () => {
    const stack = [
      "Error",
      "    at wrapper (E:/r/src/tests/wait-recorder.ts:60:19)",
      "    at waitForWrapper (E:/r/node_modules/@testing-library/dom/dist/wait-for.js:166:10)",
      "    at E:/r/src/tests/a-helper.ts:41:20",
    ].join("\n");
    expect(waitCallSite(stack)).toEqual({
      file: "E:/r/src/tests/a-helper.ts",
      line: 41,
      column: 20,
    });
    expect(
      waitCallSite("Error\n    at x (E:/r/node_modules/y.js:1:1)"),
    ).toBeNull();
  });
});

describe("the reporter collects meta from passed AND failed tests", () => {
  it("lists a failing test's bound and its waits", () => {
    const r = new TimeoutHeadroomReporter({
      root: "/r",
      github: false,
      stepSummary: "",
    });
    const testCase = (state: string, meta: object) => ({
      name: state,
      options: { timeout: 5000 },
      module: { moduleId: "/r/src/a.ts" },
      diagnostic: () => ({ duration: 100 }),
      result: () => ({ state }),
      meta: () => meta,
    });
    r.onTestCaseResult(
      testCase("failed", {
        timeBounds: [bound({ id: "red", measured: 1200 })],
      }),
    );
    r.onTestCaseResult(
      testCase("passed", {
        timeBounds: [bound({ id: "green", measured: 100 })],
      }),
    );
    r.onTestCaseResult(
      testCase("skipped", { timeBounds: [bound({ id: "never" })] }),
    );
    const lines = r.report();
    expect(lines).toContain(
      "time-bound headroom: 1 of 2 wall-clock bounds used more than 50% of their bound (worst: red 120%)",
    );
    expect(lines.join("\n")).not.toContain("never");
    expect(lines.some((l) => l.startsWith("time-bound pending:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("hook headroom:"))).toBe(true);
  });
});
