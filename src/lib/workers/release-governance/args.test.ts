import { describe, expect, it } from "vitest";
import { RELEASE_GOVERNANCE_USAGE, parseReleaseGovernanceArgs } from "./args";

/** Convenience: parse and assert a successful run, returning the validated args. */
function run(argv: string[]) {
  const parsed = parseReleaseGovernanceArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseGovernanceArgs — inputs", () => {
  it("requires at least one document input", () => {
    const parsed = parseReleaseGovernanceArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/at least one document/i);
  });

  it("accepts --trend alone (the primary input)", () => {
    expect(run(["--trend=t.json"]).trendPath).toBe("t.json");
  });

  it("accepts --report / --audit without a trend (a run to be resolved by the fold)", () => {
    const a = run(["--report=r.json", "--audit=a.json"]);
    expect(a.reportPath).toBe("r.json");
    expect(a.auditPath).toBe("a.json");
    expect(a.trendPath).toBeUndefined();
  });

  it("accepts inline and space-separated values", () => {
    expect(run(["--trend", "t.json"]).trendPath).toBe("t.json");
    expect(run(["--trend=t.json"]).trendPath).toBe("t.json");
  });

  it("accepts a `-` stdin sentinel for any single input", () => {
    expect(run(["--trend=-"]).trendPath).toBe("-");
    expect(run(["--report=-"]).reportPath).toBe("-");
    expect(run(["--audit=-"]).auditPath).toBe("-");
  });

  it("rejects two stdin inputs", () => {
    const parsed = parseReleaseGovernanceArgs(["--trend=-", "--report=-"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/one document may be read from stdin/i);
  });

  it("rejects a duplicated single-value input", () => {
    for (const flag of ["--trend", "--report", "--audit"]) {
      const parsed = parseReleaseGovernanceArgs([`${flag}=a.json`, `${flag}=b.json`]);
      expect(parsed.ok, flag).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(/duplicate/i);
    }
  });

  it("rejects a missing value for a value flag", () => {
    const parsed = parseReleaseGovernanceArgs(["--trend"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/requires a value/i);
  });
});

describe("parseReleaseGovernanceArgs — policy + format + output", () => {
  it("defaults are conservative (json, pretty, no requirements, no strict-watch)", () => {
    const a = run(["--trend=t.json"]);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
    expect(a.requireReport).toBe(false);
    expect(a.requireAudit).toBe(false);
    expect(a.strictWatch).toBe(false);
    expect(a.outputPath).toBeUndefined();
  });

  it("parses the policy knobs", () => {
    const a = run(["--trend=t.json", "--require-report", "--require-audit", "--strict-watch"]);
    expect(a.requireReport).toBe(true);
    expect(a.requireAudit).toBe(true);
    expect(a.strictWatch).toBe(true);
  });

  it("selects --text and rejects a conflicting format", () => {
    expect(run(["--trend=t.json", "--text"]).format).toBe("text");
    const parsed = parseReleaseGovernanceArgs(["--trend=t.json", "--json", "--text"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/conflicting formats/i);
  });

  it("parses --output and rejects `--output=-` / a duplicate", () => {
    expect(run(["--trend=t.json", "--output=o.json"]).outputPath).toBe("o.json");
    expect(parseReleaseGovernanceArgs(["--trend=t.json", "--output=-"]).ok).toBe(false);
    expect(parseReleaseGovernanceArgs(["--trend=t.json", "--output=a", "--output=b"]).ok).toBe(false);
  });

  it("rejects an unknown option", () => {
    const parsed = parseReleaseGovernanceArgs(["--trend=t.json", "--nope"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/unknown option/i);
  });

  it("-h / --help short-circuits to help", () => {
    for (const flag of ["-h", "--help"]) {
      const parsed = parseReleaseGovernanceArgs([flag]);
      expect(parsed.ok && parsed.kind).toBe("help");
    }
  });

  it("the usage text is content-free and documents the exit ladder", () => {
    expect(RELEASE_GOVERNANCE_USAGE).toMatch(/HEALTHY/);
    expect(RELEASE_GOVERNANCE_USAGE).toMatch(/BLOCKED/);
    expect(RELEASE_GOVERNANCE_USAGE).toMatch(/governance bundling over evidence/i);
    expect(RELEASE_GOVERNANCE_USAGE).toMatch(/not signing/i);
  });
});
