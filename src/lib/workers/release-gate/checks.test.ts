// @vitest-environment node
/**
 * Catalog-integrity tests for the release readiness gate (Phase 46).
 *
 * The catalog is the load-bearing "what to run" table, so these tests pin its shape (ids match the
 * bounded {@link RELEASE_CHECK_IDS}, exits/severities are sane, exactly the engine check is advisory)
 * AND prove that every committed fixture a deterministic check runs over actually exists — so a
 * renamed or deleted fixture is caught here, not at gate runtime.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_CHECKS } from "./checks";
import { RELEASE_CHECK_IDS } from "./types";

describe("release-gate check catalog", () => {
  it("covers exactly the bounded check ids, in order, with no duplicates", () => {
    expect(RELEASE_CHECKS.map((c) => c.id)).toEqual([...RELEASE_CHECK_IDS]);
    expect(new Set(RELEASE_CHECKS.map((c) => c.id)).size).toBe(
      RELEASE_CHECKS.length,
    );
  });

  it("every check has a sane expected exit and a bounded severity", () => {
    for (const c of RELEASE_CHECKS) {
      expect(c.expectedExit).toBeGreaterThanOrEqual(0);
      expect(c.expectedExit).toBeLessThanOrEqual(4);
      expect(["fail", "warn"]).toContain(c.severity);
      expect(c.script.length).toBeGreaterThan(0);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.passSummary.length).toBeGreaterThan(0);
      expect(c.remediation.length).toBeGreaterThan(0);
    }
  });

  it("only the native-engine preflight is advisory (warn); everything else blocks", () => {
    const advisory = RELEASE_CHECKS.filter((c) => c.severity === "warn").map(
      (c) => c.id,
    );
    expect(advisory).toEqual(["worker-engines"]);
  });

  it("runs only known worker/pnpm scripts (no arbitrary command)", () => {
    const allowed = new Set([
      "deploy:examples:check",
      "worker:smoke",
      "worker:engines",
      "worker:ops-check",
      "worker:ops-bundle",
      "worker:cleanup-pipeline",
      "worker:daemon",
    ]);
    for (const c of RELEASE_CHECKS) expect(allowed.has(c.script)).toBe(true);
  });

  it("every fixture path a check runs over exists on disk", () => {
    const root = process.cwd();
    const paths = RELEASE_CHECKS.flatMap((c) => c.args)
      .map((a) => {
        const eq = a.indexOf("=");
        return eq === -1 ? a : a.slice(eq + 1);
      })
      .filter((v) => v.includes("/")); // path-shaped values only (skip flags/epochs)
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths)
      expect(existsSync(join(root, p)), `missing fixture: ${p}`).toBe(true);
  });
});
