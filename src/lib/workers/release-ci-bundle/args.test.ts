import { describe, expect, it } from "vitest";
import { parseReleaseCiBundleArgs } from "./args";

/** Helper: parse and assert it succeeded to a run, returning the args. */
function run(argv: string[]) {
  const r = parseReleaseCiBundleArgs(argv);
  if (!r.ok || r.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.args;
}

describe("release-ci-bundle args", () => {
  it("defaults to json, pretty, no paths but requires a stage", () => {
    const a = run(["--release-policy=policy.json"]);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
    expect(a.policyPath).toBe("policy.json");
    expect(a.gatePath).toBeUndefined();
    expect(a.outputPath).toBeUndefined();
  });

  it("accepts all four stage flags (inline and spaced)", () => {
    const a = run([
      "--release-gate=g.json",
      "--release-artifact",
      "a.json",
      "--release-index=i.json",
      "--release-policy",
      "p.json",
    ]);
    expect(a.gatePath).toBe("g.json");
    expect(a.artifactPath).toBe("a.json");
    expect(a.indexPath).toBe("i.json");
    expect(a.policyPath).toBe("p.json");
  });

  it("--text selects the text format; --output sets the destination", () => {
    const a = run(["--release-index=i.json", "--text", "--output=out.txt"]);
    expect(a.format).toBe("text");
    expect(a.outputPath).toBe("out.txt");
  });

  it("requires AT LEAST ONE stage (empty invocation is usage error)", () => {
    const r = parseReleaseCiBundleArgs([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/at least one stage/i);
  });

  it("requires at least one stage even with only options", () => {
    expect(parseReleaseCiBundleArgs(["--json", "--pretty"]).ok).toBe(false);
    expect(parseReleaseCiBundleArgs(["--output=x"]).ok).toBe(false);
  });

  it("-h/--help short-circuits to help", () => {
    for (const flag of ["-h", "--help"]) {
      const r = parseReleaseCiBundleArgs([flag]);
      expect(r.ok && r.kind === "help").toBe(true);
    }
  });

  it("rejects an unknown option", () => {
    const r = parseReleaseCiBundleArgs(["--release-index=i.json", "--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/unknown option/i);
  });

  it("rejects a duplicate single-value flag", () => {
    for (const flag of ["--release-gate", "--release-artifact", "--release-index", "--release-policy", "--output"]) {
      const r = parseReleaseCiBundleArgs([`${flag}=a`, `${flag}=b`]);
      expect(r.ok, flag).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/duplicate/i);
    }
  });

  it("rejects conflicting formats", () => {
    const r = parseReleaseCiBundleArgs(["--release-index=i.json", "--json", "--text"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/conflicting formats/i);
  });

  it("rejects a value flag with no value", () => {
    const r = parseReleaseCiBundleArgs(["--release-index"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/requires a value/i);
  });

  it("never echoes a supplied path in a usage error for an unknown flag", () => {
    const r = parseReleaseCiBundleArgs(["--release-policy=/tmp/secret/customer.json", "--bad"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain("/tmp/secret");
  });
});
