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
  headroomLines,
  hookBudgets,
  hookReport,
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
import { TimeoutHeadroomReporter, headroomReport } from "./timeout-headroom";
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
    // The whole expression now (the textual scan stopped at `base`).
    expect(callTimeoutAt(src, 5)).toEqual({
      kind: "unresolved",
      text: "timeout: base + 1000",
    });
    // Playwright places the step at the matcher, two lines below the timeout.
    expect(callTimeoutAt(src, 8, 3, { backToExpect: true })).toEqual({
      kind: "explicit",
      ms: 7000,
    });
    expect(callTimeoutAt(src, 9).kind).toBe("unresolved");
  });

  it("reads the timeout from the call's own options argument, by the AST, not the first `timeout:` in the text", () => {
    // Each of these borrowed a wrong timeout from the textual scan on
    // f8d48720: a `timeout:` inside the callback, and an apostrophe in a
    // regex literal read as an unclosed string, so the scan ran on to the
    // next call's timeout (html-source-area.test.tsx:143 took line 177's).
    const src = [
      `await waitFor(() => { spy({ timeout: 30000 }); check(); });`,
      `await waitFor(() => expect(screen.getByText(/can't open/)).toBeTruthy());`,
      `await screen.findByText("later", {}, { timeout: 8000 });`,
      `await waitFor(cb, opts);`,
      `const OPTS = { timeout: 2_000 };`,
      `await waitFor(cb, OPTS);`,
      `await screen.findByText(/isn't a file/);`,
    ].join("\n");
    expect(callTimeoutAt(src, 1, 7)).toEqual({ kind: "default" });
    expect(callTimeoutAt(src, 2, 7)).toEqual({ kind: "default" });
    expect(callTimeoutAt(src, 3, 14)).toEqual({ kind: "explicit", ms: 8000 });
    expect(callTimeoutAt(src, 4, 7)).toEqual({
      kind: "unresolved",
      text: "options: opts",
    });
    expect(callTimeoutAt(src, 6, 7)).toEqual({ kind: "explicit", ms: 2000 });
    expect(callTimeoutAt(src, 7, 14)).toEqual({ kind: "default" });
  });

  it("a wait that rejects before its timeout is labelled as rejected, not timed out", () => {
    const lines = waitReport(
      [
        {
          ms: 12,
          file: "/r/a.ts",
          line: 1,
          column: 7,
          defaultTimeoutMs: 1000,
          rejected: true,
        },
        {
          ms: 1004,
          file: "/r/a.ts",
          line: 1,
          column: 7,
          defaultTimeoutMs: 1000,
          rejected: true,
        },
      ],
      {
        github: false,
        root: "/r",
        source: () => `await waitForElementToBeRemoved(() => el());\n`,
      },
    ).join("\n");
    expect(lines).toContain("1 timed out, 1 rejected before its timeout");
    expect(lines).toContain("12 ms of 1000 ms (default; REJECTED early)");
    expect(lines).toContain("1004 ms of 1000 ms (default; TIMED OUT)");
  });

  it("annotates only the worst three of a block; the rest are printed plainly (GitHub shows ten per step)", () => {
    const items = [0.9, 0.8, 0.7, 0.6, 0.55].map((share, i) => ({
      share,
      text: `t${i}`,
      file: "src/a.ts",
      line: i + 1,
    }));
    const lines = headroomLines(items, { github: true, title: "T" });
    expect(lines.filter((l) => l.startsWith("::warning"))).toHaveLength(3);
    expect(lines.filter((l) => !l.startsWith("::warning"))).toHaveLength(6);
    expect(lines.at(-1)).toBe(
      "        (2 more over the threshold are not annotated: GitHub shows at most 10 annotations per step)",
    );
  });

  it("the hook line holds a file's hooks to their own timeouts and never annotates", () => {
    const src = [
      `const LONG = 180_000;`,
      `beforeAll(async () => { await big(); }, 300_000);`,
      `afterAll(() => {}, LONG);`,
    ].join("\n");
    expect(hookBudgets(src, 10_000)).toEqual([300_000, 180_000]);
    expect(hookBudgets(`beforeAll(() => {});`, 10_000)).toEqual([10_000]);
    expect(hookBudgets(`it("x", () => {});`, 10_000)).toEqual([]);
    const lines = hookReport(
      [
        // wall-clock-bounds.test.ts on f8d48720: 318% of the GLOBAL 10 s,
        // with its own beforeAll at 300 s.
        {
          file: "/r/a-hooks.ts",
          moduleMs: 31_817,
          testsMs: 0,
          budgets: [300_000],
        },
        { file: "/r/b-hooks.ts", moduleMs: 8_000, testsMs: 0, budgets: [] },
      ],
      10_000,
      { github: true, root: "/r" },
    );
    expect(lines[0]).toMatch(/^hook headroom: 1 of 2 files/);
    expect(lines.join("\n")).not.toContain("::warning");
    expect(lines.join("\n")).not.toContain("a-hooks.ts:");
    expect(lines.join("\n")).toContain(
      "b-hooks.ts: 8000 ms in beforeAll/afterAll (module total less its tests; an upper bound on any one hook) against 10000 ms, the smallest timeout of its hooks (none of its own; hookTimeout)",
    );
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
          rejected: false,
        },
        {
          ms: 700,
          file: "/r/a.ts",
          line: 3,
          column: 7,
          defaultTimeoutMs: 1000,
          rejected: false,
        },
        {
          ms: 800,
          file: "/r/a.ts",
          line: 4,
          column: 7,
          defaultTimeoutMs: 1000,
          rejected: true,
        },
      ],
      { github: false, root: "/r", source: () => src },
    );
    expect(lines[0]).toBe(
      "wait headroom: 1 of 3 waits (testing-library and vi.waitFor) took more than 50% of their timeout (default asyncUtilTimeout 1000 ms; 0 timed out, 1 rejected under a timeout it could not read)",
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
    // On GitHub the plain message is printed TOO: the step summary keeps
    // only lines that are not workflow commands, and on f8d48720 the pipe
    // check printed nothing else, so it never reached the summary.
    expect(
      brokenPipeLines({
        printed: 0,
        recorded: 0,
        testsSeen: 6000,
        github: true,
      }),
    ).toEqual([
      "time-bound pipe broken: 6000 tests ran and no time-bound record reached the reporter",
      "::warning title=time-bound pipe::time-bound pipe broken: 6000 tests ran and no time-bound record reached the reporter",
    ]);
    expect(headroomReport(0, [], true)).toEqual([
      "timeout headroom: saw no test results, so it checked nothing",
      "::warning title=timeout headroom::the headroom reporter saw no test results, so it checked nothing",
    ]);
  });
});

