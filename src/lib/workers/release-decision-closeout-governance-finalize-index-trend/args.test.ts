import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs } from "./args";
import { DEFAULT_MAX_WINDOWS, MAX_WINDOWS } from "./types";

/** Parse `argv`, asserting it resolved to a `run` result, and return the validated args. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs", () => {
  it("requires at least one input mode", () => {
    const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/at least one window/i);
  });

  it("defaults: json, pretty, default window cap, no strict-open, no require-latest", () => {
    const args = run(["--file=a"]);
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
    expect(args.maxWindows).toBe(DEFAULT_MAX_WINDOWS);
    expect(args.strictOpen).toBe(false);
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
    const bad = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--stdin", "--file=a"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/cannot be combined/i);
  });

  it("parses the window cap + strict-open + require-latest-indexed", () => {
    const args = run(["--file=a", "--max-windows=8", "--strict-open", "--require-latest-indexed"]);
    expect(args.maxWindows).toBe(8);
    expect(args.strictOpen).toBe(true);
    expect(args.requireLatestIndexed).toBe(true);
  });

  it("rejects a non-positive --max-windows and one above the hard max", () => {
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--file=a", "--max-windows=0"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--file=a", "--max-windows=-1"]).ok).toBe(false);
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--file=a", `--max-windows=${MAX_WINDOWS + 1}`]).ok,
    ).toBe(false);
    expect(run(["--file=a", `--max-windows=${MAX_WINDOWS}`]).maxWindows).toBe(MAX_WINDOWS);
  });

  it("takes a flag value from the next token as well as inline", () => {
    expect(run(["--file", "a", "--max-windows", "5"]).maxWindows).toBe(5);
  });

  it("honors --text / --json and rejects conflicting formats", () => {
    expect(run(["--file=a", "--text"]).format).toBe("text");
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--file=a", "--json", "--text"]).ok).toBe(
      false,
    );
  });

  it("parses --output, rejects duplicates and the stdin sentinel", () => {
    expect(run(["--file=a", "--output=out.json"]).outputPath).toBe("out.json");
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--file=a", "--output=a", "--output=b"]).ok,
    ).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--file=a", "--output=-"]).ok).toBe(false);
  });

  it("--help short-circuits; an unknown flag / missing value is a usage error", () => {
    const help = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--help"]);
    expect(help.ok && help.kind === "help").toBe(true);
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--nope"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs(["--file=a", "--max-windows"]).ok).toBe(false);
  });
});
