import { describe, expect, it } from "vitest";
import { parseReleasePublishPackArgs } from "./args";

/** Assert a parse succeeded in `run` mode and return the args. */
function run(argv: string[]) {
  const parsed = parseReleasePublishPackArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleasePublishPackArgs", () => {
  it("requires at least one document input", () => {
    const parsed = parseReleasePublishPackArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/at least one document/i);
  });

  it("defaults to json + pretty, no policy knobs", () => {
    const args = run(["--governance=g.json"]);
    expect(args.format).toBe("json");
    expect(args.pretty).toBe(true);
    expect(args.requireArchive).toBe(false);
    expect(args.requireRestoreDrill).toBe(false);
    expect(args.strict).toBe(false);
    expect(args.governancePath).toBe("g.json");
    expect(args.archivePath).toBeUndefined();
  });

  it("parses all five inputs (inline + spaced), --text, and the output path", () => {
    const args = run([
      "--governance=g.json",
      "--archive",
      "a.json",
      "--restore-drill=d.json",
      "--report=r.json",
      "--trend=t.json",
      "--text",
      "--output=out.txt",
    ]);
    expect(args.governancePath).toBe("g.json");
    expect(args.archivePath).toBe("a.json");
    expect(args.restoreDrillPath).toBe("d.json");
    expect(args.reportPath).toBe("r.json");
    expect(args.trendPath).toBe("t.json");
    expect(args.format).toBe("text");
    expect(args.outputPath).toBe("out.txt");
  });

  it("parses the policy knobs", () => {
    const args = run(["--governance=g.json", "--require-archive", "--require-restore-drill", "--strict"]);
    expect(args.requireArchive).toBe(true);
    expect(args.requireRestoreDrill).toBe(true);
    expect(args.strict).toBe(true);
  });

  it("supports --help", () => {
    const parsed = parseReleasePublishPackArgs(["--help"]);
    expect(parsed.ok && parsed.kind === "help").toBe(true);
    const short = parseReleasePublishPackArgs(["-h"]);
    expect(short.ok && short.kind === "help").toBe(true);
  });

  it("accepts a single `-` as an input from stdin, but rejects two", () => {
    expect(run(["--governance=-"]).governancePath).toBe("-");
    const two = parseReleasePublishPackArgs(["--governance=-", "--archive=-"]);
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.message).toMatch(/one document may be read from stdin/i);
  });

  it("rejects --output=- (stdin cannot be an output)", () => {
    const parsed = parseReleasePublishPackArgs(["--governance=g.json", "--output=-"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/--output cannot be stdin/i);
  });

  it("rejects duplicate single-value flags", () => {
    for (const flag of ["--governance", "--archive", "--restore-drill", "--report", "--trend", "--output"]) {
      const parsed = parseReleasePublishPackArgs([`${flag}=a`, `${flag}=b`]);
      expect(parsed.ok, flag).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(/duplicate/i);
    }
  });

  it("rejects a missing value, an unknown flag, and conflicting formats", () => {
    expect(parseReleasePublishPackArgs(["--governance"]).ok).toBe(false);
    expect(parseReleasePublishPackArgs(["--governance=g.json", "--nope"]).ok).toBe(false);
    const conflict = parseReleasePublishPackArgs(["--governance=g.json", "--json", "--text"]);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.message).toMatch(/conflicting formats/i);
  });

  it("treats a following flag as NOT the value of a value flag (so it errors)", () => {
    // `--governance --strict` — --strict is a flag, not the governance value.
    const parsed = parseReleasePublishPackArgs(["--governance", "--strict"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/--governance requires a value/i);
  });
});
