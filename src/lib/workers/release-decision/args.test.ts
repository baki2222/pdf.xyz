// @vitest-environment node
/**
 * Parser proofs for the release decision record CLI (Phase 59). Deterministic + side-effect-free: every branch of the
 * two required inputs, the aliases, the at-most-one-stdin rule, the format / policy flags, help, and every malformed
 * case is pinned without touching argv, the environment, or the filesystem.
 */

import { describe, expect, it } from "vitest";
import { parseReleaseDecisionArgs, type ReleaseDecisionArgs } from "./args";

function runArgs(argv: string[]): ReleaseDecisionArgs {
  const parsed = parseReleaseDecisionArgs(argv);
  if (!parsed.ok || parsed.kind !== "run")
    throw new Error(`expected run, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

describe("parseReleaseDecisionArgs — help + defaults", () => {
  it("-h / --help short-circuits to help", () => {
    expect(parseReleaseDecisionArgs(["--help"])).toEqual({
      ok: true,
      kind: "help",
    });
    expect(parseReleaseDecisionArgs(["-h"])).toEqual({
      ok: true,
      kind: "help",
    });
  });

  it("defaults: json, pretty, not strict", () => {
    const a = runArgs(["--publish-pack=p.json", "--ack=a.json"]);
    expect(a).toMatchObject({
      format: "json",
      pretty: true,
      strict: false,
      publishPackPath: "p.json",
      ackPath: "a.json",
    });
    expect(a.outputPath).toBeUndefined();
  });

  it("accepts the --pack and --acknowledgement aliases", () => {
    const a = runArgs(["--pack=p.json", "--acknowledgement=a.json"]);
    expect(a.publishPackPath).toBe("p.json");
    expect(a.ackPath).toBe("a.json");
  });

  it("accepts a space-separated value and --strict / --text / --output", () => {
    const a = runArgs([
      "--publish-pack",
      "p.json",
      "--ack",
      "a.json",
      "--strict",
      "--text",
      "--output=out.json",
    ]);
    expect(a).toMatchObject({
      format: "text",
      strict: true,
      publishPackPath: "p.json",
      ackPath: "a.json",
      outputPath: "out.json",
    });
  });

  it("allows exactly one stdin input (either side)", () => {
    expect(runArgs(["--publish-pack=-", "--ack=a.json"]).publishPackPath).toBe(
      "-",
    );
    expect(runArgs(["--publish-pack=p.json", "--ack=-"]).ackPath).toBe("-");
  });
});

describe("parseReleaseDecisionArgs — errors", () => {
  it("requires the publish pack", () => {
    const r = parseReleaseDecisionArgs(["--ack=a.json"]);
    expect(r.ok).toBe(false);
  });

  it("requires the acknowledgement", () => {
    const r = parseReleaseDecisionArgs(["--publish-pack=p.json"]);
    expect(r.ok).toBe(false);
  });

  it("rejects two stdin inputs (a process has one stdin)", () => {
    const r = parseReleaseDecisionArgs(["--publish-pack=-", "--ack=-"]);
    expect(r).toEqual({
      ok: false,
      message: expect.stringContaining("At most one input can be stdin"),
    });
  });

  it("rejects an unknown flag", () => {
    expect(
      parseReleaseDecisionArgs([
        "--publish-pack=p.json",
        "--ack=a.json",
        "--nope",
      ]).ok,
    ).toBe(false);
  });

  it("rejects conflicting formats", () => {
    const r = parseReleaseDecisionArgs([
      "--publish-pack=p.json",
      "--ack=a.json",
      "--json",
      "--text",
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a duplicate pack / ack / output", () => {
    expect(
      parseReleaseDecisionArgs([
        "--publish-pack=p.json",
        "--pack=q.json",
        "--ack=a.json",
      ]).ok,
    ).toBe(false);
    expect(
      parseReleaseDecisionArgs([
        "--publish-pack=p.json",
        "--ack=a.json",
        "--acknowledgement=b.json",
      ]).ok,
    ).toBe(false);
    expect(
      parseReleaseDecisionArgs([
        "--publish-pack=p.json",
        "--ack=a.json",
        "--output=x",
        "--output=y",
      ]).ok,
    ).toBe(false);
  });

  it("rejects --output=- (stdout target only, never stdin)", () => {
    expect(
      parseReleaseDecisionArgs([
        "--publish-pack=p.json",
        "--ack=a.json",
        "--output=-",
      ]).ok,
    ).toBe(false);
  });

  it("rejects a missing value for a value flag", () => {
    expect(
      parseReleaseDecisionArgs(["--publish-pack=p.json", "--ack"]).ok,
    ).toBe(false);
  });
});
