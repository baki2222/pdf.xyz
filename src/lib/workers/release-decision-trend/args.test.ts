import { describe, expect, it } from "vitest";
import { parseReleaseDecisionTrendArgs } from "./args";
import { DEFAULT_MAX_WINDOWS } from "./types";

/** Convenience: parse and assert a run with the given args. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionTrendArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected a run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionTrendArgs — modes", () => {
  it("requires at least one input mode", () => {
    const parsed = parseReleaseDecisionTrendArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/Supply at least one window/);
  });

  it("accepts repeated --file (oldest first, newest last) with defaults", () => {
    const args = run(["--file=w1", "--file=w2"]);
    expect(args.windowPaths).toEqual(["w1", "w2"]);
    expect(args.stdin).toBe(false);
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
    expect(args.maxWindows).toBe(DEFAULT_MAX_WINDOWS);
    expect(args.strict).toBe(false);
  });

  it("accepts --window as an alias for --file", () => {
    expect(run(["--window=a", "--window=b"]).windowPaths).toEqual(["a", "b"]);
  });

  it("accepts --stdin as the input mode", () => {
    const args = run(["--stdin"]);
    expect(args.stdin).toBe(true);
    expect(args.windowPaths).toBeUndefined();
  });

  it("rejects --stdin combined with --file", () => {
    const parsed = parseReleaseDecisionTrendArgs(["--stdin", "--file=x"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/--stdin cannot be combined/);
  });
});

describe("parseReleaseDecisionTrendArgs — flags", () => {
  it("parses --text / --json and rejects conflicting formats", () => {
    expect(run(["--file=w", "--text"]).format).toBe("text");
    const parsed = parseReleaseDecisionTrendArgs(["--file=w", "--text", "--json"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/Conflicting formats/);
  });

  it("parses --strict", () => {
    expect(run(["--file=w", "--strict"]).strict).toBe(true);
  });

  it("parses --max-windows and rejects non-positive / non-integer values", () => {
    expect(run(["--file=w", "--max-windows=5"]).maxWindows).toBe(5);
    for (const bad of ["0", "-1", "abc", "2.5"]) {
      const parsed = parseReleaseDecisionTrendArgs(["--file=w", `--max-windows=${bad}`]);
      expect(parsed.ok, bad).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(/positive integer/);
    }
  });

  it("takes --max-windows from the next token when not inline", () => {
    expect(run(["--file=w", "--max-windows", "9"]).maxWindows).toBe(9);
  });

  it("records --output and rejects a duplicate / a stdin destination", () => {
    expect(run(["--file=w", "--output=out.json"]).outputPath).toBe("out.json");
    expect(parseReleaseDecisionTrendArgs(["--file=w", "--output=-"]).ok).toBe(false);
    expect(parseReleaseDecisionTrendArgs(["--file=w", "--output=a", "--output=b"]).ok).toBe(false);
  });

  it("rejects an unknown option and a value flag with no value", () => {
    expect(parseReleaseDecisionTrendArgs(["--file=w", "--nope"]).ok).toBe(false);
    expect(parseReleaseDecisionTrendArgs(["--file"]).ok).toBe(false);
  });
});

describe("parseReleaseDecisionTrendArgs — help", () => {
  it("returns help for -h / --help", () => {
    for (const flag of ["-h", "--help"]) {
      const parsed = parseReleaseDecisionTrendArgs([flag]);
      expect(parsed.ok && parsed.kind === "help").toBe(true);
    }
  });
});
