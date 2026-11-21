// @vitest-environment node
/**
 * The e2e headroom reporter, read where its reader stands (CLAUDE.md rule
 * 5): a child Playwright runs `e2e/headroom-chain/headroom.chain.ts` with
 * `e2e/headroom-chain.config.ts` — no webServer, and no test takes `page`,
 * so no browser starts — and this reads the blocks the reporter PRINTED.
 *
 * The fixture plants: a bound at 80% and one at 120% (which fails and must
 * still report: rule 3), an expect step at ~65% of the default expect
 * timeout and the same step under its own 12000 ms timeout (compared against
 * 12000, never dropped: critic P6), a test at ~65% of its own timeout, and a
 * test that fails once and passes on its retry (which must appear under
 * "retries masked").
 *
 * CONTROL, through the same child: a scratch copy of the fixture whose
 * helper has its annotation deleted (grepped back first) must make the
 * reporter say the pipe is broken.
 *
 * "sleeps executed" needs a page (`page.waitForTimeout`), so it is held to
 * synthetic steps below instead; it is the one block this chain does not
 * cover.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import HeadroomReporter from "../../e2e/headroom-reporter";

const ROOT = join(__dirname, "..", "..");
const FIXTURE_DIR = join(ROOT, "e2e", "headroom-chain");
const FIXTURE = join(FIXTURE_DIR, "headroom.chain.ts");

function runChild(extraEnv: Record<string, string> = {}) {
  const cli = join(
    dirname(
      createRequire(import.meta.url).resolve("@playwright/test/package.json"),
    ),
    "cli.js",
  );
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("VITEST") ||
      key === "CI" ||
      key === "GITHUB_STEP_SUMMARY"
    )
      delete env[key];
  const work = mkdtempSync(join(tmpdir(), "e2e-headroom-chain-"));
  const summary = join(work, "summary.md");
  const run = spawnSync(
    process.execPath,
    [cli, "test", "-c", "e2e/headroom-chain.config.ts"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...env, E2E_HEADROOM_CHAIN_SUMMARY: summary, ...extraEnv },
    },
  );
  const summaryText = existsSync(summary) ? readFileSync(summary, "utf8") : "";
  rmSync(work, { recursive: true, force: true });
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    all: `${run.stdout ?? ""}\n${run.stderr ?? ""}`,
    summary: summaryText,
  };
}

/** The fixture line of `needle`: derived, never typed. */
function lineOf(needle: string): number {
  const lines = readFileSync(FIXTURE, "utf8").split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(needle));
  expect(at, `the fixture contains ${needle}`).toBeGreaterThanOrEqual(0);
  return at + 1;
}

