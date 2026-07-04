// @vitest-environment node
/**
 * Drives the committed release-audit example bundle fixtures through the REAL in-process runner and proves:
 * a coherent baseline vs an equal current is `pass`; a softened current is `warn`; a failed current is
 * `fail`; a hand-flipped (tampered) current fails closed; an unreadable input is `unknown` (never a
 * fabricated pass); every rendered audit is free of any locator token; the README lists every fixture (no
 * silent gap); and the CI workflow example wires the previous/current release-ci-bundle comparison.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runReleaseAudit, type ReleaseAuditProvider } from "./run";
import { pairArgs } from "./fixtures";

const DIR = join(process.cwd(), "docs", "examples", "release-audit");
const CI = join(process.cwd(), "docs", "examples", "deployment", "github-actions", "release-audit-fixture.yml");

/** Locator VALUES that must never appear in a fixture or a rendered audit. */
const FORBIDDEN = ["amazonaws", "akia", "://", "us-east-1", "upstash", "cloudflarestorage", "/tmp/", "customer", ".pdf", "bearer "];

/** A provider that serves each stage-key "path" from the committed fixture files. */
function provider(files: Record<string, string>): ReleaseAuditProvider {
  return {
    now: () => "2026-07-04T00:00:00.000Z",
    readStdin: async () => "",
    readFile: async (path: string) => {
      const file = files[path];
      if (file === undefined) throw new Error("enoent");
      return readFileSync(join(DIR, file), "utf8");
    },
  };
}

/** Audit a baseline fixture file against a current fixture file (pair mode). */
function audit(baseline: string, current: string, over = {}) {
  return runReleaseAudit(pairArgs(over), provider({ baseline, current }));
}

describe("release-audit example fixtures — documented verdicts", () => {
  it("baseline pass vs an equal current → pass (exit 0)", async () => {
    const run = await audit("baseline-pass.json", "current-pass.json");
    expect(run.exitCode).toBe(0);
    expect(run.result.rollup.verdict).toBe("pass");
  });

  it("a softened current → warn (exit 3); --allow-warn-regression accepts it (exit 0)", async () => {
    const warn = await audit("baseline-pass.json", "current-warn.json");
    expect(warn.exitCode).toBe(3);
    expect(warn.result.rollup.verdict).toBe("warn");

    const accepted = await audit("baseline-pass.json", "current-warn.json", { allowWarnRegression: true });
    expect(accepted.exitCode).toBe(0);
  });

  it("a failed current → fail (exit 4, blocking regression)", async () => {
    const run = await audit("baseline-pass.json", "current-fail.json");
    expect(run.exitCode).toBe(4);
    expect(run.result.rollup.verdict).toBe("fail");
    expect(run.result.rollup.drivers).toContain("verdict-worsened");
  });

  it("a tampered current fails closed (exit 4, bundle-tampered)", async () => {
    const run = await audit("baseline-pass.json", "current-tampered.json");
    expect(run.exitCode).toBe(4);
    expect(run.result.rollup.drivers).toContain("bundle-tampered");
  });

  it("an unreadable current → unknown (exit 2), never a fabricated pass", async () => {
    const run = await audit("baseline-pass.json", "not-a-bundle.json");
    expect(run.exitCode).toBe(2);
    expect(run.result.rollup.verdict).toBe("unknown");
  });
});

describe("release-audit example fixtures — content-free", () => {
  it("renders every documented comparison content-free in json and text", async () => {
    const cases: Array<[string, string]> = [
      ["baseline-pass.json", "current-pass.json"],
      ["baseline-pass.json", "current-warn.json"],
      ["baseline-pass.json", "current-fail.json"],
      ["baseline-pass.json", "current-tampered.json"],
      ["baseline-pass.json", "not-a-bundle.json"],
    ];
    for (const [baseline, current] of cases) {
      for (const format of ["json", "text"] as const) {
        const run = await audit(baseline, current, { format });
        for (const bad of FORBIDDEN) {
          expect(run.output.toLowerCase(), `${baseline} vs ${current} (${format}): ${bad}`).not.toContain(
            bad.toLowerCase(),
          );
        }
      }
    }
  });

  it("every committed .json fixture is valid JSON and free of locator tokens", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(DIR, f), "utf8");
      expect(() => JSON.parse(text), f).not.toThrow();
      for (const bad of FORBIDDEN) expect(text.toLowerCase(), f).not.toContain(bad.toLowerCase());
    }
  });
});

describe("release-audit example docs", () => {
  it("README lists every committed bundle fixture (no silent gap)", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) expect(readme, f).toContain(f);
  });

  it("the CI workflow fixture runs worker:release-audit and asserts fail-closed exits", () => {
    const yml = readFileSync(CI, "utf8");
    expect(yml).toContain("worker:release-audit");
    expect(yml).toContain("--baseline=");
    expect(yml).toContain("--current=");
    expect(yml).toContain('test "$code" -eq 4'); // a blocking regression / tampered bundle fails closed
    expect(yml).toContain('test "$code" -eq 1'); // a misused CLI fails closed
    for (const bad of FORBIDDEN) expect(yml.toLowerCase(), `fixture: ${bad}`).not.toContain(bad.toLowerCase());
  });
});
