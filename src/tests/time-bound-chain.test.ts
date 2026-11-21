// @vitest-environment node
/**
 * The wall-clock instrument, checked where its reader stands (CLAUDE.md
 * rule 5): a child vitest runs `time-bound-chain.fixture.ts` through the
 * suite's own setup files and ONLY `TimeoutHeadroomReporter`, as on GitHub,
 * and this reads the child's stdout and step summary — the artifact a
 * reviewer receives, not the helper's return value.
 *
 * Every link is in the path: helper → `onTestFinished` → task meta → the
 * worker's result pack → the reporter's `onTestCaseResult` → the printed
 * block. The planted bounds are 80%, 10% and 120%; the 120% one FAILS its
 * test, so its presence in the report proves the failure path carries the
 * measurement (rule 3). The waits are timed by the real wait recorder.
 *
 * CONTROL, through the same child: the helper with its registration deleted
 * (written to a scratch copy, the deletion grepped back first) must make
 * the reporter say the pipe is broken. A green here without that red would
 * be a check that cannot fail.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const CONFIG = "src/tests/time-bound-chain.vitest.config.ts";
const FIXTURE = join(__dirname, "time-bound-chain.fixture.ts");
const HELPER = join(__dirname, "time-bound.ts");

function runChild(extraEnv: Record<string, string> = {}) {
  const vitestCli = join(
    dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("VITEST") || key === "GITHUB_STEP_SUMMARY")
      delete env[key];
  const work = mkdtempSync(join(tmpdir(), "time-bound-chain-"));
  const summary = join(work, "summary.md");
  const run = spawnSync(
    process.execPath,
    [vitestCli, "run", "--config", CONFIG],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...env, TIME_BOUND_CHAIN_SUMMARY: summary, ...extraEnv },
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

/** The fixture line that calls a helper with `id`: derived, not typed. */
function lineOf(id: string): number {
  const lines = readFileSync(FIXTURE, "utf8").split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`"${id}"`));
  expect(at, `the fixture names ${id}`).toBeGreaterThanOrEqual(0);
  return at + 1;
}

describe("the time-bound instrument, end to end through a child vitest", () => {
  it("reports every planted bound, the failing one included, every wait against its own timeout, the pending list and the hooks", () => {
    const child = runChild();
    const out = child.stdout;
    const tail = child.all.slice(-3000);
    // The 120% bound fails its test, so the child run is red: that is the
    // point of the fixture, not a broken child.
    expect(child.status, tail).toBe(1);
    expect(out, tail).toContain(
      "time-bound headroom: 2 of 3 wall-clock bounds used more than 50% of their bound (worst: chain-over 120%)",
    );
    expect(out).toContain(
      `::warning file=src/tests/time-bound-chain.fixture.ts,line=${lineOf("chain-eighty")},title=Time bound near its limit::`,
    );
    expect(out).toContain(
      `::warning file=src/tests/time-bound-chain.fixture.ts,line=${lineOf("chain-over")},title=Time bound near its limit::`,
    );
    expect(out).not.toMatch(/::warning[^\n]*chain-ten/);
    expect(out).toContain(
      "time-bound measure-only: 1 bounds recorded, not asserted (worst vs proposed: chain-measured 30%)",
    );
    expect(out).not.toContain("pipe broken");

    // Waits: the 650 ms default wait is over half of 1000 ms; the same wait
    // under its own 4000 ms timeout is compared against 4000 and is not;
    // the wait that timed out is recorded (from the recorder's finally).
    expect(out).toMatch(
      /wait headroom: 2 of 3 testing-library waits took more than 50% of their timeout \(default asyncUtilTimeout 1000 ms; 1 timed out\)/,
    );
    expect(out).toMatch(
      /::warning [^\n]*title=Wait near its timeout::[^\n]*a default wait at about 65%25 of the default: \d+ ms of 1000 ms \(default\)/,
    );
    expect(out).toMatch(
      /under its own 4000 ms timeout: \d+ ms of 4000 ms \(its own timeout\)/,
    );
    expect(out).not.toMatch(/::warning[^\n]*under its own 4000 ms/);
    expect(out).toMatch(
      /a wait that times out is recorded too: \d+ ms of 300 ms \(its own timeout; TIMED OUT\)/,
    );

    expect(out).toMatch(
      /^time-bound pending: \d+ of at most 25 measure-only bounds/m,
    );
    expect(out).toMatch(
      /hook headroom: 1 of 1 files spent more than 50% of hookTimeout[^\n]*\n[^\n]*time-bound-chain\.fixture\.ts: \d+ ms in beforeAll\/afterAll[^\n]*of hookTimeout 1000 ms/,
    );

    // The same blocks reach the step summary, the page a reviewer opens.
    expect(child.summary).toContain("### Unit-test headroom");
    expect(child.summary).toContain("time-bound headroom: 2 of 3");
    expect(child.summary).not.toContain("::warning");
  }, 150_000);

  it("CONTROL: with the helper's registration deleted, the reporter says the pipe is broken", () => {
    const original = readFileSync(HELPER, "utf8");
    const registration = "(task.meta.timeBounds ??= []).push(rec);";
    expect(original).toContain(registration);
    const dir = join(__dirname, ".time-bound-chain-mutant");
    mkdirSync(dir, { recursive: true });
    const mutantPath = join(dir, "time-bound.ts");
    const abs = (name: string) => join(__dirname, name).split("\\").join("/");
    const mutant = original
      .replace(registration, "void task;")
      .replace('from "./time-bound-core"', `from "${abs("time-bound-core")}"`)
      .replace(
        'from "./wall-clock-pending"',
        `from "${abs("wall-clock-pending")}"`,
      );
    try {
      writeFileSync(mutantPath, mutant);
      // Health check on the mutation itself (CLAUDE.md rule 5): it landed,
      // on the line meant, and nothing else of the helper changed.
      const written = readFileSync(mutantPath, "utf8");
      expect(written).not.toContain(registration);
      expect(written).toContain("void task;");
      expect(written).toContain(abs("time-bound-core"));
      const child = runChild({ TIME_BOUND_CHAIN_HELPER: mutantPath });
      const tail = child.all.slice(-3000);
      expect(child.stdout, tail).toContain(
        "time-bound headroom: 0 of 0 wall-clock bounds",
      );
      expect(child.stdout, tail).toMatch(
        /::warning title=time-bound pipe::time-bound pipe broken: 4 \[time-bound\] lines were printed but only 0 records reached the reporter/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
