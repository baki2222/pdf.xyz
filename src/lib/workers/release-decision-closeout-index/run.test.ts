import { describe, expect, it } from "vitest";
import { parseStdinCloseouts, runReleaseDecisionCloseoutIndex } from "./run";
import {
  blockedCloseout,
  closedCloseout,
  makeArgs,
  makeProvider,
  notACloseout,
  openCloseout,
  tamperedCloseout,
} from "./fixtures";

describe("parseStdinCloseouts", () => {
  it("accepts a JSON array, a single object, and an NDJSON stream", () => {
    expect(parseStdinCloseouts("[]")).toEqual([]);
    expect(parseStdinCloseouts(JSON.stringify([{ a: 1 }, { b: 2 }]))).toHaveLength(2);
    expect(parseStdinCloseouts(JSON.stringify({ a: 1 }))).toHaveLength(1);
    const nd = `${JSON.stringify({ a: 1 })}\n\n${JSON.stringify({ b: 2 })}\n`;
    expect(parseStdinCloseouts(nd)).toHaveLength(2);
    expect(parseStdinCloseouts("   ")).toEqual([]);
  });

  it("a malformed NDJSON line becomes one unrecognized root (never a throw)", () => {
    const roots = parseStdinCloseouts(`${JSON.stringify({ a: 1 })}\nnot-json\n`);
    expect(roots).toHaveLength(2);
  });
});

describe("runReleaseDecisionCloseoutIndex — end to end over seams", () => {
  const runFiles = (objs: unknown[], over = {}) =>
    runReleaseDecisionCloseoutIndex(makeArgs(objs, over), makeProvider(objs));

  it("a coherent history is indexed (exit 0)", async () => {
    const r = await runFiles([closedCloseout(), closedCloseout()]);
    expect(r.exitCode).toBe(0);
    expect(r.result.closeoutIndex.verdict).toBe("indexed");
  });

  it("a latest-open history is index-open (exit 3)", async () => {
    expect((await runFiles([closedCloseout(), openCloseout()])).exitCode).toBe(3);
  });

  it("a latest-blocked history is index-blocked (exit 4)", async () => {
    expect((await runFiles([closedCloseout(), blockedCloseout()])).exitCode).toBe(4);
  });

  it("a tampered closeout is index-blocked (exit 4); an unreadable is index-incomplete (exit 2)", async () => {
    expect((await runFiles([closedCloseout(), tamperedCloseout()])).exitCode).toBe(4);
    expect((await runFiles([closedCloseout(), notACloseout()])).exitCode).toBe(2);
  });

  it("--strict-open escalates an open history to blocked (exit 4)", async () => {
    expect((await runFiles([closedCloseout(), openCloseout()], { strictOpen: true })).exitCode).toBe(4);
  });

  it("a missing file becomes an unreadable closeout — never throws, never echoes the path", async () => {
    const provider = {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionCloseoutIndex(makeArgs([closedCloseout()]), provider);
    expect(run.exitCode).toBe(2); // all unreadable → no-closeouts → incomplete
    expect(run.output).not.toContain("closeout-0");
  });

  it("reads a JSON array of closeouts from stdin", async () => {
    const objs = [closedCloseout(), blockedCloseout()];
    const args = makeArgs([], { stdin: true, closeoutPaths: undefined });
    const provider = makeProvider([], JSON.stringify(objs));
    const run = await runReleaseDecisionCloseoutIndex(args, provider);
    expect(run.exitCode).toBe(4);
    expect(run.result.ledger.closeoutsUsable).toBe(2);
  });

  it("a missing / empty stdin payload is index-incomplete, never a vacuous indexed", async () => {
    const args = makeArgs([], { stdin: true, closeoutPaths: undefined });
    const run = await runReleaseDecisionCloseoutIndex(args, makeProvider([], ""));
    expect(run.exitCode).toBe(2);
    expect(run.result.closeoutIndex.reasons).toContain("no-closeouts");
  });
});
