/**
 * Which tests ran close to their own timeout — printed on CI, never failed on.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * From 2026-10-24 to 10-30 CI's verify job failed its tests 15 times in 60
 * runs. Seven were guards catching real defects on the branch. The other
 * eight (seven in the unit step, one in the bundle step) were a test running
 * out of time: a different one almost every time, always one whose work took
 * 3–5 s on CI's slower 4-vCPU runners against vitest's 5 s default, and
 * always on a run in the slow half (unit step over 400 s: 8 of 36 runs;
 * under 400 s: 0 of 24). Each was fixed only after it had failed someone's
 * PR — #189, 42b55216, 3bf51a99 — because nothing showed the next one
 * coming: a test at 4.9 s of 5 prints the same green tick as one at 0.1 s.
 * Memory was not it: no log has an out-of-memory error or a killed worker,
 * and a full `pnpm test` at CI's three workers peaks at 4.4 GB across its
 * whole process tree, on a 16 GB runner. The "Array buffer allocation
 * failed" and "Worker task was terminated" lines in those logs are an error
 * `zip-download.test.tsx` injects on purpose and pdf.js's warning when a
 * document is destroyed mid-render; both appear in green runs.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 *
 * A reporter that, at the end of a run, lists every test that used more
 * than {@link HEADROOM_RATIO} of its own budget, slowest share first, and on
 * GitHub Actions turns each into a warning annotation on its file. It is an
 * instrument, not a gate: a red build for "this was slow" would be the very
 * flake it exists to prevent. It reads the budget each test RAN under
 * (`options.timeout`, already resolved from the test's own argument, its
 * describe's options, or the 5 s default), not one inferred from source.
 *
 * Dependency-free on purpose: `vitest.config.ts` imports it. Its only
 * imports are `node:fs` and two dependency-free modules beside it.
 *
 * ── EXTENDED 2026-11-21: the wall-clock instrument ─────────────────────────
 *
 * Beside each test's own timeout it now reports, from the records tests
 * leave in their meta (`./time-bound.ts`, `./wait-recorder.ts`) on a pass
 * AND a failure: every wall-clock bound over half its margin, the
 * measure-only bounds, testing-library waits held to the timeout each ran
 * under, every pending measure-only entry, and the time each file spent in
 * beforeAll/afterAll. A broken meta pipe is reported by relation: more
 * `[time-bound]` lines printed than records received. On GitHub the blocks
 * are also appended to the job's step summary, so they show on the PR page.
 * `./time-bound-chain.test.ts` checks all of it through a child vitest.
 */
import { appendFileSync, readFileSync } from "node:fs";
import {
  brokenPipeLines,
  escapeData,
  escapeProperty,
  hookReport,
  pendingReport,
  timeBoundReport,
  waitReport,
  type TimeBound,
  type WaitRecord,
} from "./time-bound-core";
import { PENDING_CAP, WALL_CLOCK_PENDING } from "./wall-clock-pending";

/** A test reported once it has used more than this share of its timeout. */
export const HEADROOM_RATIO = 0.5;

export interface TimedTest {
  file: string;
  name: string;
  durationMs: number;
  timeoutMs: number;
}

/** The tests over {@link HEADROOM_RATIO} of their budget, largest share first. */
export function nearTimeout(
  tests: readonly TimedTest[],
  ratio: number = HEADROOM_RATIO,
): TimedTest[] {
  return tests
    .filter((t) => t.timeoutMs > 0 && t.durationMs > t.timeoutMs * ratio)
    .sort((a, b) => b.durationMs / b.timeoutMs - a.durationMs / a.timeoutMs);
}

/** The lines printed at the end of a run; annotations only on GitHub. */
export function headroomReport(
  seen: number,
  tests: readonly TimedTest[],
  github: boolean,
): string[] {
  // Health check: a reporter that saw no test cases would report "nothing
  // near its timeout", the strongest possible pass, for the wrong reason.
  if (seen === 0)
    return [
      github
        ? "::warning title=timeout headroom::the headroom reporter saw no test results, so it checked nothing"
        : "timeout headroom: saw no test results, so it checked nothing",
    ];
  const near = nearTimeout(tests);
  const lines = [
    `timeout headroom: ${near.length} of ${seen} tests used more than ${HEADROOM_RATIO * 100}% of their timeout`,
  ];
  for (const t of near) {
    const share = Math.round((t.durationMs / t.timeoutMs) * 100);
    const text = `${t.name} took ${Math.round(t.durationMs)} ms of its ${t.timeoutMs} ms budget (${share}%)`;
    lines.push(`  ${String(share).padStart(3)}%  ${t.file} > ${text}`);
    if (github)
      lines.push(
        `::warning file=${escapeProperty(t.file)},title=${escapeProperty("Test near its timeout")}::${escapeData(text)}`,
      );
  }
  return lines;
}

/** The structural slice of vitest's `TestCase` this reporter reads. */
interface TestCaseLike {
  name: string;
  options: { timeout?: number };
  module: { moduleId: string };
  diagnostic(): { duration: number } | undefined;
  result(): { state: string };
  /** Absent on the hand-built cases of the older tests. */
  meta?(): { timeBounds?: TimeBound[]; waits?: WaitRecord[] };
}

