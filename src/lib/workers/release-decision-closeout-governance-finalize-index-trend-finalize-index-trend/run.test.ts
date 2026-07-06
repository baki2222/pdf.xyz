import { describe, expect, it } from "vitest";
import { parseStdinWindows, runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend } from "./run";
import { blockedWindow, indexedWindow, invalidWindow, makeArgs, makeProvider, openWindow, tamperedWindow } from "./fixtures";

describe("runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend — orchestration over injected seams", () => {
  it("resolves a clean history to stable (exit 0) and renders it", async () => {
    const objs = [indexedWindow(), indexedWindow()];
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.verdict).toBe("stable");
    expect(JSON.parse(run.output).schema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1");
  });

  it("maps each verdict band to its exit code", async () => {
    const table: Array<[readonly unknown[], number]> = [
      [[openWindow(), indexedWindow()], 0], // improving
      [[indexedWindow(), openWindow()], 3], // degrading
      [[indexedWindow(), blockedWindow()], 4], // blocked
      [[indexedWindow(), invalidWindow()], 4], // blocked (usable index-invalid window)
      [[indexedWindow(), tamperedWindow()], 4], // invalid (tampered input)
      [[], 2], // insufficient
    ];
    for (const [objs, code] of table) {
      const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(makeArgs(objs), makeProvider(objs));
      expect(run.exitCode, `history len ${objs.length}`).toBe(code);
    }
  }, 15_000);

  it("an unreadable file becomes an unreadable window (never throws, path never echoed)", async () => {
    const provider = {
      now: () => "2026-07-05T00:00:00.000Z",
      readFile: async () => Promise.reject(new Error("enoent")),
      readStdin: async () => "",
    };
    const run = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(makeArgs([indexedWindow()]), provider);
    expect(run.result.coverage.windowsUnreadable).toBe(1);
    expect(run.exitCode).toBe(4); // invalid (an unreadable window is untrustworthy input)
  });

  it("reads a JSON array and an NDJSON stream from stdin", async () => {
    const arr = JSON.stringify([indexedWindow(), blockedWindow()]);
    const arrRun = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(
      makeArgs([], { stdin: true, indexPaths: undefined }),
      makeProvider([], arr),
    );
    expect(arrRun.result.verdict).toBe("blocked");

    const nd = [indexedWindow(), indexedWindow()].map((o) => JSON.stringify(o)).join("\n");
    const ndRun = await runReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrend(
      makeArgs([], { stdin: true, indexPaths: undefined }),
      makeProvider([], nd),
    );
    expect(ndRun.result.coverage.windowsUsable).toBe(2);
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
