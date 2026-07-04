import { describe, expect, it } from "vitest";
import { parseReleaseAckArgs } from "./args";

/** Parse and assert a successful run, returning the validated args. */
function run(argv: string[]) {
  const parsed = parseReleaseAckArgs(argv);
  if (!parsed.ok || parsed.kind !== "run") throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseAckArgs", () => {
  it("requires a publish pack", () => {
    const parsed = parseReleaseAckArgs(["--decision=accepted"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/publish pack is required/i);
  });

  it("requires a decision", () => {
    const parsed = parseReleaseAckArgs(["--publish-pack=pack.json"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/decision is required/i);
  });

  it("parses a minimal valid invocation with sane defaults", () => {
    const args = run(["--publish-pack=pack.json", "--decision=accepted"]);
    expect(args).toMatchObject({
      format: "json",
      pretty: true,
      decision: "accepted",
      reviewer: "unknown",
      note: "none",
      strict: false,
      publishPackPath: "pack.json",
    });
    expect(args.outputPath).toBeUndefined();
  });

  it("accepts --pack as an alias for --publish-pack", () => {
    expect(run(["--pack=pack.json", "--decision=rejected"]).publishPackPath).toBe("pack.json");
  });

  it("rejects supplying both --publish-pack and --pack", () => {
    const parsed = parseReleaseAckArgs(["--publish-pack=a.json", "--pack=b.json", "--decision=accepted"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/duplicate publish pack/i);
  });

  it("accepts `-` (stdin) as the pack value", () => {
    expect(run(["--publish-pack=-", "--decision=accepted"]).publishPackPath).toBe("-");
  });

  it("parses every decision enum", () => {
    for (const d of ["accepted", "accepted-with-notes", "needs-changes", "rejected", "deferred"] as const) {
      expect(run(["--publish-pack=p.json", `--decision=${d}`]).decision).toBe(d);
    }
  });

  it("rejects an off-enum decision", () => {
    const parsed = parseReleaseAckArgs(["--publish-pack=p.json", "--decision=approved"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/invalid --decision/i);
  });

  it("parses every reviewer class and rejects an off-enum one", () => {
    for (const r of ["internal-approver", "external-reviewer", "incident-responder", "partner", "unknown"] as const) {
      expect(run(["--publish-pack=p.json", "--decision=accepted", `--reviewer=${r}`]).reviewer).toBe(r);
    }
    const parsed = parseReleaseAckArgs(["--publish-pack=p.json", "--decision=accepted", "--reviewer=alice@example.com"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/invalid --reviewer/i);
  });

  it("parses every note class and rejects an off-enum one", () => {
    for (const n of ["none", "operational-follow-up", "evidence-gap", "policy-follow-up", "legal-review", "security-review"] as const) {
      expect(run(["--publish-pack=p.json", "--decision=accepted", `--note=${n}`]).note).toBe(n);
    }
    const parsed = parseReleaseAckArgs(["--publish-pack=p.json", "--decision=accepted", "--note=see attached notes.txt"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/invalid --note/i);
  });

  it("parses --strict and --text and --output", () => {
    const args = run([
      "--publish-pack=p.json",
      "--decision=accepted",
      "--strict",
      "--text",
      "--output=out.json",
    ]);
    expect(args.strict).toBe(true);
    expect(args.format).toBe("text");
    expect(args.outputPath).toBe("out.json");
  });

  it("supports space-separated flag values", () => {
    const args = run(["--publish-pack", "p.json", "--decision", "accepted-with-notes"]);
    expect(args.publishPackPath).toBe("p.json");
    expect(args.decision).toBe("accepted-with-notes");
  });

  it("shows help for -h / --help", () => {
    for (const flag of ["-h", "--help"]) {
      const parsed = parseReleaseAckArgs([flag]);
      expect(parsed.ok && parsed.kind === "help").toBe(true);
    }
  });

  it("rejects an unknown option, a missing value, a duplicate, and conflicting formats", () => {
    expect(parseReleaseAckArgs(["--nope", "--publish-pack=p.json", "--decision=accepted"]).ok).toBe(false);
    expect(parseReleaseAckArgs(["--publish-pack=p.json", "--decision=accepted", "--output"]).ok).toBe(false);
    expect(parseReleaseAckArgs(["--publish-pack=p.json", "--decision=accepted", "--decision=rejected"]).ok).toBe(false);
    expect(parseReleaseAckArgs(["--publish-pack=p.json", "--decision=accepted", "--json", "--text"]).ok).toBe(false);
  });

  it("rejects --output=- (stdin cannot be the output)", () => {
    const parsed = parseReleaseAckArgs(["--publish-pack=p.json", "--decision=accepted", "--output=-"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/--output cannot be stdin/i);
  });
});
