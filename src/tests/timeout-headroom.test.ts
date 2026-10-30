// @vitest-environment node
/**
 * The headroom reporter (`./timeout-headroom.ts`) names a test near its
 * timeout, leaves one with room alone, says so when it saw nothing — and is
 * really wired into the CI run, which is checked through a child vitest
 * rather than by reading the config back.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { suiteReporters } from "../../vitest.config";
import {
  HEADROOM_RATIO,
  TimeoutHeadroomReporter,
  headroomReport,
  nearTimeout,
  type TimedTest,
} from "./timeout-headroom";

const t = (name: string, durationMs: number, timeoutMs = 5000): TimedTest => ({
  file: "src/slow-work.ts",
  name,
  durationMs,
  timeoutMs,
});

describe("which tests are near their timeout", () => {
  it("POSITIVE CONTROL: a test past half its budget is named; one under it is not", () => {
    expect(HEADROOM_RATIO).toBe(0.5);
    // The shapes that failed CI in October: 4.9 s, and 5.15 s timed out.
    const near = nearTimeout([
      t("under", 2400),
      t("at the line", 2500),
      t("over", 2600),
      t("timed out", 5150),
      t("own budget, roomy", 9000, 30_000),
      t("own budget, tight", 20_000, 30_000),
    ]);
    expect(near.map((x) => x.name)).toEqual([
      "timed out",
      "own budget, tight",
      "over",
    ]);
  });

  it("the report names each one, and annotates it only on GitHub", () => {
    const tests = [t("slow one", 4000), t("quick one", 10)];
    const local = headroomReport(2, tests, false);
    expect(local[0]).toBe(
      "timeout headroom: 1 of 2 tests used more than 50% of their timeout",
    );
    expect(local.join("\n")).toContain("slow one took 4000 ms of its 5000 ms");
    expect(local.join("\n")).not.toContain("quick one");
    expect(local.some((l) => l.startsWith("::"))).toBe(false);

    const github = headroomReport(2, tests, true);
    expect(github).toContain(
      "::warning file=src/slow-work.ts,title=Test near its timeout::slow one took 4000 ms of its 5000 ms budget (80%25)",
    );
  });

  it("escapes what a workflow command cannot carry raw", () => {
    const [, , annotation] = headroomReport(
      1,
      [
        {
          file: "a,b:c.ts",
          name: "50% off\nnext",
          durationMs: 9,
          timeoutMs: 10,
        },
      ],
      true,
    );
    expect(annotation).toBe(
      "::warning file=a%2Cb%3Ac.ts,title=Test near its timeout::50%25 off%0Anext took 9 ms of its 10 ms budget (90%25)",
    );
  });

  it("HEALTH: a reporter that saw no tests says it checked nothing, not that all is well", () => {
    expect(headroomReport(0, [], false)).toEqual([
      "timeout headroom: saw no test results, so it checked nothing",
    ]);
    expect(headroomReport(0, [], true)[0]).toMatch(
      /^::warning .*checked nothing$/,
    );
  });
});

describe("where it runs", () => {
  it("CI gets it beside vitest's own two reporters; elsewhere vitest chooses", () => {
    const ci = suiteReporters({ GITHUB_ACTIONS: "true" });
    expect(ci?.slice(0, 2)).toEqual(["default", "github-actions"]);
    expect(ci?.[2]).toBeInstanceOf(TimeoutHeadroomReporter);
    expect(suiteReporters({})).toBeUndefined();
  });

  // The composed chain: vitest resolves each test's budget, hands the
  // reporter its result, and the reporter prints. A fresh vitest over a
  // fixture, so what is checked is what a CI log receives.
  it("a real vitest run hands it the budget each test ran under, and it prints the slow one", () => {
    const work = mkdtempSync(join(tmpdir(), "timeout-headroom-"));
    try {
      writeFileSync(
        join(work, "vitest.config.mjs"),
        'export default { test: { include: ["fixture.check.mjs"] } };\n',
      );
      writeFileSync(
        join(work, "fixture.check.mjs"),
        [
          "it('slow under its own budget', async () => {",
          "  await new Promise((r) => setTimeout(r, 900));",
          "}, 1200);",
          "it('quick under the default', () => {});",
          "",
        ].join("\n"),
      );
      const vitestCli = join(
        dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
        "vitest.mjs",
      );
      const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_ACTIONS: "true" };
      for (const key of Object.keys(env))
        if (key.startsWith("VITEST")) delete env[key];
      const run = spawnSync(
        process.execPath,
        [
          vitestCli,
          "run",
          "--root",
          work,
          "--globals",
          "--reporter=dot",
          `--reporter=${join(process.cwd(), "src/tests/timeout-headroom.ts")}`,
        ],
        { cwd: work, encoding: "utf8", timeout: 90_000, env },
      );
      const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, out.slice(-3000)).toBe(0);
      expect(out).toContain(
        "timeout headroom: 1 of 2 tests used more than 50% of their timeout",
      );
      expect(out).toMatch(
        /::warning file=fixture\.check\.mjs,title=Test near its timeout::slow under its own budget took \d+ ms of its 1200 ms budget/,
      );
      expect(out).not.toMatch(/quick under the default took/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    // A child vitest's cold start, on CI's loaded runner (2026-10-30).
  }, 60_000);
});
