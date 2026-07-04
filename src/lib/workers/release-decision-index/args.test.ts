import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_RECORDS } from "./types";
import { parseReleaseDecisionIndexArgs, RELEASE_DECISION_INDEX_USAGE } from "./args";

/** Assert a parse succeeded as a run, and return the args. */
function run(argv: string[]) {
  const r = parseReleaseDecisionIndexArgs(argv);
  if (!r.ok || r.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(r)}`);
  return r.args;
}

describe("parseReleaseDecisionIndexArgs — input modes", () => {
  it("requires at least one record input", () => {
    const r = parseReleaseDecisionIndexArgs([]);
    expect(r).toEqual({ ok: false, message: expect.stringContaining("Supply at least one record") });
  });

  it("accepts a single --file", () => {
    const a = run(["--file=a.json"]);
    expect(a.recordPaths).toEqual(["a.json"]);
    expect(a.stdin).toBe(false);
    expect(a.format).toBe("json");
    expect(a.maxRecords).toBe(DEFAULT_MAX_RECORDS);
    expect(a.strict).toBe(false);
  });

  it("accepts repeated --file (oldest first, newest last) and the --decision alias", () => {
    expect(run(["--file=old.json", "--file=new.json"]).recordPaths).toEqual(["old.json", "new.json"]);
    expect(run(["--decision=a.json", "--file=b.json"]).recordPaths).toEqual(["a.json", "b.json"]);
  });

  it("accepts a space-separated flag value", () => {
    expect(run(["--file", "a.json"]).recordPaths).toEqual(["a.json"]);
  });

  it("accepts --stdin as a mode", () => {
    const a = run(["--stdin"]);
    expect(a.stdin).toBe(true);
    expect(a.recordPaths).toBeUndefined();
  });

  it("rejects --stdin combined with --file", () => {
    const r = parseReleaseDecisionIndexArgs(["--stdin", "--file=a.json"]);
    expect(r).toEqual({ ok: false, message: expect.stringContaining("--stdin cannot be combined") });
  });
});

describe("parseReleaseDecisionIndexArgs — policy + format", () => {
  it("parses --max-records", () => {
    expect(run(["--file=a.json", "--max-records=5"]).maxRecords).toBe(5);
  });

  it("rejects a non-positive / non-integer --max-records", () => {
    for (const bad of ["0", "-1", "abc", "1.5", ""]) {
      const r = parseReleaseDecisionIndexArgs(["--file=a.json", `--max-records=${bad}`]);
      expect(r.ok, `--max-records=${bad}`).toBe(false);
    }
  });

  it("parses --strict", () => {
    expect(run(["--file=a.json", "--strict"]).strict).toBe(true);
  });

  it("defaults to json; --text selects text; conflicting formats are rejected", () => {
    expect(run(["--file=a.json"]).format).toBe("json");
    expect(run(["--file=a.json", "--text"]).format).toBe("text");
    expect(run(["--file=a.json", "--json", "--json"]).format).toBe("json");
    const r = parseReleaseDecisionIndexArgs(["--file=a.json", "--json", "--text"]);
    expect(r).toEqual({ ok: false, message: expect.stringContaining("Conflicting formats") });
  });

  it("parses --output and rejects a stdin / duplicate output", () => {
    expect(run(["--file=a.json", "--output=out.json"]).outputPath).toBe("out.json");
    expect(parseReleaseDecisionIndexArgs(["--file=a.json", "--output=-"]).ok).toBe(false);
    expect(parseReleaseDecisionIndexArgs(["--file=a.json", "--output=a", "--output=b"]).ok).toBe(false);
  });
});

describe("parseReleaseDecisionIndexArgs — help + unknown", () => {
  it("returns help on -h / --help", () => {
    expect(parseReleaseDecisionIndexArgs(["--help"])).toEqual({ ok: true, kind: "help" });
    expect(parseReleaseDecisionIndexArgs(["-h"])).toEqual({ ok: true, kind: "help" });
  });

  it("rejects an unknown option", () => {
    const r = parseReleaseDecisionIndexArgs(["--file=a.json", "--nope"]);
    expect(r).toEqual({ ok: false, message: expect.stringContaining("Unknown option") });
  });

  it("a required value flag with no value is a usage error", () => {
    expect(parseReleaseDecisionIndexArgs(["--file"]).ok).toBe(false);
  });

  it("the usage text names the ledger index and its non-audit-log honesty", () => {
    expect(RELEASE_DECISION_INDEX_USAGE).toMatch(/release decision ledger index/i);
    expect(RELEASE_DECISION_INDEX_USAGE).toMatch(/legal audit/i);
  });
});
