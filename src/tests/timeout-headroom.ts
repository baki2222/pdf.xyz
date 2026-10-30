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
 * Dependency-free on purpose: `vitest.config.ts` imports it.
 */

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

/** `%`, CR and LF are the characters a workflow-command message must escape. */
function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
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
}

export class TimeoutHeadroomReporter {
  private readonly tests: TimedTest[] = [];
  private seen = 0;

  private readonly root: string;
  private readonly github: boolean;

  /** An object, as vitest passes one to a reporter it loads by path. */
  constructor(options: { root?: string; github?: boolean } = {}) {
    this.root = options.root ?? process.cwd();
    this.github = options.github ?? process.env.GITHUB_ACTIONS === "true";
  }

  onTestCaseResult(testCase: TestCaseLike): void {
    const state = testCase.result().state;
    if (state !== "passed" && state !== "failed") return;
    const duration = testCase.diagnostic()?.duration;
    const timeout = testCase.options.timeout;
    if (duration === undefined || timeout === undefined) return;
    this.seen++;
    const id = testCase.module.moduleId.replace(/\\/g, "/");
    const root = this.root.replace(/\\/g, "/").replace(/\/?$/, "/");
    this.tests.push({
      file: id.startsWith(root) ? id.slice(root.length) : id,
      name: testCase.name,
      durationMs: duration,
      timeoutMs: timeout,
    });
  }

  onTestRunEnd(): void {
    process.stdout.write(
      headroomReport(this.seen, this.tests, this.github).join("\n") + "\n",
    );
  }
}

/** For `--reporter=<this file>`, which instantiates the default export. */
export default TimeoutHeadroomReporter;
