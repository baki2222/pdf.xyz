import { describe, expect, it } from "vitest";
import {
  parseStdinWindows,
  runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrend,
} from "./run";
import { blockedWindow, allClosedWindow, invalidWindow, makeArgs, makeProvider, openWindow, tamperedWindow } from "./fixtures";

describe("runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrend — orchestration over injected seams", () => {
  it("resolves a clean history to stable (exit 0) and renders it", async () => {
    const objs = [allClosedWindow(), allClosedWindow()];
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrend(
      makeArgs(objs),
      makeProvider(objs),
    );
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("stable");
    expect(JSON.parse(run.output).schema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1",
    );
  });

  it("maps each verdict band to its exit code", async () => {
    const table: Array<[readonly unknown[], number]> = [
      [[openWindow(), allClosedWindow()], 0], // improving
      [[allClosedWindow(), openWindow()], 3], // degrading
      [[allClosedWindow(), blockedWindow()], 4], // blocked
      [[allClosedWindow(), invalidWindow()], 4], // blocked (usable invalid window)
      [[allClosedWindow(), tamperedWindow()], 4], // invalid (tampered input)
      [[], 2], // insufficient
    ];
    for (const [objs, code] of table) {
      const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrend(
        makeArgs(objs),
        makeProvider(objs),
      );
      expect(run.exitCode, `history len ${objs.length}`).toBe(code);
    }
  }, 20_000);

  it("an unreadable file becomes an unreadable window (never throws, path never echoed)", async () => {
    const provider = {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrend(
      makeArgs([allClosedWindow()]),
      provider,
    );
    expect(run.result.coverage.indexesUnreadable).toBe(1);
    expect(run.exitCode).toBe(4); // invalid (an unreadable window is untrustworthy input)
  });

  it("reads a JSON array and an NDJSON stream from stdin", async () => {
    const arr = JSON.stringify([allClosedWindow(), blockedWindow()]);
    const arrRun = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrend(
      makeArgs([], { stdin: true, indexPaths: undefined }),
      makeProvider([], arr),
    );
    expect(arrRun.result.verdict).toBe("blocked");

    const nd = [allClosedWindow(), allClosedWindow()].map((o) => JSON.stringify(o)).join("\n");
    const ndRun = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrend(
      makeArgs([], { stdin: true, indexPaths: undefined }),
      makeProvider([], nd),
    );
    expect(ndRun.result.coverage.indexesUsable).toBe(2);
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
    expect(roots[1]).toBe("not json");
  });
});
