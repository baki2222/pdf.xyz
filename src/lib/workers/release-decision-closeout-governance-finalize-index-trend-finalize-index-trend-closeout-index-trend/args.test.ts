import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs } from "./args";
import { DEFAULT_MAX_INDEXES, MAX_INDEXES } from "./types";

/** Parse `argv`, asserting it resolved to a `run` result, and return the validated args. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs", () => {
  it("requires at least one input mode", () => {
    const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/at least one window/i);
  });

  it("defaults: json, pretty, default cap, zero thresholds, no strict-watch, no require-latest", () => {
    const args = run(["--file=a"]);
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
    expect(args.maxIndexes).toBe(DEFAULT_MAX_INDEXES);
    expect(args.maxWatch).toBe(0);
    expect(args.maxIncomplete).toBe(0);
    expect(args.maxBlocked).toBe(0);
    expect(args.strictWatch).toBe(false);
    expect(args.requireLatestIndexed).toBe(false);
    expect(args.indexPaths).toEqual(["a"]);
    expect(args.stdin).toBe(false);
  });

  it("collects a repeated history in order (oldest first) via --file and --index alias", () => {
    expect(run(["--file=older", "--file=newer"]).indexPaths).toEqual(["older", "newer"]);
    expect(run(["--index=a", "--index=b", "--index=c"]).indexPaths).toEqual(["a", "b", "c"]);
  });

  it("parses --stdin and forbids combining it with --file/--index", () => {
    expect(run(["--stdin"]).stdin).toBe(true);
    const bad = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs([
      "--stdin",
      "--file=a",
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/cannot be combined/i);
  });

  it("parses the window cap + thresholds + strict-watch + require-latest-indexed", () => {
    const args = run([
      "--file=a",
      "--max-indexes=8",
      "--max-watch=2",
      "--max-incomplete=1",
      "--max-blocked=3",
      "--strict-watch",
      "--require-latest-indexed",
    ]);
    expect(args.maxIndexes).toBe(8);
    expect(args.maxWatch).toBe(2);
    expect(args.maxIncomplete).toBe(1);
    expect(args.maxBlocked).toBe(3);
    expect(args.strictWatch).toBe(true);
    expect(args.requireLatestIndexed).toBe(true);
  });

  it("rejects a non-positive --max-indexes and one above the hard max; accepts the thresholds at 0", () => {
    const p = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs;
    expect(p(["--file=a", "--max-indexes=0"]).ok).toBe(false);
    expect(p(["--file=a", "--max-indexes=-1"]).ok).toBe(false);
    expect(p(["--file=a", `--max-indexes=${MAX_INDEXES + 1}`]).ok).toBe(false);
    expect(run(["--file=a", `--max-indexes=${MAX_INDEXES}`]).maxIndexes).toBe(MAX_INDEXES);
    expect(run(["--file=a", "--max-watch=0"]).maxWatch).toBe(0);
    expect(p(["--file=a", "--max-watch=-1"]).ok).toBe(false);
    expect(p(["--file=a", "--max-blocked=x"]).ok).toBe(false);
  });

  it("takes a flag value from the next token as well as inline", () => {
    expect(run(["--file", "a", "--max-indexes", "5"]).maxIndexes).toBe(5);
  });

  it("honors --text / --json and rejects conflicting formats", () => {
    expect(run(["--file=a", "--text"]).format).toBe("text");
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs([
        "--file=a",
        "--json",
        "--text",
      ]).ok,
    ).toBe(false);
  });

  it("parses --output, rejects duplicates and the stdin sentinel", () => {
    expect(run(["--file=a", "--output=out.json"]).outputPath).toBe("out.json");
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs([
        "--file=a",
        "--output=a",
        "--output=b",
      ]).ok,
    ).toBe(false);
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs(["--file=a", "--output=-"])
        .ok,
    ).toBe(false);
  });

  it("--help short-circuits; an unknown flag / missing value is a usage error", () => {
    const help = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs(["--help"]);
    expect(help.ok && help.kind === "help").toBe(true);
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs(["--nope"]).ok).toBe(
      false,
    );
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendArgs(["--file=a", "--max-indexes"])
        .ok,
    ).toBe(false);
  });
});
