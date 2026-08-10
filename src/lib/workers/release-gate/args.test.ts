/**
 * Argument-parser tests for the release readiness gate CLI (Phase 46). Pure and deterministic — no
 * argv, environment, or I/O.
 */

import { describe, expect, it } from "vitest";
import { parseReleaseGateArgs } from "./args";

/** Narrow to the `run` variant (or fail loudly). */
function run(argv: string[]) {
  const r = parseReleaseGateArgs(argv);
  if (!r.ok || r.kind !== "run")
    throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.args;
}

describe("parseReleaseGateArgs", () => {
  it("defaults to pretty JSON, no scope", () => {
    const a = run([]);
    expect(a).toMatchObject({ format: "json", pretty: true, skip: [] });
    expect(a.only).toBeUndefined();
    expect(a.outputPath).toBeUndefined();
  });

  it("accepts --text and --output", () => {
    expect(run(["--text"]).format).toBe("text");
    expect(run(["--output=/tmp/x.json"]).outputPath).toBe("/tmp/x.json");
    expect(run(["--output", "/tmp/y.json"]).outputPath).toBe("/tmp/y.json");
  });

  it("shows help for -h/--help", () => {
    for (const flag of ["-h", "--help"]) {
      const r = parseReleaseGateArgs([flag]);
      expect(r.ok && r.kind === "help").toBe(true);
    }
  });

  it("parses --skip / --only into de-duplicated, catalog-ordered bounded ids", () => {
    expect(run(["--skip=worker-smoke,worker-engines"]).skip).toEqual([
      "worker-smoke",
      "worker-engines",
    ]);
    // Order is catalog order regardless of how typed; duplicates collapse.
    expect(
      run(["--only=ops-check-critical,ops-check-healthy,ops-check-healthy"])
        .only,
    ).toEqual(["ops-check-healthy", "ops-check-critical"]);
  });

  it("rejects an unknown check id in a scope flag", () => {
    const r = parseReleaseGateArgs(["--skip=not-a-check"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Unknown check id/);
  });

  it("rejects combining --skip and --only", () => {
    expect(
      parseReleaseGateArgs(["--skip=worker-smoke", "--only=worker-engines"]).ok,
    ).toBe(false);
    expect(
      parseReleaseGateArgs(["--only=worker-engines", "--skip=worker-smoke"]).ok,
    ).toBe(false);
  });

  it("rejects conflicting formats, unknown options, empty scope, and duplicates", () => {
    expect(parseReleaseGateArgs(["--json", "--text"]).ok).toBe(false);
    expect(parseReleaseGateArgs(["--nope"]).ok).toBe(false);
    expect(parseReleaseGateArgs(["--skip="]).ok).toBe(false);
    expect(
      parseReleaseGateArgs(["--skip=worker-smoke", "--skip=worker-engines"]).ok,
    ).toBe(false);
    expect(parseReleaseGateArgs(["--output=/a", "--output=/b"]).ok).toBe(false);
  });
});
