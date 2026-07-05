import { describe, expect, it } from "vitest";
import {
  parseReleaseDecisionCloseoutGovernanceArgs,
  type ReleaseDecisionCloseoutGovernanceArgs,
} from "./args";

/** Parse argv and return the args for a successful `run`, else throw with the message. */
function runArgs(argv: string[]): ReleaseDecisionCloseoutGovernanceArgs {
  const parsed = parseReleaseDecisionCloseoutGovernanceArgs(argv);
  if (!parsed.ok) throw new Error(parsed.message);
  if (parsed.kind !== "run") throw new Error(`expected run, got ${parsed.kind}`);
  return parsed.args;
}

describe("release-decision-closeout-governance args — primary receipt input mode", () => {
  it("accepts --receipt=<path> and defaults to pretty json, no requirements", () => {
    const a = runArgs(["--receipt=r.json"]);
    expect(a.receiptPath).toBe("r.json");
    expect(a.stdin).toBe(false);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
    expect(a.requirePlan).toBe(false);
    expect(a.strictOpen).toBe(false);
  });

  it("accepts --file as an alias for --receipt, and --stdin", () => {
    expect(runArgs(["--file=r.json"]).receiptPath).toBe("r.json");
    expect(runArgs(["--stdin"]).stdin).toBe(true);
  });

  it("requires exactly one primary receipt mode", () => {
    expect(parseReleaseDecisionCloseoutGovernanceArgs([])).toMatchObject({ ok: false });
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--plan=p.json"])).toMatchObject({ ok: false });
  });

  it("rejects --stdin combined with --receipt / --file", () => {
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--stdin", "--receipt=r.json"])).toMatchObject({
      ok: false,
    });
  });

  it("rejects a duplicate --receipt / --file", () => {
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--receipt=a.json", "--file=b.json"])).toMatchObject({
      ok: false,
    });
  });
});

describe("release-decision-closeout-governance args — related records + policy", () => {
  it("accepts each related record path", () => {
    const a = runArgs([
      "--receipt=r.json",
      "--plan=p.json",
      "--trend=t.json",
      "--index=i.json",
      "--closeout=c.json",
    ]);
    expect(a.planPath).toBe("p.json");
    expect(a.trendPath).toBe("t.json");
    expect(a.indexPath).toBe("i.json");
    expect(a.closeoutPath).toBe("c.json");
  });

  it("rejects a duplicate related record path", () => {
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--receipt=r.json", "--plan=a", "--plan=b"])).toMatchObject(
      { ok: false },
    );
  });

  it("accepts each --require-<kind> flag and --strict-open", () => {
    const a = runArgs([
      "--receipt=r.json",
      "--require-plan",
      "--require-trend",
      "--require-index",
      "--require-closeout",
      "--strict-open",
    ]);
    expect(a.requirePlan).toBe(true);
    expect(a.requireTrend).toBe(true);
    expect(a.requireIndex).toBe(true);
    expect(a.requireCloseout).toBe(true);
    expect(a.strictOpen).toBe(true);
  });

  it("a require flag does not itself require the record at parse time", () => {
    // Whether the required record is present is a RUN concern (fold → incomplete), not a parse error.
    expect(runArgs(["--receipt=r.json", "--require-index"]).requireIndex).toBe(true);
  });
});

describe("release-decision-closeout-governance args — format, output, help, errors", () => {
  it("selects --text and --json (conflict rejected)", () => {
    expect(runArgs(["--receipt=r.json", "--text"]).format).toBe("text");
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--receipt=r.json", "--json", "--text"])).toMatchObject({
      ok: false,
    });
  });

  it("accepts --output=<path> and rejects a stdin output / duplicate", () => {
    expect(runArgs(["--receipt=r.json", "--output=o.json"]).outputPath).toBe("o.json");
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--receipt=r.json", "--output=-"])).toMatchObject({
      ok: false,
    });
    expect(
      parseReleaseDecisionCloseoutGovernanceArgs(["--receipt=r.json", "--output=a", "--output=b"]),
    ).toMatchObject({ ok: false });
  });

  it("reports --help and rejects unknown options / missing values", () => {
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--help"])).toMatchObject({ ok: true, kind: "help" });
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--receipt=r.json", "--nope"])).toMatchObject({
      ok: false,
    });
    expect(parseReleaseDecisionCloseoutGovernanceArgs(["--receipt"])).toMatchObject({ ok: false });
  });
});