describe("the e2e headroom reporter, end to end through a child Playwright", () => {
  it("prints every block from what the run really did", () => {
    const child = runChild();
    const out = child.stdout;
    const tail = child.all.slice(-3000);
    // The 120% bound fails on purpose, so the child run is red.
    expect(child.status, tail).toBe(1);
    // Health: the child ran the fixture, not an empty set.
    expect(out, tail).toMatch(/^e2e timeout headroom: \d+ of 6 tests/m);

    expect(out).toMatch(
      /::warning [^\n]*title=E2E test near its timeout::[^\n]*a test at about 65%25 of its own timeout: \d+ ms of its 3000 ms timeout/,
    );
    expect(out).toContain(
      "e2e time-bound headroom: 2 of 2 wall-clock bounds used more than 50% of their bound (worst: e2e-chain-over 120%)",
    );
    expect(out).toContain(
      `::warning file=e2e/headroom-chain/headroom.chain.ts,line=${lineOf('"e2e-chain-eighty"')},title=Time bound near its limit::`,
    );
    expect(out).toContain(
      `::warning file=e2e/headroom-chain/headroom.chain.ts,line=${lineOf('"e2e-chain-over"')},title=Time bound near its limit::`,
    );
    expect(out).not.toContain("pipe broken");

    // The default-timeout expect is held to 3000 ms; the one with its own
    // 12000 ms timeout is held to 12000 and is not flagged.
    expect(out).toMatch(
      /e2e expect headroom: 1 of \d+ expect steps took more than 50% of their timeout \(expect\.timeout 3000 ms\)/,
    );
    expect(out).toMatch(
      /::warning [^\n]*title=E2E expect near its timeout::[^\n]*an expect step at about 65%25 of expect\.timeout: [^\n]* of 3000 ms \(expect\.timeout\)/,
    );
    expect(out).not.toMatch(/near its timeout::[^\n]*own 12000 ms timeout/);

    expect(out).toContain(
      "retries masked: 1 tests failed and then passed on a retry",
    );
    expect(out).toContain(
      `::warning file=e2e/headroom-chain/headroom.chain.ts,line=${lineOf("fails once and passes")},title=Flaky e2e test hidden by a retry::`,
    );
    expect(out).toMatch(
      /attempt 1 of 2 failed: Error: the first attempt fails on purpose/,
    );
    expect(out).toContain("sleeps executed: 0 fixed waits ran");

    expect(child.summary).toContain("### E2E headroom");
    expect(child.summary).toContain("retries masked: 1");
    expect(child.summary).not.toContain("::warning");
  }, 150_000);

  it("CONTROL: with the helper's annotation deleted, the reporter says the pipe is broken", () => {
    const helper = readFileSync(join(ROOT, "e2e", "time-bound.ts"), "utf8");
    const annotation = "info.annotations.push(";
    expect(helper).toContain(annotation);
    const dir = join(ROOT, "e2e", ".headroom-chain-mutant");
    rmSync(dir, { recursive: true, force: true });
    try {
      cpSync(FIXTURE_DIR, dir, { recursive: true });
      const fixture = join(dir, "headroom.chain.ts");
      writeFileSync(
        fixture,
        readFileSync(fixture, "utf8").replace(
          'from "../time-bound"',
          'from "./time-bound"',
        ),
      );
      writeFileSync(
        join(dir, "time-bound.ts"),
        helper
          .replace(annotation, "void (")
          .replaceAll('from "../src/tests/', 'from "../../src/tests/'),
      );
      // Health check on the mutation: it landed where meant.
      const mutant = readFileSync(join(dir, "time-bound.ts"), "utf8");
      expect(mutant).not.toContain(annotation);
      expect(readFileSync(fixture, "utf8")).toContain('from "./time-bound"');
      const child = runChild({ E2E_HEADROOM_CHAIN_DIR: dir });
      const tail = child.all.slice(-3000);
      expect(child.stdout, tail).toContain(
        "e2e time-bound headroom: 0 of 0 wall-clock bounds",
      );
      expect(child.stdout, tail).toMatch(
        /::warning title=time-bound pipe::time-bound pipe broken: [1-9]\d* \[time-bound\] lines were printed but only 0 records reached the reporter/,
      );
      // The plain message reaches the step summary too (finding C4).
      expect(child.summary, tail).toMatch(
        /time-bound pipe broken: [1-9]\d* \[time-bound\] lines were printed but only 0 records reached the reporter/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);
});

describe("sleeps executed (synthetic steps: the chain has no page)", () => {
  it("lists every Wait for timeout step with its duration, longest first, and nothing else", () => {
    const reporter = new HeadroomReporter({ github: false });
    const test = {
      title: "a spec that sleeps",
      location: {
        file: join(ROOT, "e2e", "smoke.spec.ts"),
        line: 3,
        column: 1,
      },
      timeout: 30_000,
      outcome: () => "expected",
    } as unknown as TestCase;
    const step = (title: string, category: string, ms: number, line: number) =>
      ({
        title,
        category,
        duration: ms,
        location: { file: join(ROOT, "e2e", "smoke.spec.ts"), line, column: 5 },
      }) as unknown as TestStep;
    const result = { duration: 900, annotations: [] } as unknown as TestResult;
    reporter.onStepEnd(
      test,
      result,
      step("Wait for timeout", "pw:api", 300, 7),
    );
    reporter.onStepEnd(
      test,
      result,
      step("Wait for timeout", "pw:api", 500, 9),
    );
    reporter.onStepEnd(test, result, step("Click button", "pw:api", 800, 11));
    reporter.onTestEnd(test, result);
    const lines = reporter.report();
    const at = lines.findIndex((l) => l.startsWith("sleeps executed:"));
    expect(lines[at]).toBe("sleeps executed: 2 fixed waits ran, 800 ms in all");
    expect(lines.slice(at + 1, at + 3)).toEqual([
      "     500 ms  e2e/smoke.spec.ts:9 > a spec that sleeps: Wait for timeout",
      "     300 ms  e2e/smoke.spec.ts:7 > a spec that sleeps: Wait for timeout",
    ]);
  });
});
