import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs as parse } from "./args";

/** Assert a parse succeeded with kind "run" and return its args. */
function runArgs(argv: string[]) {
  const r = parse(argv);
  expect(r.ok).toBe(true);
  if (!r.ok || r.kind !== "run") throw new Error("expected run");
  return r.args;
}

describe("finalize-index-trend-finalize args", () => {
  it("requires exactly one primary receipt input mode", () => {
    const empty = parse([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toMatch(/exactly one primary receipt/);
  });

  it("accepts --receipt, its --file alias, and --stdin", () => {
    expect(runArgs(["--receipt=r.json"]).receiptPath).toBe("r.json");
    expect(runArgs(["--file=r.json"]).receiptPath).toBe("r.json");
    const s = runArgs(["--stdin"]);
    expect(s.stdin).toBe(true);
    expect(s.receiptPath).toBeUndefined();
  });

  it("rejects --stdin combined with --receipt / --file", () => {
    expect(parse(["--stdin", "--receipt=r.json"]).ok).toBe(false);
    expect(parse(["--file=r.json", "--stdin"]).ok).toBe(false);
  });

  it("takes the four optional source-chain record paths", () => {
    const a = runArgs([
      "--receipt=r.json",
      "--plan=p.json",
      "--trend=t.json",
      "--index=i.json",
      "--finalization=f.json",
    ]);
    expect(a.planPath).toBe("p.json");
    expect(a.trendPath).toBe("t.json");
    expect(a.indexPath).toBe("i.json");
    expect(a.finalizationPath).toBe("f.json");
  });

  it("rejects a duplicate single-value flag", () => {
    expect(parse(["--receipt=a", "--receipt=b"]).ok).toBe(false);
    expect(parse(["--receipt=r", "--plan=a", "--plan=b"]).ok).toBe(false);
    expect(parse(["--receipt=r", "--finalization=a", "--finalization=b"]).ok).toBe(false);
    expect(parse(["--receipt=r", "--output=a", "--output=b"]).ok).toBe(false);
  });

  it("defaults format to json and takes --text / --pretty / --output", () => {
    expect(runArgs(["--receipt=r"]).format).toBe("json");
    expect(runArgs(["--receipt=r", "--text"]).format).toBe("text");
    expect(runArgs(["--receipt=r", "--pretty"]).pretty).toBe(true);
    expect(runArgs(["--receipt=r", "--output=o.json"]).outputPath).toBe("o.json");
  });

  it("rejects conflicting formats and a stdin output target", () => {
    expect(parse(["--receipt=r", "--json", "--text"]).ok).toBe(false);
    expect(parse(["--receipt=r", "--output=-"]).ok).toBe(false);
  });

  it("takes the require-* + strict-open policy flags (default false)", () => {
    const base = runArgs(["--receipt=r"]);
    expect([base.requirePlan, base.requireTrend, base.requireIndex, base.requireFinalization, base.strictOpen]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    const all = runArgs([
      "--receipt=r",
      "--require-plan",
      "--require-trend",
      "--require-index",
      "--require-finalization",
      "--strict-open",
    ]);
    expect([all.requirePlan, all.requireTrend, all.requireIndex, all.requireFinalization, all.strictOpen]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("returns help for -h / --help and rejects unknown options / missing values", () => {
    expect(parse(["--help"])).toEqual({ ok: true, kind: "help" });
    expect(parse(["-h"])).toEqual({ ok: true, kind: "help" });
    expect(parse(["--receipt=r", "--nope"]).ok).toBe(false);
    expect(parse(["--receipt"]).ok).toBe(false);
  });
});
