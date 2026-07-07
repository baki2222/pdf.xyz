import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs } from "./args";
import { DEFAULT_MAX_INDEXES, MAX_INDEXES } from "./types";

/** Parse `argv`, asserting it resolved to a `run` result, and return the validated args. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs", () => {
  it("requires at least one input mode", () => {
    const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/at least one window/i);
  });

  it("defaults: json, pretty, default cap, zero thresholds, no strict-open, no require-latest", () => {
    const args = run(["--file=a"]);
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
    expect(args.maxIndexes).toBe(DEFAULT_MAX_INDEXES);
    expect(args.maxOpen).toBe(0);
    expect(args.maxIncomplete).toBe(0);
    expect(args.maxBlocked).toBe(0);
    expect(args.strictOpen).toBe(false);
    expect(args.requireLatestAllClosed).toBe(false);
    expect(args.indexPaths).toEqual(["a"]);
    expect(args.stdin).toBe(false);
  });

  it("collects a repeated history in order (oldest first) via --file and --index alias", () => {
    expect(run(["--file=older", "--file=newer"]).indexPaths).toEqual(["older", "newer"]);
    expect(run(["--index=a", "--index=b", "--index=c"]).indexPaths).toEqual(["a", "b", "c"]);
  });

  it("parses --stdin and forbids combining it with --file/--index", () => {
    expect(run(["--stdin"]).stdin).toBe(true);
    const bad = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs([
      "--stdin",
      "--file=a",
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/cannot be combined/i);
  });

  it("parses the window cap + thresholds + strict-open + require-latest-all-closed", () => {
    const args = run([
      "--file=a",
      "--max-indexes=8",
      "--max-open=2",
      "--max-incomplete=1",
      "--max-blocked=3",
      "--strict-open",
      "--require-latest-all-closed",
    ]);
    expect(args.maxIndexes).toBe(8);
    expect(args.maxOpen).toBe(2);
    expect(args.maxIncomplete).toBe(1);
    expect(args.maxBlocked).toBe(3);
    expect(args.strictOpen).toBe(true);
    expect(args.requireLatestAllClosed).toBe(true);
  });

  it("rejects a non-positive --max-indexes and one above the hard max; accepts the thresholds at 0", () => {
    const p = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs;
    expect(p(["--file=a", "--max-indexes=0"]).ok).toBe(false);
    expect(p(["--file=a", "--max-indexes=-1"]).ok).toBe(false);
    expect(p(["--file=a", `--max-indexes=${MAX_INDEXES + 1}`]).ok).toBe(false);
    expect(run(["--file=a", `--max-indexes=${MAX_INDEXES}`]).maxIndexes).toBe(MAX_INDEXES);
    expect(run(["--file=a", "--max-open=0"]).maxOpen).toBe(0);
    expect(p(["--file=a", "--max-open=-1"]).ok).toBe(false);
    expect(p(["--file=a", "--max-blocked=x"]).ok).toBe(false);
  });

  it("takes a flag value from the next token as well as inline", () => {
    expect(run(["--file", "a", "--max-indexes", "5"]).maxIndexes).toBe(5);
  });

  it("honors --text / --json and rejects conflicting formats", () => {
    expect(run(["--file=a", "--text"]).format).toBe("text");
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs([
        "--file=a",
        "--json",
        "--text",
      ]).ok,
    ).toBe(false);
  });

  it("parses --output, rejects duplicates and the stdin sentinel", () => {
    expect(run(["--file=a", "--output=out.json"]).outputPath).toBe("out.json");
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs([
        "--file=a",
        "--output=a",
        "--output=b",
      ]).ok,
    ).toBe(false);
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs(["--file=a", "--output=-"])
        .ok,
    ).toBe(false);
  });

  it("--help short-circuits; an unknown flag / missing value is a usage error", () => {
    const help = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs(["--help"]);
    expect(help.ok && help.kind === "help").toBe(true);
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs(["--nope"]).ok).toBe(
      false,
    );
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs(["--file=a", "--max-indexes"])
        .ok,
    ).toBe(false);
  });
});
