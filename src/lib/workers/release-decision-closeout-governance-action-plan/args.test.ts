import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceActionPlanArgs } from "./args";

/** Narrow to the `run` branch, or fail loudly. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutGovernanceActionPlanArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutGovernanceActionPlanArgs", () => {
  it("requires exactly one input mode (empty invocation is a usage error)", () => {
    const parsed = parseReleaseDecisionCloseoutGovernanceActionPlanArgs([]);
    expect(parsed.ok).toBe(false);
  });

  it("accepts --trend and defaults to pretty json, no strict-watch", () => {
    const args = run(["--trend=t.json"]);
    expect(args).toMatchObject({ format: "json", pretty: true, stdin: false, strictWatch: false, trendPath: "t.json" });
    expect(args.outputPath).toBeUndefined();
  });

  it("accepts --file as an alias for --trend", () => {
    expect(run(["--file=t.json"]).trendPath).toBe("t.json");
  });

  it("accepts a space-separated value", () => {
    expect(run(["--trend", "t.json"]).trendPath).toBe("t.json");
  });

  it("accepts --stdin as an input mode", () => {
    expect(run(["--stdin"]).stdin).toBe(true);
  });

  it("rejects --stdin combined with --trend", () => {
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--stdin", "--trend=t.json"]).ok).toBe(false);
  });

  it("rejects two trend inputs", () => {
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--trend=a.json", "--file=b.json"]).ok).toBe(false);
  });

  it("parses --strict-watch, --text, --output", () => {
    const args = run(["--trend=t.json", "--strict-watch", "--text", "--output=o.json"]);
    expect(args).toMatchObject({ strictWatch: true, format: "text", outputPath: "o.json" });
  });

  it("rejects --output=- (stdin sentinel) and a duplicate --output", () => {
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--trend=t.json", "--output=-"]).ok).toBe(false);
    expect(
      parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--trend=t.json", "--output=a", "--output=b"]).ok,
    ).toBe(false);
  });

  it("rejects conflicting formats and unknown options", () => {
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--trend=t.json", "--json", "--text"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--trend=t.json", "--nope"]).ok).toBe(false);
  });

  it("rejects a value flag with no value", () => {
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--trend"]).ok).toBe(false);
  });

  it("treats -h / --help as help", () => {
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--help"])).toEqual({ ok: true, kind: "help" });
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["-h"])).toEqual({ ok: true, kind: "help" });
  });

  it("does not accept a --max-actions knob (not part of this CLI's surface)", () => {
    // The checklist is small + bounded by construction; there is no cap flag.
    expect(parseReleaseDecisionCloseoutGovernanceActionPlanArgs(["--trend=t.json", "--max-actions=1"]).ok).toBe(false);
  });
});
