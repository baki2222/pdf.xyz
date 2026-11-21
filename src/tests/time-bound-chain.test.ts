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
 * The harvest is checked here too, at the point of consumption: the child's
 * stdout, prefixed the way `gh run view --log` prefixes it, goes through
 * the script's own harvest and hash lookup, and must calibrate the planted
 * ids against the fixture's real body hashes (finding C1: on f8d48720 every
 * printed vitest record had file "", and the real harvest calibrated
 * nothing while its unit test, fed a planted log, passed).
 *
 * CONTROL, through the same child: the helper with its registration deleted
 * (written to a scratch copy, the deletion grepped back first) must make
 * the reporter say the pipe is broken — in the log AND in the step summary.
 * A green here without that red would be a check that cannot fail.
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
import { harvestLog, mergeRun, todayHashes } from "./time-bounds-harvest-core";
import { scanSource } from "./wall-clock-detector";

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
    if (
      key.startsWith("VITEST") ||
      key === "GITHUB_STEP_SUMMARY" ||
      key.toLowerCase() === "npm_lifecycle_event"
    )
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
  it("reports every planted bound, the failing one included, every wait against its own timeout, the pending list and the hooks — and the harvest calibrates from that very log", () => {
    const child = runChild();
    const out = child.stdout;
    const tail = child.all.slice(-3000);
    // The 120% bound fails its test, so the child run is red: that is the
    // point of the fixture, not a broken child.
    expect(child.status, tail).toBe(1);
    // Exactly the 120% test failed: every other fixture test (the record
    // shape included) passed — a red there would hide under the planted one.
    expect(out, tail).toContain(
      "headroom report for vitest: 1 files, 9 tests (1 failed)",
    );
    expect(out, tail).toContain(
      "time-bound headroom: 2 of 6 wall-clock bounds used more than 50% of their bound (worst: chain-over 120%)",
    );
    expect(out).toContain(
      `::warning file=src/tests/time-bound-chain.fixture.ts,line=${lineOf("chain-eighty")},title=Time bound near its limit::`,
    );
    expect(out).toContain(
      `::warning file=src/tests/time-bound-chain.fixture.ts,line=${lineOf("chain-over")},title=Time bound near its limit::`,
    );
    expect(out).not.toMatch(/::warning[^\n]*chain-ten/);
    expect(out).toContain(
      "time-bound measure-only: 2 bounds recorded, not asserted (worst vs proposed: chain-measured 30%)",
    );
    expect(out).not.toContain("pipe broken");

    // Waits: the ~1950 ms default wait is over half of the 3000 ms default;
    // the same wait under its own 12000 ms timeout is compared against
    // 12000 and is not; the wait that timed out is recorded (finally).
    expect(out).toMatch(
      /wait headroom: 2 of 4 waits \(testing-library and vi\.waitFor\) took more than 50% of their timeout \(default asyncUtilTimeout 3000 ms; 1 timed out\)/,
    );
    expect(out).toMatch(
      /::warning [^\n]*title=Wait near its timeout::[^\n]*a default wait at about 65%25 of the default: \d+ ms of 3000 ms \(default\)/,
    );
    expect(out).toMatch(
      /under its own 12000 ms timeout: \d+ ms of 12000 ms \(its own timeout\)/,
    );
    expect(out).not.toMatch(/::warning[^\n]*under its own 12000 ms/);
    expect(out).toMatch(
      /a wait that times out is recorded too: \d+ ms of 300 ms \(its own timeout; TIMED OUT\)/,
    );
    // vi.waitFor is timed too, against its own options (59 call sites in
    // the tree were seen by nothing on f8d48720).
    expect(out).toMatch(
      /a vi\.waitFor under its own 12000 ms timeout: \d+ ms of 12000 ms \(its own timeout\)/,
    );

    expect(out).toMatch(
      /^time-bound pending: \d+ of at most 25 measure-only bounds/m,
    );
    expect(out).toMatch(
      /hook headroom: 1 of 1 files spent more than 50% of their hooks. smallest timeout[^\n]*\n[^\n]*time-bound-chain\.fixture\.ts: \d+ ms in beforeAll\/afterAll[^\n]*against 3000 ms, the smallest timeout of its hooks \(1 of its own: 3000 ms\)/,
    );
    expect(out).not.toMatch(/::warning[^\n]*Hooks near/);

    // The same blocks reach the step summary, the page a reviewer opens,
    // under a title that says which run they are from.
    expect(child.summary).toContain("### Unit-test headroom (vitest, 1 files)");
    expect(child.summary).toContain("time-bound headroom: 2 of 6");
    expect(child.summary).not.toContain("::warning");

    // The harvest, through the script's own functions, on what the child
    // really printed (as gh prints a job's lines: job, step, timestamp).
    const ghLog = out
      .split(/\r?\n/)
      .map(
        (l) =>
          `Typecheck · Lint · Test · Build\tUNKNOWN STEP\t2026-11-21T10:00:00Z ${l}`,
      )
      .join("\n");
    const harvested = harvestLog(ghLog);
    const files = [
      ...new Set(harvested.records.map((r) => r.file.replace(/\\/g, "/"))),
    ];
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/src\/tests\/time-bound-chain\.fixture\.ts$/);
    const todayHash = todayHashes(
      ROOT,
      (file) => readFileSync(file, "utf8"),
      scanSource,
    );
    const { calibration, skipped } = mergeRun(
      {
        slowRunnerFloorS: 1300,
        window: { workflow: "ci.yml", attempts: [] },
        runs: {},
        entries: {},
      },
      "1/1",
      "failure",
      harvested,
      todayHash,
    );
    const guardHashes = new Map(
      scanSource(readFileSync(FIXTURE, "utf8"), "f.ts").routed.map((r) => [
        r.id,
        r.bodyHash,
      ]),
    );
    expect(skipped).toEqual([]);
    for (const id of ["chain-eighty", "chain-over", "chain-measured"]) {
      expect(calibration.entries[id], id).toBeDefined();
      expect(calibration.entries[id]!.bodyHash).toBe(guardHashes.get(id));
    }
    expect(calibration.entries["chain-over"]!.ciMax).toBe(1200);
  }, 150_000);

  it("CONTROL: with the helper's registration deleted, the reporter says the pipe is broken, in the log and the summary", () => {
    const original = readFileSync(HELPER, "utf8");
    const registration = "(task.meta.timeBounds ??= []).push(rec);";
    expect(original).toContain(registration);
    const dir = join(__dirname, ".time-bound-chain-mutant");
    mkdirSync(dir, { recursive: true });
    const mutantPath = join(dir, "time-bound.ts");
    const abs = (name: string) => join(__dirname, name).split("\\").join("/");
    const mutant = original
      .replace(registration, "void task;")
      .replace(
        /from "\.\/([\w-]+)"/g,
        (_m, name: string) => `from "${abs(name)}"`,
      );
    try {
      writeFileSync(mutantPath, mutant);
      // Health check on the mutation itself (CLAUDE.md rule 5): it landed,
      // on the line meant, and nothing else of the helper changed.
      const written = readFileSync(mutantPath, "utf8");
      expect(written).not.toContain(registration);
      expect(written).toContain("void task;");
      expect(written).toContain(abs("time-bound-core"));
      expect(written).not.toMatch(/from "\.\//);
      const child = runChild({ TIME_BOUND_CHAIN_HELPER: mutantPath });
      const tail = child.all.slice(-3000);
      expect(child.stdout, tail).toContain(
        "time-bound headroom: 0 of 0 wall-clock bounds",
      );
      expect(child.stdout, tail).toMatch(
        /::warning title=time-bound pipe::time-bound pipe broken: 8 \[time-bound\] lines were printed but only 0 records reached the reporter/,
      );
      // ... and the plain message reaches the step summary, which drops
      // workflow commands (finding C4: on f8d48720 it never did).
      expect(child.summary, tail).toContain(
        "time-bound pipe broken: 8 [time-bound] lines were printed but only 0 records reached the reporter",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
