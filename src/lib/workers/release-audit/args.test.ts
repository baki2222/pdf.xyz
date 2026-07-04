import { describe, expect, it } from "vitest";
import { parseReleaseAuditArgs, type ReleaseAuditArgs } from "./args";

/** Parse argv and return the validated args, failing the test if the parse did not succeed as a run. */
function run(argv: string[]): ReleaseAuditArgs {
  const parsed = parseReleaseAuditArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

/** Parse argv and return the usage error message, failing the test if it did not error. */
function err(argv: string[]): string {
  const parsed = parseReleaseAuditArgs(argv);
  if (parsed.ok) throw new Error(`expected error, got ${JSON.stringify(parsed)}`);
  return parsed.message;
}

describe("release-audit args — pair mode", () => {
  it("parses --baseline + --current (defaults: json, pretty, strict policy)", () => {
    const args = run(["--baseline=b.json", "--current=c.json"]);
    expect(args.mode).toBe("pair");
    expect(args.baselinePath).toBe("b.json");
    expect(args.currentPath).toBe("c.json");
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
    expect(args.allowWarnRegression).toBe(false);
    expect(args.maxNewWarnings).toBe(0);
    expect(args.failOnUnknown).toBe(false);
    expect(args.bundlePaths).toBeUndefined();
    expect(args.stdin).toBe(false);
  });

  it("accepts space-separated flag values", () => {
    const args = run(["--baseline", "b.json", "--current", "c.json"]);
    expect(args.baselinePath).toBe("b.json");
    expect(args.currentPath).toBe("c.json");
  });

  it("pair mode requires BOTH --baseline and --current", () => {
    expect(err(["--baseline=b.json"])).toMatch(/BOTH --baseline and --current/);
    expect(err(["--current=c.json"])).toMatch(/BOTH --baseline and --current/);
  });

  it("captures the policy knobs + output + text format", () => {
    const args = run([
      "--baseline=b.json",
      "--current=c.json",
      "--text",
      "--output=out.json",
      "--allow-warn-regression",
      "--max-new-warnings=3",
      "--fail-on-unknown",
    ]);
    expect(args.format).toBe("text");
    expect(args.outputPath).toBe("out.json");
    expect(args.allowWarnRegression).toBe(true);
    expect(args.maxNewWarnings).toBe(3);
    expect(args.failOnUnknown).toBe(true);
  });
});

describe("release-audit args — history mode", () => {
  it("parses repeated --bundle into a chronological list", () => {
    const args = run(["--bundle=a.json", "--bundle=b.json", "--bundle=c.json"]);
    expect(args.mode).toBe("history");
    expect(args.bundlePaths).toEqual(["a.json", "b.json", "c.json"]);
    expect(args.baselinePath).toBeUndefined();
    expect(args.currentPath).toBeUndefined();
  });

  it("parses --stdin", () => {
    const args = run(["--stdin"]);
    expect(args.mode).toBe("history");
    expect(args.stdin).toBe(true);
  });
});

describe("release-audit args — errors + help", () => {
  it("rejects mixing pair and history modes", () => {
    expect(err(["--baseline=b.json", "--current=c.json", "--bundle=a.json"])).toMatch(/one input mode/i);
    expect(err(["--baseline=b.json", "--current=c.json", "--stdin"])).toMatch(/one input mode/i);
  });

  it("rejects --stdin combined with --bundle", () => {
    expect(err(["--stdin", "--bundle=a.json"])).toMatch(/--stdin cannot be combined with --bundle/);
  });

  it("requires an input mode", () => {
    expect(err(["--json"])).toMatch(/Supply an input/);
  });

  it("rejects conflicting formats", () => {
    expect(err(["--baseline=b.json", "--current=c.json", "--json", "--text"])).toMatch(/Conflicting formats/);
  });

  it("rejects duplicate single-value flags", () => {
    expect(err(["--baseline=b.json", "--baseline=b2.json", "--current=c.json"])).toMatch(/Duplicate --baseline/);
    expect(err(["--baseline=b.json", "--current=c.json", "--output=x", "--output=y"])).toMatch(/Duplicate --output/);
  });

  it("rejects an unknown option", () => {
    expect(err(["--baseline=b.json", "--current=c.json", "--nope"])).toMatch(/Unknown option: --nope/);
  });

  it("rejects a value flag with no value", () => {
    expect(err(["--baseline="])).toMatch(/--baseline requires a value/);
  });

  it("rejects a non-integer / negative --max-new-warnings", () => {
    expect(err(["--stdin", "--max-new-warnings=-1"])).toMatch(/non-negative integer/);
    expect(err(["--stdin", "--max-new-warnings=abc"])).toMatch(/non-negative integer/);
  });

  it("returns help for -h / --help", () => {
    for (const flag of ["-h", "--help"]) {
      const parsed = parseReleaseAuditArgs([flag]);
      expect(parsed.ok && parsed.kind === "help").toBe(true);
    }
  });
});
