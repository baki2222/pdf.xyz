import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs } from "./args";

/** Assert a successful `run` parse and return the parsed args. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs — inputs", () => {
  it("accepts --plan / --file / --stdin (exactly one)", () => {
    expect(run(["--plan=p.json"]).planPath).toBe("p.json");
    expect(run(["--file", "p.json"]).planPath).toBe("p.json");
    expect(run(["--stdin"]).stdin).toBe(true);
  });

  it("requires exactly one input (empty invocation is a usage error)", () => {
    const empty = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toMatch(/Supply exactly one plan/);
  });

  it("rejects --stdin combined with --plan / --file", () => {
    const r = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(["--stdin", "--plan=p.json"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/--stdin cannot be combined/);
  });

  it("rejects a duplicate plan", () => {
    const r = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(["--plan=a.json", "--file=b.json"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/exactly one plan/);
  });

  it("never echoes a value beyond the flag name on a missing value", () => {
    const r = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(["--plan"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("--plan requires a value.");
  });
});

describe("parseFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs — acknowledgements + policy", () => {
  it("defaults every acknowledgement + strict-open to false", () => {
    const a = run(["--stdin"]);
    expect(a).toMatchObject({
      ackPlan: false,
      ackFollowups: false,
      ackMonitor: false,
      ackInvestigation: false,
      ackBlock: false,
      strictOpen: false,
    });
  });

  it("sets each acknowledgement flag independently", () => {
    const a = run([
      "--stdin",
      "--ack-plan",
      "--ack-followups",
      "--ack-monitor",
      "--ack-investigation",
      "--ack-block",
      "--strict-open",
    ]);
    expect(a).toMatchObject({
      ackPlan: true,
      ackFollowups: true,
      ackMonitor: true,
      ackInvestigation: true,
      ackBlock: true,
      strictOpen: true,
    });
  });

  it("treats --ack-reviewed as an alias for --ack-plan", () => {
    expect(run(["--stdin", "--ack-reviewed"]).ackPlan).toBe(true);
  });

  it("rejects the removed --ack-executed / --ack-clear flags as unknown options", () => {
    for (const gone of ["--ack-executed", "--ack-clear"]) {
      const r = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(["--stdin", gone]);
      expect(r.ok, gone).toBe(false);
      if (!r.ok) expect(r.message).toBe(`Unknown option: ${gone}`);
    }
  });
});

describe("parseFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs — format + output + help", () => {
  it("defaults to json, pretty", () => {
    const a = run(["--stdin"]);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
  });

  it("accepts --text, --pretty, and rejects conflicting formats", () => {
    expect(run(["--stdin", "--text"]).format).toBe("text");
    expect(run(["--stdin", "--pretty"]).pretty).toBe(true);
    const r = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(["--stdin", "--json", "--text"]);
    expect(r.ok).toBe(false);
  });

  it("accepts --output and rejects a duplicate / stdin destination", () => {
    expect(run(["--stdin", "--output=o.json"]).outputPath).toBe("o.json");
    expect(parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(["--stdin", "--output=-"]).ok).toBe(false);
    expect(
      parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(["--stdin", "--output=a", "--output=b"]).ok,
    ).toBe(false);
  });

  it("returns help for -h / --help", () => {
    for (const flag of ["-h", "--help"]) {
      const r = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs([flag]);
      expect(r.ok && r.kind === "help").toBe(true);
    }
  });

  it("rejects an unknown option", () => {
    const r = parseReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptArgs(["--stdin", "--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Unknown option: --nope");
  });
});
