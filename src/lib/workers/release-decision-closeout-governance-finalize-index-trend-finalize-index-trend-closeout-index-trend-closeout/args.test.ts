import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutArgs } from "./args";

/** Parse and assert a run result, returning the validated args. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutArgs", () => {
  it("requires exactly one primary input mode", () => {
    const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/exactly one receipt/);
  });

  it("accepts --receipt and defaults format/pretty", () => {
    const args = run(["--receipt=r.json"]);
    expect(args.receiptPath).toBe("r.json");
    expect(args.stdin).toBe(false);
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
  });

  it("treats --file as an alias for --receipt (space-separated value too)", () => {
    expect(run(["--file=r.json"]).receiptPath).toBe("r.json");
    expect(run(["--receipt", "r.json"]).receiptPath).toBe("r.json");
  });

  it("accepts --stdin as the primary mode", () => {
    const args = run(["--stdin"]);
    expect(args.stdin).toBe(true);
    expect(args.receiptPath).toBeUndefined();
  });

  it("rejects --stdin combined with --receipt / --file", () => {
    const a = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutArgs([
      "--stdin",
      "--receipt=r.json",
    ]);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.message).toMatch(/--stdin cannot be combined/);
  });

  it("carries the three optional related-record paths (plan / trend / index)", () => {
    const args = run(["--receipt=r.json", "--plan=p.json", "--trend=t.json", "--index=i.json"]);
    expect(args.planPath).toBe("p.json");
    expect(args.trendPath).toBe("t.json");
    expect(args.indexPath).toBe("i.json");
  });

  it("carries the three require flags and strict-open (default false)", () => {
    const base = run(["--receipt=r.json"]);
    expect([base.requirePlan, base.requireTrend, base.requireIndex, base.strictOpen]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const args = run(["--receipt=r.json", "--require-plan", "--require-trend", "--require-index", "--strict-open"]);
    expect([args.requirePlan, args.requireTrend, args.requireIndex, args.strictOpen]).toEqual([true, true, true, true]);
  });

  it("a --require without the record is still valid args (a run-time coverage gap, not a usage error)", () => {
    const args = run(["--receipt=r.json", "--require-plan"]);
    expect(args.requirePlan).toBe(true);
    expect(args.planPath).toBeUndefined();
  });

  it("selects --text and honors --output / --pretty", () => {
    const args = run(["--stdin", "--text", "--output=out.txt", "--pretty"]);
    expect(args.format).toBe("text");
    expect(args.outputPath).toBe("out.txt");
    expect(args.pretty).toBe(true);
  });

  it("rejects conflicting formats, duplicate records, duplicate output, empty values, and unknown flags", () => {
    for (const [argv, re] of [
      [["--stdin", "--json", "--text"], /Conflicting formats/],
      [["--receipt=a", "--receipt=b"], /only once/],
      [["--stdin", "--plan=a", "--plan=b"], /Duplicate --plan/],
      [["--stdin", "--trend=a", "--trend=b"], /Duplicate --trend/],
      [["--stdin", "--index=a", "--index=b"], /Duplicate --index/],
      [["--stdin", "--output=a", "--output=b"], /Duplicate --output/],
      [["--stdin", "--output="], /--output requires a value/],
      [["--stdin", "--output=-"], /--output cannot be stdin/],
      [["--stdin", "--nope"], /Unknown option: --nope/],
    ] as const) {
      const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutArgs([...argv]);
      expect(parsed.ok, argv.join(" ")).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(re);
    }
  });

  it("returns help for -h / --help", () => {
    for (const flag of ["-h", "--help"]) {
      const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutArgs([flag]);
      expect(parsed.ok && parsed.kind === "help").toBe(true);
    }
  });
});
