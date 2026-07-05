import { describe, expect, it } from "vitest";
import { parseReleaseDecisionCloseoutActionReceiptArgs } from "./args";

/** Assert a successful `run` parse and return the parsed args. */
function run(argv: string[]) {
  const parsed = parseReleaseDecisionCloseoutActionReceiptArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionCloseoutActionReceiptArgs — inputs", () => {
  it("accepts --plan / --file / --stdin (exactly one)", () => {
    expect(run(["--plan=p.json"]).planPath).toBe("p.json");
    expect(run(["--file", "p.json"]).planPath).toBe("p.json");
    expect(run(["--stdin"]).stdin).toBe(true);
  });

  it("requires exactly one input (empty invocation is a usage error)", () => {
    const empty = parseReleaseDecisionCloseoutActionReceiptArgs([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toMatch(/Supply exactly one plan/);
  });

  it("rejects --stdin combined with --plan / --file", () => {
    const r = parseReleaseDecisionCloseoutActionReceiptArgs(["--stdin", "--plan=p.json"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/--stdin cannot be combined/);
  });

  it("rejects a duplicate plan", () => {
    const r = parseReleaseDecisionCloseoutActionReceiptArgs(["--plan=a.json", "--file=b.json"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/exactly one plan/);
  });

  it("never echoes a value beyond the flag name on a missing value", () => {
    const r = parseReleaseDecisionCloseoutActionReceiptArgs(["--plan"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("--plan requires a value.");
  });
});

describe("parseReleaseDecisionCloseoutActionReceiptArgs — acknowledgements + policy", () => {
  it("defaults every acknowledgement + strict-open to false", () => {
    const a = run(["--stdin"]);
    expect(a).toMatchObject({
      ackPlan: false,
      ackExecuted: false,
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
      "--ack-executed",
      "--ack-monitor",
      "--ack-investigation",
      "--ack-block",
      "--strict-open",
    ]);
    expect(a).toMatchObject({
      ackPlan: true,
      ackExecuted: true,
      ackMonitor: true,
      ackInvestigation: true,
      ackBlock: true,
      strictOpen: true,
    });
  });
});

describe("parseReleaseDecisionCloseoutActionReceiptArgs — format + output + help", () => {
  it("defaults to json, pretty", () => {
    const a = run(["--stdin"]);
    expect(a.format).toBe("json");
    expect(a.pretty).toBe(true);
  });

  it("accepts --text and rejects conflicting formats", () => {
    expect(run(["--stdin", "--text"]).format).toBe("text");
    const r = parseReleaseDecisionCloseoutActionReceiptArgs(["--stdin", "--json", "--text"]);
    expect(r.ok).toBe(false);
  });

  it("accepts --output and rejects a duplicate / stdin destination", () => {
    expect(run(["--stdin", "--output=o.json"]).outputPath).toBe("o.json");
    expect(parseReleaseDecisionCloseoutActionReceiptArgs(["--stdin", "--output=-"]).ok).toBe(false);
    expect(parseReleaseDecisionCloseoutActionReceiptArgs(["--stdin", "--output=a", "--output=b"]).ok).toBe(false);
  });

  it("returns help for -h / --help", () => {
    for (const flag of ["-h", "--help"]) {
      const r = parseReleaseDecisionCloseoutActionReceiptArgs([flag]);
      expect(r.ok && r.kind === "help").toBe(true);
    }
  });

  it("rejects an unknown option", () => {
    const r = parseReleaseDecisionCloseoutActionReceiptArgs(["--stdin", "--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Unknown option: --nope");
  });
});
