import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutIndexTrendArgs } from "./args";
import { DEFAULT_MAX_INDEXES } from "./types";

/** Parse and assert a successful `run` result, returning the validated args. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutIndexTrendArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutIndexTrendArgs", () => {
  it("requires at least one input mode", () => {
    const parsed = parseReleaseDecisionCloseoutIndexTrendArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/at least one window/i);
  });

  it("defaults: json, pretty, default window cap, zero thresholds, no strict-watch", () => {
    const args = run(["--file=a"]);
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
    expect(args.maxIndexes).toBe(DEFAULT_MAX_INDEXES);
    expect(args.maxWatch).toBe(0);
    expect(args.maxIncomplete).toBe(0);
    expect(args.maxBlocked).toBe(0);
    expect(args.strictWatch).toBe(false);
    expect(args.indexPaths).toEqual(["a"]);
    expect(args.stdin).toBe(false);
  });

  it("collects a repeated history in order (oldest first) via --file and --index alias", () => {
    expect(run(["--file=older", "--file=newer"]).indexPaths).toEqual(["older", "newer"]);
    expect(run(["--index=a", "--index=b", "--index=c"]).indexPaths).toEqual(["a", "b", "c"]);
  });

  it("parses --stdin and forbids combining it with --file/--index", () => {
    expect(run(["--stdin"]).stdin).toBe(true);
    const bad = parseReleaseDecisionCloseoutIndexTrendArgs(["--stdin", "--file=a"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/cannot be combined/i);
  });

  it("parses the window cap + thresholds + strict-watch", () => {
    const args = run([
      "--file=a",
      "--max-indexes=8",
      "--max-watch=2",
      "--max-incomplete=1",
      "--max-blocked=3",
      "--strict-watch",
    ]);
    expect(args.maxIndexes).toBe(8);
    expect(args.maxWatch).toBe(2);
    expect(args.maxIncomplete).toBe(1);
    expect(args.maxBlocked).toBe(3);
    expect(args.strictWatch).toBe(true);
  });

  it("rejects a non-positive --max-indexes and a negative threshold", () => {
    expect(parseReleaseDecisionCloseoutIndexTrendArgs(["--file=a", "--max-indexes=0"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexTrendArgs(["--file=a", "--max-indexes=-1"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexTrendArgs(["--file=a", "--max-watch=-1"]).ok).toBe(false);
    // a threshold of 0 is valid (tolerate nothing)
    expect(run(["--file=a", "--max-blocked=0"]).maxBlocked).toBe(0);
  });

  it("takes a flag value from the next token as well as inline", () => {
    expect(run(["--file", "a", "--max-indexes", "5"]).maxIndexes).toBe(5);
  });

  it("honors --text / --json and rejects conflicting formats", () => {
    expect(run(["--file=a", "--text"]).format).toBe("text");
    const bad = parseReleaseDecisionCloseoutIndexTrendArgs(["--file=a", "--json", "--text"]);
    expect(bad.ok).toBe(false);
  });

  it("parses --output, rejects duplicates and stdin sentinel", () => {
    expect(run(["--file=a", "--output=out.json"]).outputPath).toBe("out.json");
    expect(parseReleaseDecisionCloseoutIndexTrendArgs(["--file=a", "--output=out", "--output=two"]).ok).toBe(
      false,
    );
    expect(parseReleaseDecisionCloseoutIndexTrendArgs(["--file=a", "--output=-"]).ok).toBe(false);
  });

  it("--help short-circuits; an unknown flag / missing value is a usage error", () => {
    const help = parseReleaseDecisionCloseoutIndexTrendArgs(["--help"]);
    expect(help.ok && help.kind === "help").toBe(true);
    expect(parseReleaseDecisionCloseoutIndexTrendArgs(["--file=a", "--nope"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutIndexTrendArgs(["--file=a", "--max-watch"]).ok).toBe(false);
  });
});
