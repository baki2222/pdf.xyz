import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutActionPlanArgs } from "./args";

/** Narrow to the `run` branch, or fail loudly. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutActionPlanArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutActionPlanArgs", () => {
  it("requires exactly one input mode (empty invocation is a usage error)", () => {
    const parsed = parseReleaseDecisionCloseoutActionPlanArgs([]);
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
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["--stdin", "--trend=t.json"]).ok).toBe(false);
  });

  it("rejects two trend inputs", () => {
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["--trend=a.json", "--file=b.json"]).ok).toBe(false);
  });

  it("parses --strict-watch, --text, --output", () => {
    const args = run(["--trend=t.json", "--strict-watch", "--text", "--output=o.json"]);
    expect(args).toMatchObject({ strictWatch: true, format: "text", outputPath: "o.json" });
  });

  it("rejects --output=- (stdin sentinel) and a duplicate --output", () => {
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["--trend=t.json", "--output=-"]).ok).toBe(false);
    expect(
      parseReleaseDecisionCloseoutActionPlanArgs(["--trend=t.json", "--output=a", "--output=b"]).ok,
    ).toBe(false);
  });

  it("rejects conflicting formats and unknown options", () => {
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["--trend=t.json", "--json", "--text"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["--trend=t.json", "--nope"]).ok).toBe(false);
  });

  it("rejects a value flag with no value", () => {
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["--trend"]).ok).toBe(false);
  });

  it("treats -h / --help as help", () => {
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["--help"])).toEqual({ ok: true, kind: "help" });
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["-h"])).toEqual({ ok: true, kind: "help" });
  });

  it("does not accept a --max-actions knob (not part of this CLI's surface)", () => {
    // The checklist is small + bounded by construction; there is no cap flag.
    expect(parseReleaseDecisionCloseoutActionPlanArgs(["--trend=t.json", "--max-actions=1"]).ok).toBe(false);
  });
});
