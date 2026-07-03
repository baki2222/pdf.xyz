import { describe, expect, it } from "vitest";
import { parseReleaseIndexArgs } from "./args";

/** Assert a run parse and return its args. */
function run(argv: string[]) {
  const r = parseReleaseIndexArgs(argv);
  if (!r.ok || r.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.args;
}

describe("parseReleaseIndexArgs", () => {
  it("defaults to json/pretty with no inputs (stdin path)", () => {
    const a = run([]);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
    expect(a.artifactPaths).toEqual([]);
    expect(a.maxArtifacts).toBeUndefined();
    expect(a.maxAgeDays).toBeUndefined();
  });

  it("collects repeated --artifact and --file in order (never a duplicate error)", () => {
    const a = run(["--artifact=a.json", "--file", "b.json", "--artifact", "c.json"]);
    expect(a.artifactPaths).toEqual(["a.json", "b.json", "c.json"]);
  });

  it("parses retention bounds as non-negative integers", () => {
    const a = run(["--max-artifacts=20", "--max-age-days", "90"]);
    expect(a.maxArtifacts).toBe(20);
    expect(a.maxAgeDays).toBe(90);
  });

  it("accepts zero retention bounds", () => {
    const a = run(["--max-artifacts=0", "--max-age-days=0"]);
    expect(a.maxArtifacts).toBe(0);
    expect(a.maxAgeDays).toBe(0);
  });

  it("selects text format and carries an output path", () => {
    const a = run(["--text", "--output=/tmp/x", "--artifact=a.json"]);
    expect(a.format).toBe("text");
    expect(a.outputPath).toBe("/tmp/x");
  });

  it("returns help for -h/--help", () => {
    for (const flag of ["-h", "--help"]) {
      const r = parseReleaseIndexArgs([flag]);
      expect(r.ok && r.kind === "help").toBe(true);
    }
  });

  it("rejects a non-numeric or negative retention bound as a usage error", () => {
    for (const bad of ["--max-artifacts=abc", "--max-artifacts=-1", "--max-age-days=1.5", "--max-age-days=x"]) {
      const r = parseReleaseIndexArgs([bad]);
      expect(r.ok, bad).toBe(false);
    }
  });

  it("rejects a duplicate single-value flag", () => {
    expect(parseReleaseIndexArgs(["--output=a", "--output=b"]).ok).toBe(false);
    expect(parseReleaseIndexArgs(["--max-artifacts=1", "--max-artifacts=2"]).ok).toBe(false);
    expect(parseReleaseIndexArgs(["--max-age-days=1", "--max-age-days=2"]).ok).toBe(false);
  });

  it("rejects conflicting formats and unknown options", () => {
    expect(parseReleaseIndexArgs(["--json", "--text"]).ok).toBe(false);
    expect(parseReleaseIndexArgs(["--nope"]).ok).toBe(false);
  });

  it("rejects a value flag with no value", () => {
    expect(parseReleaseIndexArgs(["--artifact"]).ok).toBe(false);
    expect(parseReleaseIndexArgs(["--max-artifacts="]).ok).toBe(false);
  });

  it("--json and --text are idempotent when repeated with the same value", () => {
    expect(run(["--json", "--json"]).format).toBe("json");
  });
});
