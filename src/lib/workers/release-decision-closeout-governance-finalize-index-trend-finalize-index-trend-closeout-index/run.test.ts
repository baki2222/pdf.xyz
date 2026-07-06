import { describe, expect, it } from "vitest";
import {
  parseStdinCloseouts,
  runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndex as run,
} from "./run";
import { blockedCloseout, closedCloseout, makeArgs, makeProvider, openCloseout, tamperedCloseout } from "./fixtures";

describe("parseStdinCloseouts", () => {
  it("parses a JSON array of records", () => {
    expect(parseStdinCloseouts(JSON.stringify([{ a: 1 }, { b: 2 }]))).toHaveLength(2);
  });
  it("wraps a single JSON object as a one-element history", () => {
    expect(parseStdinCloseouts(JSON.stringify({ a: 1 }))).toEqual([{ a: 1 }]);
  });
  it("falls back to NDJSON (one record per non-blank line)", () => {
    const nd = `${JSON.stringify({ a: 1 })}\n\n${JSON.stringify({ b: 2 })}\n`;
    expect(parseStdinCloseouts(nd)).toHaveLength(2);
  });
  it("a corrupt NDJSON line becomes one (unreadable) element, never a throw", () => {
    const nd = `${JSON.stringify({ a: 1 })}\nnot json\n`;
    const roots = parseStdinCloseouts(nd);
    expect(roots).toHaveLength(2);
    expect(roots[1]).toBe("not json");
  });
  it("a blank payload is an empty history", () => {
    expect(parseStdinCloseouts("   \n  ")).toEqual([]);
  });
});

describe("run — file mode", () => {
  it("a coherent all-closed history → indexed (exit 0)", async () => {
    const objs = [closedCloseout(), closedCloseout()];
    const r = await run(makeArgs(objs), makeProvider(objs));
    expect(r.exitCode).toBe(0);
    expect(r.result.verdict).toBe("indexed");
  });

  it("a latest-open history → index-open (exit 3)", async () => {
    const objs = [closedCloseout(), openCloseout()];
    const r = await run(makeArgs(objs), makeProvider(objs));
    expect(r.exitCode).toBe(3);
  });

  it("a blocked history → index-blocked (exit 4)", async () => {
    const objs = [closedCloseout(), blockedCloseout()];
    const r = await run(makeArgs(objs), makeProvider(objs));
    expect(r.exitCode).toBe(4);
    expect(r.result.verdict).toBe("index-blocked");
  });

  it("a tampered record → index-invalid (exit 4), never a fabricated indexed", async () => {
    const objs = [closedCloseout(), tamperedCloseout()];
    const r = await run(makeArgs(objs), makeProvider(objs));
    expect(r.exitCode).toBe(4);
    expect(r.result.verdict).toBe("index-invalid");
    expect(r.result.closeoutIndex.reasons).toContain("closeout-tampered");
  });

  it("an unreadable file (read throws) → index-invalid (exit 4), path never echoed", async () => {
    const provider = {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const args = makeArgs([], { closeoutPaths: ["/secret/missing.json"] });
    const r = await run(args, provider);
    expect(r.result.verdict).toBe("index-invalid");
    expect(r.output).not.toContain("/secret/missing.json");
  });
});

describe("run — stdin mode", () => {
  it("reads a JSON array of records from stdin", async () => {
    const objs = [closedCloseout(), blockedCloseout()];
    const args = makeArgs([], { stdin: true, closeoutPaths: undefined });
    const r = await run(args, makeProvider([], JSON.stringify(objs)));
    expect(r.result.verdict).toBe("index-blocked");
  });

  it("an empty stdin payload → index-incomplete (exit 2), never a vacuous indexed", async () => {
    const args = makeArgs([], { stdin: true, closeoutPaths: undefined });
    const r = await run(args, makeProvider([], ""));
    expect(r.exitCode).toBe(2);
    expect(r.result.closeoutIndex.reasons).toContain("no-closeouts");
  });
});
