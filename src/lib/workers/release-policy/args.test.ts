import { describe, expect, it } from "vitest";
import { parseReleasePolicyArgs, RELEASE_POLICY_USAGE } from "./args";

/** Parse and require a `run` result (fails the test if it was help / an error). */
function run(argv: string[]) {
  const parsed = parseReleasePolicyArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleasePolicyArgs", () => {
  it("defaults to json with no assertions and reads a release-index on stdin", () => {
    const args = run([]);
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
    expect(args.indexPath).toBeUndefined();
    expect(args.artifactPaths).toEqual([]);
    expect(args.policy).toEqual({
      requireClean: false,
      requireLatestOk: false,
      maxInvalid: null,
      maxFail: null,
      minArtifacts: null,
      maxArtifacts: null,
      maxAgeBucket: null,
      maxWarn: null,
      maxSkipped: null,
      forbidOverRetention: false,
    });
  });

  it("accepts --index (inline and spaced)", () => {
    expect(run(["--index=a.json"]).indexPath).toBe("a.json");
    expect(run(["--index", "b.json"]).indexPath).toBe("b.json");
  });

  it("accepts repeated --artifact", () => {
    expect(run(["--artifact=a.json", "--artifact=b.json"]).artifactPaths).toEqual(["a.json", "b.json"]);
  });

  it("parses every boolean assertion", () => {
    const args = run(["--require-clean", "--require-latest-ok", "--forbid-over-retention"]);
    expect(args.policy.requireClean).toBe(true);
    expect(args.policy.requireLatestOk).toBe(true);
    expect(args.policy.forbidOverRetention).toBe(true);
  });

  it("parses every numeric bound as a non-negative integer", () => {
    const args = run([
      "--max-invalid=0",
      "--max-fail=1",
      "--min-artifacts=2",
      "--max-artifacts=20",
      "--max-warn=3",
      "--max-skipped=4",
    ]);
    expect(args.policy).toMatchObject({
      maxInvalid: 0,
      maxFail: 1,
      minArtifacts: 2,
      maxArtifacts: 20,
      maxWarn: 3,
      maxSkipped: 4,
    });
  });

  it("accepts a valid --max-age-bucket and rejects future/unknown/garbage", () => {
    expect(run(["--max-age-bucket=7-30d"]).policy.maxAgeBucket).toBe("7-30d");
    for (const bad of ["future", "unknown", "10y", ""]) {
      expect(parseReleasePolicyArgs([`--max-age-bucket=${bad}`]).ok, bad).toBe(false);
    }
  });

  it("selects text and honors --pretty/--output", () => {
    const args = run(["--text", "--output=out.txt"]);
    expect(args.format).toBe("text");
    expect(args.outputPath).toBe("out.txt");
  });

  it("returns help for -h/--help", () => {
    for (const flag of ["-h", "--help"]) {
      const parsed = parseReleasePolicyArgs([flag]);
      expect(parsed.ok && parsed.kind === "help").toBe(true);
    }
  });

  it("rejects an unknown option, a conflicting format, and a missing value", () => {
    expect(parseReleasePolicyArgs(["--nope"]).ok).toBe(false);
    expect(parseReleasePolicyArgs(["--json", "--text"]).ok).toBe(false);
    expect(parseReleasePolicyArgs(["--index"]).ok).toBe(false);
    expect(parseReleasePolicyArgs(["--max-fail"]).ok).toBe(false);
  });

  it("rejects a non-numeric / negative bound", () => {
    for (const bad of ["--max-fail=abc", "--min-artifacts=-1", "--max-artifacts=1.5", "--max-warn= "]) {
      expect(parseReleasePolicyArgs([bad]).ok, bad).toBe(false);
    }
  });

  it("rejects duplicate single-value flags but allows repeated --artifact", () => {
    expect(parseReleasePolicyArgs(["--index=a", "--index=b"]).ok).toBe(false);
    expect(parseReleasePolicyArgs(["--max-fail=1", "--max-fail=2"]).ok).toBe(false);
    expect(parseReleasePolicyArgs(["--output=a", "--output=b"]).ok).toBe(false);
    expect(parseReleasePolicyArgs(["--max-age-bucket=1-7d", "--max-age-bucket=7-30d"]).ok).toBe(false);
    expect(parseReleasePolicyArgs(["--artifact=a", "--artifact=b"]).ok).toBe(true);
  });

  it("rejects both --index and --artifact together", () => {
    const parsed = parseReleasePolicyArgs(["--index=a.json", "--artifact=b.json"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/not both/i);
  });

  it("rejects a contradictory min>max band", () => {
    const parsed = parseReleasePolicyArgs(["--min-artifacts=5", "--max-artifacts=2"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/contradictory/i);
    // equal is fine
    expect(parseReleasePolicyArgs(["--min-artifacts=2", "--max-artifacts=2"]).ok).toBe(true);
  });

  it("never echoes an input path in an error message", () => {
    const parsed = parseReleasePolicyArgs(["--index=/secret/local/path.json", "--artifact=/x.json"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).not.toContain("/secret/local/path.json");
  });

  it("the usage text lists the exit-code ladder and the age buckets", () => {
    expect(RELEASE_POLICY_USAGE).toMatch(/0\s+PASS/);
    expect(RELEASE_POLICY_USAGE).toMatch(/4\s+FAIL/);
    expect(RELEASE_POLICY_USAGE).toContain("30-90d");
  });
});
