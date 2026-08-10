// @vitest-environment node
/**
 * The gate's fixture diet must stay on disk.
 *
 * TASK-17 deleted twelve sibling layers and their docs/examples trees while
 * keeping this gate, and the one trap the owner named was exactly this: a
 * deletion that silently removes a fixture one of the eleven checks
 * exercises would break the single kept tool while every other suite stays
 * green (the gate is invoked by an operator, not by CI). So this test pins
 * the diet mechanically: every fixture path a check passes to its
 * subprocess, and every script id it invokes, must exist — extracted from
 * `checks.ts` itself rather than restated, so a new check's inputs are
 * covered the day it is added and this list can never drift from the real
 * one.
 *
 * What it does not cover: whether the fixtures still PRODUCE the expected
 * exit codes — that is the gate's own job (`pnpm worker:release-gate`), and
 * an operator runs it before promoting. This test only guarantees the gate
 * cannot fail for the dumbest reason, a missing file.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_CHECKS } from "./checks";

const ROOT = process.cwd();

/** Fixture paths referenced by the checks' args (repo-relative tokens). */
function fixtureArgs(): string[] {
  return RELEASE_CHECKS.flatMap((check) =>
    check.args
      .map((arg) => /(?:^|=)(docs\/examples\/[^\s]+)$/.exec(arg)?.[1])
      .filter((p): p is string => Boolean(p)),
  );
}

describe("the release gate's inputs exist", () => {
  it("extracts a real diet from checks.ts, so an empty list cannot vacuous-pass", () => {
    expect(RELEASE_CHECKS.length).toBeGreaterThanOrEqual(11);
    expect(fixtureArgs().length).toBeGreaterThanOrEqual(8);
  });

  it("every fixture a check reads is on disk", () => {
    const missing = fixtureArgs().filter(
      (p) => !existsSync(path.join(ROOT, p)),
    );
    expect(
      missing,
      `these fixtures are read by release-gate checks and do not exist — the kept tool would fail on a missing file:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every script a check invokes is still a package.json script", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    const scripts = new Set(Object.keys(pkg.scripts ?? {}));
    const missing = RELEASE_CHECKS.map((c) => c.script).filter(
      (s) => !scripts.has(s),
    );
    expect(
      missing,
      `these scripts are invoked by release-gate checks and are not in package.json:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
