import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs } from "./args";

/** Narrow to the `run` branch, or fail loudly. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs", () => {
  it("requires exactly one input mode (empty invocation is a usage error)", () => {
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs([]).ok).toBe(false);
  });

  it("accepts --trend and defaults to pretty json, no strict, default max-actions", () => {
    const args = run(["--trend=t.json"]);
    expect(args).toMatchObject({
      format: "json",
      pretty: true,
      stdin: false,
      strict: false,
      maxActions: 8,
      trendPath: "t.json",
    });
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
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--stdin", "--trend=t.json"]).ok).toBe(
      false,
    );
  });

  it("rejects two trend inputs", () => {
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--trend=a.json", "--file=b.json"]).ok,
    ).toBe(false);
  });

  it("parses --strict, --max-actions, --text, --output", () => {
    const args = run(["--trend=t.json", "--strict", "--max-actions=3", "--text", "--output=o.json"]);
    expect(args).toMatchObject({ strict: true, maxActions: 3, format: "text", outputPath: "o.json" });
  });

  it("rejects --output=- (stdin sentinel) and a duplicate --output", () => {
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--trend=t.json", "--output=-"]).ok).toBe(
      false,
    );
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--trend=t.json", "--output=a", "--output=b"])
        .ok,
    ).toBe(false);
  });

  it("rejects conflicting formats and unknown options", () => {
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--trend=t.json", "--json", "--text"]).ok,
    ).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--trend=t.json", "--nope"]).ok).toBe(
      false,
    );
  });

  it("rejects a value flag with no value", () => {
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--trend"]).ok).toBe(false);
  });

  it("treats -h / --help as help", () => {
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--help"])).toEqual({
      ok: true,
      kind: "help",
    });
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["-h"])).toEqual({
      ok: true,
      kind: "help",
    });
  });

  it("clamps --max-actions to the hard ceiling and rejects a non-positive / non-integer value", () => {
    expect(run(["--trend=t.json", "--max-actions=999"]).maxActions).toBe(20); // hard max
    expect(run(["--trend=t.json", "--max-actions=1"]).maxActions).toBe(1);
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--trend=t.json", "--max-actions=0"]).ok,
    ).toBe(false);
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs(["--trend=t.json", "--max-actions=x"]).ok,
    ).toBe(false);
  });
});
