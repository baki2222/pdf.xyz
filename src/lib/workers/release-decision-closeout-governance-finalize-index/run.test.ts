import { describe, expect, it } from "vitest";
import { parseStdinFinalize, runReleaseDecisionCloseoutGovernanceFinalizeIndex } from "./run";
import {
  blockedFinalize,
  finalizedFinalize,
  makeArgs,
  makeProvider,
  openFinalize,
  tamperedFinalize,
} from "./fixtures";

describe("parseStdinFinalize", () => {
  it("parses a JSON array of bundles", () => {
    expect(parseStdinFinalize(JSON.stringify([{ a: 1 }, { b: 2 }]))).toHaveLength(2);
  });
  it("wraps a single JSON object as a one-element history", () => {
    expect(parseStdinFinalize(JSON.stringify({ a: 1 }))).toEqual([{ a: 1 }]);
  });
  it("falls back to NDJSON (one bundle per non-blank line)", () => {
    const nd = `${JSON.stringify({ a: 1 })}\n\n${JSON.stringify({ b: 2 })}\n`;
    expect(parseStdinFinalize(nd)).toHaveLength(2);
  });
  it("a corrupt NDJSON line becomes one (unreadable) element, never a throw", () => {
    const nd = `${JSON.stringify({ a: 1 })}\nnot json\n`;
    const roots = parseStdinFinalize(nd);
    expect(roots).toHaveLength(2);
    expect(roots[1]).toBe("not json");
  });
  it("a blank payload is an empty history", () => {
    expect(parseStdinFinalize("   \n  ")).toEqual([]);
  });
});

describe("runReleaseDecisionCloseoutGovernanceFinalizeIndex — file mode", () => {
  it("a coherent all-finalized history → indexed (exit 0)", async () => {
    const objs = [finalizedFinalize(), finalizedFinalize()];
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndex(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("indexed");
  });

  it("a latest-open history → index-open (exit 3)", async () => {
    const objs = [finalizedFinalize(), openFinalize()];
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndex(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(3);
  });

  it("a blocked history → index-blocked (exit 4)", async () => {
    const objs = [finalizedFinalize(), blockedFinalize()];
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndex(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("index-blocked");
  });

  it("a tampered bundle → index-invalid (exit 4), never a fabricated indexed", async () => {
    const objs = [finalizedFinalize(), tamperedFinalize()];
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndex(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(4);
    expect(run.result.verdict).toBe("index-invalid");
    expect(run.result.finalizeIndex.reasons).toContain("finalization-tampered");
  });

  it("an unreadable file (read throws) → index-invalid (exit 4), path never echoed", async () => {
    const provider = {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const args = makeArgs([], { finalizationPaths: ["/secret/missing.json"] });
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndex(args, provider);
    expect(run.result.verdict).toBe("index-invalid");
    expect(run.output).not.toContain("/secret/missing.json");
  });
});

describe("runReleaseDecisionCloseoutGovernanceFinalizeIndex — stdin mode", () => {
  it("reads a JSON array of bundles from stdin", async () => {
    const objs = [finalizedFinalize(), blockedFinalize()];
    const args = makeArgs([], { stdin: true, finalizationPaths: undefined });
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndex(args, makeProvider([], JSON.stringify(objs)));
    expect(run.result.verdict).toBe("index-blocked");
  });

  it("an empty stdin payload → index-incomplete (exit 2), never a vacuous indexed", async () => {
    const args = makeArgs([], { stdin: true, finalizationPaths: undefined });
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndex(args, makeProvider([], ""));
    expect(run.exitCode).toBe(2);
    expect(run.result.finalizeIndex.reasons).toContain("no-finalizations");
  });
});