/**
 * HISTORY: on f8d48720 these called the helpers through an object
 * (`helper.expectFasterThan`) so the guard's routed scan would not see
 * them, and the passing calls (`unit-floor` at 83%, `unit-measure`) reached
 * CI's real report on every run — a planted number describing a fixture.
 * The guard now refuses any use of a helper but a call it reads, and the
 * calls that RECORD moved to the child run (`time-bound-chain.fixture.ts`,
 * "chain: the helper returns the record it printed"), whose report is the
 * child's own. What stays here throws before anything is recorded; each
 * measured value is a literal, so it measures nothing and needs no
 * calibration.
 */
describe("the vitest helper", () => {
  it("refuses a broken measurement and a dead control before recording or comparing anything", () => {
    expect(() => expectFasterThan("unit-nan", Number.NaN, 1000)).toThrow(
      /not a finite time/,
    );
    expect(() => expectFasterThan("unit-neg", -1, 1000)).toThrow(
      /not a finite time/,
    );
    expect(() => expectRatioBelow("unit-dead", 5, 0, 2)).toThrow(
      /the control did no work/,
    );
  });

  it("measure mode needs a witness or a pending entry, and the witness cannot be named as a time", () => {
    expect(() => measureTime("unit-blind", 10, 1000)).toThrow(
      /needs a witness/,
    );
    expect(() =>
      expectFasterThan("unit-blind-2", 10, 1000, { mode: "measure" }),
    ).toThrow(/needs a witness/);
    expect(() =>
      measureTime("unit-ms-witness", 10, 1000, { witness: "ms" }),
    ).toThrow(/named as a time/);
    expect(() =>
      measureTime("unit-took-witness", 10, 1000, { witness: "tookMs" }),
    ).toThrow(/named as a time/);
  });

  describe("outside a test", () => {
    let error: unknown;
    beforeAll(() => {
      try {
        expectAtLeast("unit-hook", 1, 10);
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
