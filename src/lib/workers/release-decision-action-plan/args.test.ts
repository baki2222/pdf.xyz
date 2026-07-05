import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_ACTIONS, MAX_MAX_ACTIONS } from "./types";
import { parseReleaseDecisionActionPlanArgs as parse } from "./args";

/** Convenience: parse and assert a successful `run`, returning the validated args. */
function run(argv: string[]) {
  const r = parse(argv);
  if (!r.ok || r.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.args;
}

describe("release-decision-action-plan args", () => {
  it("requires exactly one input mode", () => {
    const r = parse([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Supply exactly one trend/);
  });

  it("accepts --trend and its --file alias", () => {
    expect(run(["--trend=t.json"]).trendPath).toBe("t.json");
    expect(run(["--file=t.json"]).trendPath).toBe("t.json");
    expect(run(["--trend", "t.json"]).trendPath).toBe("t.json");
  });

  it("accepts --stdin as the input mode", () => {
    const a = run(["--stdin"]);
    expect(a.stdin).toBe(true);
    expect(a.trendPath).toBeUndefined();
  });

  it("rejects combining --stdin with --trend / --file", () => {
    expect(parse(["--stdin", "--trend=t.json"]).ok).toBe(false);
    expect(parse(["--stdin", "--file=t.json"]).ok).toBe(false);
  });

  it("rejects more than one trend (single-document input)", () => {
    const r = parse(["--trend=a.json", "--file=b.json"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/only once/);
  });

  it("defaults format to json and pretty to true", () => {
    const a = run(["--trend=t.json"]);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
  });

  it("honors --text and --json, and rejects conflicting formats", () => {
    expect(run(["--trend=t.json", "--text"]).format).toBe("text");
    expect(run(["--trend=t.json", "--json"]).format).toBe("json");
    expect(parse(["--trend=t.json", "--json", "--text"]).ok).toBe(false);
  });

  it("parses --strict", () => {
    expect(run(["--trend=t.json", "--strict"]).strict).toBe(true);
    expect(run(["--trend=t.json"]).strict).toBe(false);
  });

  it("defaults --max-actions and parses a valid one", () => {
    expect(run(["--trend=t.json"]).maxActions).toBe(DEFAULT_MAX_ACTIONS);
    expect(run(["--trend=t.json", "--max-actions=3"]).maxActions).toBe(3);
  });

  it("clamps --max-actions to the hard max, and rejects < 1 / non-integers", () => {
    expect(run(["--trend=t.json", "--max-actions=999"]).maxActions).toBe(MAX_MAX_ACTIONS);
    expect(parse(["--trend=t.json", "--max-actions=0"]).ok).toBe(false);
    expect(parse(["--trend=t.json", "--max-actions=-1"]).ok).toBe(false);
    expect(parse(["--trend=t.json", "--max-actions=abc"]).ok).toBe(false);
    expect(parse(["--trend=t.json", "--max-actions=1.5"]).ok).toBe(false);
  });

  it("parses --output and rejects a duplicate / stdin sentinel", () => {
    expect(run(["--trend=t.json", "--output=out.json"]).outputPath).toBe("out.json");
    expect(parse(["--trend=t.json", "--output=a", "--output=b"]).ok).toBe(false);
    expect(parse(["--trend=t.json", "--output=-"]).ok).toBe(false);
  });

  it("rejects a value flag with no value", () => {
    expect(parse(["--trend"]).ok).toBe(false);
    expect(parse(["--trend="]).ok).toBe(false);
    expect(parse(["--trend=t.json", "--max-actions"]).ok).toBe(false);
  });

  it("rejects unknown options", () => {
    const r = parse(["--trend=t.json", "--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Unknown option/);
  });

  it("treats -h / --help as help", () => {
    expect(parse(["--help"])).toEqual({ ok: true, kind: "help" });
    expect(parse(["-h"])).toEqual({ ok: true, kind: "help" });
  });
});
