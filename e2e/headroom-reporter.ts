import { appendFileSync, readFileSync } from "node:fs";
import type {
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";
import {
  BOUND_HEADROOM_RATIO,
  brokenPipeLines,
  callTimeoutAt,
  ANNOTATIONS_PER_BLOCK,
  annotation,
  headroomLines,
  timeBoundReport,
  type HeadroomItem,
  type TimeBound,
} from "../src/tests/time-bound-core";

/**
 * The e2e half of the headroom instrument, wired into the CI reporter list
 * (`playwright.config.ts`). Until it arrived nothing measured the e2e suite
 * at all: `ci-durations.tsv` had no e2e rows, and the tests that went green
 * only on a retry were known from reading logs by hand. It prints five
 * blocks at the end of a run, warns and never fails:
 *
 *  1. e2e timeout headroom — each test's last attempt against its timeout;
 *  2. e2e time-bound headroom — the `e2e/time-bound.ts` records, from each
 *     attempt's annotations (pass and fail), with the broken-pipe check;
 *  3. e2e expect headroom — every `expect` step held to the timeout it RAN
 *     under: its own `timeout:` read from the call site's source
 *     (`step.location`), the config's expect timeout otherwise (critic P6:
 *     explicit timeouts are compared, never dropped). This covers every
 *     web-first expect with no edit to any spec;
 *  4. retries masked — tests whose outcome is "flaky", with the first
 *     failing attempt's first error line;
 *  5. sleeps executed — every "Wait for timeout" step as it actually ran,
 *     summed per call site (total, count, longest), the worst
 *     {@link SLEEP_SITES} listed and the rest summed.
 *
 * `src/tests/e2e-headroom-chain.test.ts` runs it in a child Playwright
 * (no browser) and reads the blocks back.
 */

/** How many sleep call sites the "sleeps executed" block lists by name. */
export const SLEEP_SITES = 25;

export interface HeadroomReporterOptions {
  /** The suite's `expect.timeout`; the reporter API does not expose it. */
  expectTimeoutMs?: number;
  github?: boolean;
  /** Where to append the blocks; `$GITHUB_STEP_SUMMARY` on GitHub. */
  stepSummary?: string;
}

interface ExpectStep {
  file: string;
  line: number;
  column: number;
  title: string;
  ms: number;
  test: string;
}

export default class HeadroomReporter implements Reporter {
  private readonly expectTimeoutMs: number;
  private readonly github: boolean;
  private readonly stepSummary: string | undefined;
  private readonly root = process.cwd();
  private readonly tests = new Map<TestCase, TestResult[]>();
  private readonly expects: ExpectStep[] = [];
  private readonly sleeps: ExpectStep[] = [];
  private printed = 0;

  constructor(options: HeadroomReporterOptions = {}) {
    this.expectTimeoutMs = options.expectTimeoutMs ?? 5_000;
    this.github = options.github ?? process.env.GITHUB_ACTIONS === "true";
    this.stepSummary =
      options.stepSummary ??
      (this.github ? process.env.GITHUB_STEP_SUMMARY : undefined);
  }

  printsToStdio(): boolean {
    return true;
  }

  onStdOut(chunk: string | Buffer): void {
    for (const line of chunk.toString().split("\n"))
      if (line.includes("[time-bound] ") && line.includes(" json={"))
        this.printed++;
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    const loc = step.location;
    const row = {
      file: loc?.file ?? test.location.file,
      line: loc?.line ?? 0,
      column: loc?.column ?? 1,
      title: step.title,
      ms: step.duration,
      test: test.title,
    };
    if (step.category === "expect") this.expects.push(row);
    else if (
      step.category === "pw:api" &&
      /^Wait for timeout/i.test(step.title)
    )
      this.sleeps.push(row);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const list = this.tests.get(test) ?? [];
    list.push(result);
    this.tests.set(test, list);
  }

  private rel(file: string): string {
    const f = file.replace(/\\/g, "/");
    const r = this.root.replace(/\\/g, "/").replace(/\/?$/, "/");
    return f.startsWith(r) ? f.slice(r.length) : f;
  }

  report(): string[] {
    const github = this.github;
    const lines: string[] = [];

    // 1. Timeouts.
    const timeouts: HeadroomItem[] = [];
    for (const [test, results] of this.tests) {
      const last = results[results.length - 1]!;
      if (!(test.timeout > 0)) continue;
      timeouts.push({
        share: last.duration / test.timeout,
        text: `${this.rel(test.location.file)} > ${test.title}: ${Math.round(last.duration)} ms of its ${test.timeout} ms timeout`,
        file: this.rel(test.location.file),
        line: test.location.line,
      });
    }
    const overTimeouts = timeouts.filter((t) => t.share > BOUND_HEADROOM_RATIO);
    lines.push(
      `e2e timeout headroom: ${overTimeouts.length} of ${timeouts.length} tests used more than ${BOUND_HEADROOM_RATIO * 100}% of their timeout`,
      ...headroomLines(timeouts, {
        github,
        title: "E2E test near its timeout",
      }),
    );

    // 2. Time bounds, from every attempt.
    const bounds: TimeBound[] = [];
    for (const results of this.tests.values())
      for (const r of results)
        for (const a of r.annotations)
          if (a.type === "time-bound" && a.description) {
            try {
              bounds.push(JSON.parse(a.description) as TimeBound);
            } catch {
              // Not a record: counted by the pipe check below.
            }
          }
    lines.push(
      ...timeBoundReport(bounds, { github, root: this.root }).map((l) =>
        l.startsWith("time-bound") ? `e2e ${l}` : l,
      ),
      ...brokenPipeLines({
        printed: this.printed,
        recorded: bounds.length,
        testsSeen: this.tests.size,
        github,
        minTests: Number.POSITIVE_INFINITY,
      }),
    );

    // 3. Expects, each against the timeout it ran under.
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
    const expectItems: HeadroomItem[] = [];
    const unresolved: string[] = [];
    for (const s of this.expects) {
      const src = source(s.file);
      const t = src
        ? callTimeoutAt(src, s.line, s.column, { backToExpect: true })
        : { kind: "default" as const };
      const site = `${this.rel(s.file)}:${s.line}`;
      if (t.kind === "unresolved") {
        if (s.ms > this.expectTimeoutMs * BOUND_HEADROOM_RATIO)
          unresolved.push(
            `        ${site} > ${s.test}: ${s.title} took ${Math.round(s.ms)} ms (${t.text})`,
          );
        continue;
      }
      const budget = t.kind === "explicit" ? t.ms : this.expectTimeoutMs;
      expectItems.push({
        share: s.ms / budget,
        text: `${site} > ${s.test}: ${s.title} took ${Math.round(s.ms)} ms of ${budget} ms (${t.kind === "explicit" ? "its own timeout" : "expect.timeout"})`,
        file: this.rel(s.file),
        line: s.line,
      });
    }
    const overExpects = expectItems.filter(
      (e) => e.share > BOUND_HEADROOM_RATIO,
    );
    lines.push(
      `e2e expect headroom: ${overExpects.length} of ${this.expects.length} expect steps took more than ${BOUND_HEADROOM_RATIO * 100}% of their timeout (expect.timeout ${this.expectTimeoutMs} ms)`,
      ...headroomLines(expectItems, {
        github,
        title: "E2E expect near its timeout",
      }),
    );
    if (unresolved.length > 0)
      lines.push(
        `e2e expect headroom: ${unresolved.length} slow expects pass a timeout this report could not read from source:`,
        ...unresolved,
      );

    // 4. Retries masked.
    const flaky = [...this.tests].filter(
      ([test]) => test.outcome() === "flaky",
    );
    lines.push(
      `retries masked: ${flaky.length} tests failed and then passed on a retry`,
    );
    flaky.forEach(([test, results], i) => {
      const failed = results.find(
        (r) => r.status !== "passed" && r.status !== "skipped",
      );
      const first = (
        failed?.error?.message ??
        failed?.errors[0]?.message ??
        "(no error message)"
      )
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split("\n")[0]!;
      const text = `${this.rel(test.location.file)}:${test.location.line} > ${test.title}: attempt ${failed ? failed.retry + 1 : "?"} of ${results.length} failed: ${first}`;
      lines.push(`  ${text}`);
      if (github && i < ANNOTATIONS_PER_BLOCK)
        lines.push(
          annotation(
            this.rel(test.location.file),
            test.location.line,
            "Flaky e2e test hidden by a retry",
            text,
          ),
        );
    });
    if (github && flaky.length > ANNOTATIONS_PER_BLOCK)
      lines.push(
        `        (${flaky.length - ANNOTATIONS_PER_BLOCK} more are not annotated: GitHub shows at most 10 annotations per step)`,
      );

    // 5. Sleeps executed, one line per call site (a site runs once per
    // page or per test: CI printed 4,391 single-step lines on run
    // 44917160721). The first SLEEP_SITES by total are listed and the rest
    // summed, so every sleep stays in the totals.
    const sleptMs = this.sleeps.reduce((n, s) => n + s.ms, 0);
    const sites = new Map<
      string,
      { total: number; count: number; longest: ExpectStep; tests: Set<string> }
    >();
    for (const s of this.sleeps) {
      const key = `${this.rel(s.file)}:${s.line}`;
      const site = sites.get(key) ?? {
        total: 0,
        count: 0,
        longest: s,
        tests: new Set<string>(),
      };
      site.total += s.ms;
      site.count++;
      if (s.ms > site.longest.ms) site.longest = s;
      site.tests.add(s.test);
      sites.set(key, site);
    }
    const ranked = [...sites.entries()].sort((a, b) => b[1].total - a[1].total);
    lines.push(
      `sleeps executed: ${this.sleeps.length} fixed waits ran, ${Math.round(sleptMs)} ms in all, at ${sites.size} call sites`,
    );
    for (const [key, site] of ranked.slice(0, SLEEP_SITES)) {
      const more = site.tests.size - 1;
      lines.push(
        `  ${String(Math.round(site.total)).padStart(6)} ms in ${site.count} (longest ${Math.round(site.longest.ms)} ms)  ${key} > ${site.longest.test}${more > 0 ? ` (+${more} more test${more === 1 ? "" : "s"})` : ""}`,
      );
    }
    const rest = ranked.slice(SLEEP_SITES);
    if (rest.length > 0)
      lines.push(
        `        (${rest.length} more call sites: ${rest.reduce((n, [, s]) => n + s.count, 0)} waits, ${Math.round(rest.reduce((n, [, s]) => n + s.total, 0))} ms)`,
      );

    return lines;
  }

  onEnd(): void {
    const lines = this.report();
    process.stdout.write(lines.join("\n") + "\n");
    if (!this.stepSummary) return;
    try {
      const body = lines.filter((l) => !l.startsWith("::")).join("\n");
      appendFileSync(
        this.stepSummary,
        `\n### E2E headroom\n\n\`\`\`\n${body}\n\`\`\`\n`,
      );
    } catch {
      // An instrument never fails the run it reports on.
    }
  }
}
