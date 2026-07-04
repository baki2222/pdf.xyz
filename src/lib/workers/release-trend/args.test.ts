/**
 * Unit proofs for the release-trend argv parser (Phase 53): it validates flags, requires exactly one input
 * mode, parses the bounded policy knobs, rejects malformed inputs, and never reads I/O.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_REPORTS, parseReleaseTrendArgs, type ReleaseTrendArgs } from "./args";

/** Parse and assert a successful run, returning the args. */
function run(argv: string[]): ReleaseTrendArgs {
  const parsed = parseReleaseTrendArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

/** Parse and assert a usage error, returning the message. */
function err(argv: string[]): string {
  const parsed = parseReleaseTrendArgs(argv);
  if (parsed.ok) throw new Error(`expected error, got ${JSON.stringify(parsed)}`);
  return parsed.message;
}

describe("parseReleaseTrendArgs — help + basics", () => {
  it("-h / --help short-circuits to help", () => {
    expect(parseReleaseTrendArgs(["--help"])).toEqual({ ok: true, kind: "help" });
    expect(parseReleaseTrendArgs(["-h"])).toEqual({ ok: true, kind: "help" });
    // help short-circuits as soon as it is seen (before a later would-be-invalid token is reached)
    expect(parseReleaseTrendArgs(["-h", "--nope"])).toEqual({ ok: true, kind: "help" });
  });

  it("defaults: json, pretty, default window, zero thresholds, not require-latest-ready", () => {
    const args = run(["--report=a"]);
    expect(args).toMatchObject({
      format: "json",
      pretty: true,
      stdin: false,
      maxReports: DEFAULT_MAX_REPORTS,
      maxHoldWarning: 0,
      maxHoldFail: 0,
      requireLatestReady: false,
      reportPaths: ["a"],
    });
    expect(args.outputPath).toBeUndefined();
  });
});

describe("parseReleaseTrendArgs — inputs", () => {
  it("collects repeated --report and --file into one chronological list (order preserved)", () => {
    expect(run(["--report=a", "--report=b", "--file=c"]).reportPaths).toEqual(["a", "b", "c"]);
    expect(run(["--report", "a", "--file", "b"]).reportPaths).toEqual(["a", "b"]);
  });

  it("--stdin selects stdin mode", () => {
    const args = run(["--stdin"]);
    expect(args.stdin).toBe(true);
    expect(args.reportPaths).toBeUndefined();
  });

  it("requires at least one report input", () => {
    expect(err([])).toMatch(/supply at least one report/i);
    expect(err(["--json"])).toMatch(/supply at least one report/i);
  });

  it("rejects --stdin combined with --report / --file", () => {
    expect(err(["--stdin", "--report=a"])).toMatch(/--stdin cannot be combined/i);
    expect(err(["--file=a", "--stdin"])).toMatch(/--stdin cannot be combined/i);
  });
});

describe("parseReleaseTrendArgs — policy knobs", () => {
  it("parses the bounded integer knobs", () => {
    const args = run(["--report=a", "--max-reports=5", "--max-hold-warning=2", "--max-hold-fail=1"]);
    expect(args).toMatchObject({ maxReports: 5, maxHoldWarning: 2, maxHoldFail: 1 });
  });

  it("accepts --require-latest-ready", () => {
    expect(run(["--report=a", "--require-latest-ready"]).requireLatestReady).toBe(true);
  });

  it("rejects a non-negative-integer knob value", () => {
    expect(err(["--report=a", "--max-reports=-1"])).toMatch(/--max-reports requires a non-negative integer/i);
    expect(err(["--report=a", "--max-hold-warning=x"])).toMatch(/non-negative integer/i);
    expect(err(["--report=a", "--max-hold-fail=1.5"])).toMatch(/non-negative integer/i);
  });

  it("accepts a zero window / threshold (a bounded, explicit choice)", () => {
    expect(run(["--report=a", "--max-reports=0"]).maxReports).toBe(0);
    expect(run(["--report=a", "--max-hold-fail=0"]).maxHoldFail).toBe(0);
  });
});

describe("parseReleaseTrendArgs — format + output + errors", () => {
  it("selects a format and rejects a conflict", () => {
    expect(run(["--report=a", "--text"]).format).toBe("text");
    expect(err(["--report=a", "--json", "--text"])).toMatch(/conflicting formats/i);
  });

  it("takes --output and rejects a duplicate / stdin sentinel", () => {
    expect(run(["--report=a", "--output=out.json"]).outputPath).toBe("out.json");
    expect(err(["--report=a", "--output=out.json", "--output=b.json"])).toMatch(/duplicate --output/i);
    expect(err(["--report=a", "--output=-"])).toMatch(/--output cannot be stdin/i);
  });

  it("rejects an unknown option and a missing value", () => {
    expect(err(["--report=a", "--nope"])).toMatch(/unknown option/i);
    expect(err(["--report"])).toMatch(/--report requires a value/i);
    expect(err(["--report=a", "--output"])).toMatch(/--output requires a value/i);
  });
});