/** The structural slice of vitest's `TestModule` this reporter reads. */
interface TestModuleLike {
  moduleId: string;
  diagnostic(): { duration: number } | undefined;
}

export class TimeoutHeadroomReporter {
  private readonly tests: TimedTest[] = [];
  private seen = 0;
  private readonly bounds: TimeBound[] = [];
  private readonly waits: WaitRecord[] = [];
  private readonly testsMsByModule = new Map<string, number>();
  private readonly modules: {
    file: string;
    moduleMs: number;
    testsMs: number;
  }[] = [];
  private printedBoundLines = 0;
  private hookTimeoutMs = 10_000;

  private readonly root: string;
  private readonly github: boolean;
  private readonly brokenPipeMinTests: number | undefined;
  private readonly stepSummary: string | undefined;

  /** An object, as vitest passes one to a reporter it loads by path. */
  constructor(
    options: {
      root?: string;
      github?: boolean;
      /** The size fallback of the broken-pipe check (default 5,000 tests). */
      brokenPipeMinTests?: number;
      /** Where to append the blocks; `$GITHUB_STEP_SUMMARY` on GitHub. */
      stepSummary?: string;
    } = {},
  ) {
    this.root = options.root ?? process.cwd();
    this.github = options.github ?? process.env.GITHUB_ACTIONS === "true";
    this.brokenPipeMinTests = options.brokenPipeMinTests;
    this.stepSummary =
      options.stepSummary ??
      (this.github ? process.env.GITHUB_STEP_SUMMARY : undefined);
  }

  onInit(ctx: { config?: { hookTimeout?: number } }): void {
    const hookTimeout = ctx.config?.hookTimeout;
    if (typeof hookTimeout === "number") this.hookTimeoutMs = hookTimeout;
  }

  onUserConsoleLog(log: { content: string }): void {
    for (const line of log.content.split("\n"))
      if (line.includes("[time-bound] ") && line.includes(" json={"))
        this.printedBoundLines++;
  }

  onTestCaseResult(testCase: TestCaseLike): void {
    const state = testCase.result().state;
    if (state !== "passed" && state !== "failed") return;
    // Meta first, on both states: a failing bound is the record that
    // matters most (CLAUDE.md rule 3).
    const meta = testCase.meta?.();
    if (meta?.timeBounds) this.bounds.push(...meta.timeBounds);
    if (meta?.waits) this.waits.push(...meta.waits);
    const duration = testCase.diagnostic()?.duration;
    const timeout = testCase.options.timeout;
    if (duration === undefined || timeout === undefined) return;
    this.seen++;
    const moduleId = testCase.module.moduleId;
    this.testsMsByModule.set(
      moduleId,
      (this.testsMsByModule.get(moduleId) ?? 0) + duration,
    );
    this.tests.push({
      file: this.repoPath(moduleId),
      name: testCase.name,
      durationMs: duration,
      timeoutMs: timeout,
    });
  }

  onTestModuleEnd(testModule: TestModuleLike): void {
    const moduleMs = testModule.diagnostic()?.duration;
    if (typeof moduleMs !== "number") return;
    this.modules.push({
      file: testModule.moduleId,
      moduleMs,
      testsMs: this.testsMsByModule.get(testModule.moduleId) ?? 0,
    });
  }

  private repoPath(file: string): string {
    const id = file.replace(/\\/g, "/");
    const root = this.root.replace(/\\/g, "/").replace(/\/?$/, "/");
    return id.startsWith(root) ? id.slice(root.length) : id;
  }

  /** Every block this reporter prints at the end of a run. */
  report(): string[] {
    const sources = new Map<string, string | undefined>();
    const source = (file: string) => {
      if (!sources.has(file)) {
        try {
          sources.set(file, readFileSync(file, "utf8"));
        } catch {
          sources.set(file, undefined);
        }
      }
      return sources.get(file);
    };
    const opts = { github: this.github, root: this.root };
    return [
      ...headroomReport(this.seen, this.tests, this.github),
      ...timeBoundReport(this.bounds, opts),
      ...brokenPipeLines({
        printed: this.printedBoundLines,
        recorded: this.bounds.length,
        testsSeen: this.seen,
        github: this.github,
        ...(this.brokenPipeMinTests === undefined
          ? {}
          : { minTests: this.brokenPipeMinTests }),
      }),
      ...waitReport(this.waits, { ...opts, source }),
      ...pendingReport(WALL_CLOCK_PENDING, PENDING_CAP),
      ...hookReport(this.modules, this.hookTimeoutMs, opts),
    ];
  }

  onTestRunEnd(): void {
    const lines = this.report();
    process.stdout.write(lines.join("\n") + "\n");
    if (!this.stepSummary) return;
    try {
      const body = lines.filter((l) => !l.startsWith("::")).join("\n");
      appendFileSync(
        this.stepSummary,
        `\n### Unit-test headroom\n\n\`\`\`\n${body}\n\`\`\`\n`,
      );
    } catch {
      // An instrument never fails the run it reports on.
    }
  }
}

/** For `--reporter=<this file>`, which instantiates the default export. */
export default TimeoutHeadroomReporter;
