import { describe, expect, it } from "vitest";
import { parseStdinGovernance, runReleaseDecisionCloseoutGovernanceIndex } from "./run";
import {
  blockedGovernance,
  closedGovernance,
  makeArgs,
  makeProvider,
  notAGovernance,
  openGovernance,
  tamperedGovernance,
} from "./fixtures";

describe("parseStdinGovernance", () => {
  it("accepts a JSON array, a single object, and an NDJSON stream", () => {
    expect(parseStdinGovernance("[]")).toEqual([]);
    expect(parseStdinGovernance(JSON.stringify([{ a: 1 }, { b: 2 }]))).toHaveLength(2);
    expect(parseStdinGovernance(JSON.stringify({ a: 1 }))).toHaveLength(1);
    const nd = `${JSON.stringify({ a: 1 })}\n\n${JSON.stringify({ b: 2 })}\n`;
    expect(parseStdinGovernance(nd)).toHaveLength(2);
    expect(parseStdinGovernance("   ")).toEqual([]);
  });

  it("a malformed NDJSON line becomes one unrecognized root (never a throw)", () => {
    const roots = parseStdinGovernance(`${JSON.stringify({ a: 1 })}\nnot-json\n`);
    expect(roots).toHaveLength(2);
  });
});

describe("runReleaseDecisionCloseoutGovernanceIndex — end to end over seams", () => {
  const runFiles = (objs: unknown[], over = {}) =>
    runReleaseDecisionCloseoutGovernanceIndex(makeArgs(objs, over), makeProvider(objs));

  it("a coherent history is indexed (exit 0)", async () => {
    const r = await runFiles([closedGovernance(), closedGovernance()]);
    expect(r.exitCode).toBe(0);
    expect(r.result.governanceIndex.verdict).toBe("indexed");
  });

  it("a latest-open history is index-open (exit 3)", async () => {
    expect((await runFiles([closedGovernance(), openGovernance()])).exitCode).toBe(3);
  });

  it("a latest-blocked history is index-blocked (exit 4)", async () => {
    expect((await runFiles([closedGovernance(), blockedGovernance()])).exitCode).toBe(4);
  });

  it("a tampered bundle is index-blocked (exit 4); an unreadable is index-incomplete (exit 2)", async () => {
    expect((await runFiles([closedGovernance(), tamperedGovernance()])).exitCode).toBe(4);
    expect((await runFiles([closedGovernance(), notAGovernance()])).exitCode).toBe(2);
  });

  it("--strict-open escalates an open history to blocked (exit 4)", async () => {
    expect((await runFiles([closedGovernance(), openGovernance()], { strictOpen: true })).exitCode).toBe(4);
  });

  it("a missing file becomes an unreadable bundle — never throws, never echoes the path", async () => {
    const provider = {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionCloseoutGovernanceIndex(makeArgs([closedGovernance()]), provider);
    expect(run.exitCode).toBe(2); // all unreadable → no-governance → incomplete
    expect(run.output).not.toContain("governance-0");
  });

  it("reads a JSON array of bundles from stdin", async () => {
    const objs = [closedGovernance(), blockedGovernance()];
    const args = makeArgs([], { stdin: true, governancePaths: undefined });
    const provider = makeProvider([], JSON.stringify(objs));
    const run = await runReleaseDecisionCloseoutGovernanceIndex(args, provider);
    expect(run.exitCode).toBe(4);
    expect(run.result.ledger.governanceUsable).toBe(2);
  });

  it("a missing / empty stdin payload is index-incomplete, never a vacuous indexed", async () => {
    const args = makeArgs([], { stdin: true, governancePaths: undefined });
    const run = await runReleaseDecisionCloseoutGovernanceIndex(args, makeProvider([], ""));
    expect(run.exitCode).toBe(2);
    expect(run.result.governanceIndex.reasons).toContain("no-governance");
  });
});
