import { describe, expect, it } from "vitest";
import { parseStdinWindows, runReleaseDecisionCloseoutIndexTrend } from "./run";
import {
  blockedIndex,
  indexedIndex,
  makeArgs,
  makeProvider,
  openIndex,
  tamperedIndex,
} from "./fixtures";

describe("runReleaseDecisionCloseoutIndexTrend — orchestration over injected seams", () => {
  it("resolves a clean history to trend-stable (exit 0) and renders it", async () => {
    const objs = [indexedIndex(), indexedIndex()];
    const run = await runReleaseDecisionCloseoutIndexTrend(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.closeoutIndexTrend.verdict).toBe("trend-stable");
    expect(JSON.parse(run.output).schema).toBe("pdfxyz.release-decision-closeout-index-trend/1");
  });

  it("maps each verdict band to its exit code", async () => {
    const cases: [unknown[], number][] = [
      [[indexedIndex(), openIndex()], 3],
      [[indexedIndex(), blockedIndex()], 4],
      [[indexedIndex(), tamperedIndex()], 4],
      [[], 2],
    ];
    for (const [objs, code] of cases) {
      const run = await runReleaseDecisionCloseoutIndexTrend(makeArgs(objs), makeProvider(objs));
      expect(run.exitCode, `history ${JSON.stringify(objs.length)}`).toBe(code);
    }
  });

  it("an unreadable file becomes an unreadable window (never throws, path never echoed)", async () => {
    const provider = {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const args = makeArgs([indexedIndex()]); // one path, but the provider always rejects
    const run = await runReleaseDecisionCloseoutIndexTrend(args, provider);
    expect(run.result.summary.indexesUnreadable).toBe(1);
    expect(run.exitCode).toBe(2); // trend-incomplete
  });

  it("reads a JSON array and an NDJSON stream from stdin", async () => {
    const arr = JSON.stringify([indexedIndex(), blockedIndex()]);
    const arrRun = await runReleaseDecisionCloseoutIndexTrend(
      makeArgs([], { stdin: true, indexPaths: undefined }),
      makeProvider([], arr),
    );
    expect(arrRun.result.closeoutIndexTrend.verdict).toBe("trend-blocked");

    const nd = [indexedIndex(), indexedIndex()].map((o) => JSON.stringify(o)).join("\n");
    const ndRun = await runReleaseDecisionCloseoutIndexTrend(
      makeArgs([], { stdin: true, indexPaths: undefined }),
      makeProvider([], nd),
    );
    expect(ndRun.result.summary.indexesUsable).toBe(2);
  });
});

describe("parseStdinWindows", () => {
  it("accepts an array, a single object, and NDJSON; a blank payload is empty", () => {
    expect(parseStdinWindows("")).toEqual([]);
    expect(parseStdinWindows("   \n  ")).toEqual([]);
    expect(parseStdinWindows('[{"a":1},{"b":2}]')).toHaveLength(2);
    expect(parseStdinWindows('{"a":1}')).toHaveLength(1);
    expect(parseStdinWindows('{"a":1}\n{"b":2}')).toHaveLength(2);
  });

  it("a malformed NDJSON line becomes one unreadable root (the raw line is passed, never echoed downstream)", () => {
    const roots = parseStdinWindows('{"a":1}\nnot json\n{"b":2}');
    expect(roots).toHaveLength(3);
    expect(roots[1]).toBe("not json"); // a non-object → the ingest boundary drops it
  });
});
