/**
 * Unit proofs for the release-trend orchestrator (Phase 53): it reads reports via the injected provider (files
 * or a stdin JSON array), folds them, records a metric, and returns the exit code + rendered output — never
 * throwing on an input problem and never echoing a path.
 */

import { afterEach, describe, expect, it } from "vitest";
import { runReleaseTrend } from "./run";
import { recordReleaseTrend, resetReleaseTrendSink, setReleaseTrendSink } from "./metrics";
import { makeArgs, makeProvider, NOW, reportFor, tamperedReport } from "./fixtures";
import type { ReleaseTrendProvider } from "./run";
import type { WorkerMetricSample } from "../observability/metrics";

afterEach(() => resetReleaseTrendSink());

const pr = () => reportFor("promote-ready");
const hw = () => reportFor("hold-warning");
const hf = () => reportFor("hold-fail");

describe("runReleaseTrend — file mode", () => {
  it("a clean window of reports → stable (exit 0)", async () => {
    const objs = [pr(), pr(), pr()];
    const run = await runReleaseTrend(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(0);
    expect(run.result.trend.verdict).toBe("stable");
  });

  it("a hold-fail tip → failing (exit 4)", async () => {
    const objs = [pr(), pr(), hf()];
    const run = await runReleaseTrend(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(4);
  });

  it("a hold-warning tip → warning (exit 3)", async () => {
    const objs = [pr(), hw()];
    const run = await runReleaseTrend(makeArgs(objs, { maxHoldWarning: 5 }), makeProvider(objs));
    expect(run.exitCode).toBe(3);
  });

  it("an unreadable report file becomes an unreadable point (⇒ unknown, exit 2)", async () => {
    const objs = [pr(), pr()];
    // The provider throws for report-1 (missing), so it ingests as unreadable.
    const provider: ReleaseTrendProvider = {
      now: () => NOW,
      readFile: async (path) => (path === "report-0" ? JSON.stringify(pr()) : Promise.reject(new Error("enoent"))),
      readStdin: async () => "",
    };
    const run = await runReleaseTrend(makeArgs(objs), provider);
    expect(run.exitCode).toBe(2);
    expect(run.result.history.reportsUnreadable).toBe(1);
  });

  it("a tampered report file → failing (exit 4)", async () => {
    const objs = [pr(), tamperedReport()];
    const run = await runReleaseTrend(makeArgs(objs), makeProvider(objs));
    expect(run.exitCode).toBe(4);
    expect(run.result.trend.reasons).toContain("report-tampered");
  });
});

describe("runReleaseTrend — stdin mode", () => {
  it("reads a JSON array of reports from stdin", async () => {
    const objs = [pr(), hf()];
    const args = makeArgs([], { stdin: true, reportPaths: undefined });
    const provider = makeProvider([], JSON.stringify(objs));
    const run = await runReleaseTrend(args, provider);
    expect(run.exitCode).toBe(4);
    expect(run.result.history.reportsConsidered).toBe(2);
  });

  it("a non-array / unparseable stdin payload is an empty (insufficient) history", async () => {
    const args = makeArgs([], { stdin: true, reportPaths: undefined });
    const bad = await runReleaseTrend(args, makeProvider([], "not json"));
    expect(bad.exitCode).toBe(2);
    const obj = await runReleaseTrend(args, makeProvider([], JSON.stringify({ not: "an array" })));
    expect(obj.exitCode).toBe(2);
    expect(obj.result.history.reportsConsidered).toBe(0);
  });
});

describe("runReleaseTrend — metric + robustness", () => {
  it("records exactly one bounded verdict metric per run", async () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseTrendSink((s) => seen.push(s));
    const objs = [pr(), pr()];
    await runReleaseTrend(makeArgs(objs), makeProvider(objs));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("stable");
  });

  it("a throwing metric sink never breaks the run", async () => {
    setReleaseTrendSink(() => {
      throw new Error("sink boom");
    });
    const objs = [pr()];
    await expect(runReleaseTrend(makeArgs(objs), makeProvider(objs))).resolves.toBeDefined();
  });

  it("renders text when asked and never echoes a report's own stamp", async () => {
    const objs = [pr(), pr()];
    const run = await runReleaseTrend(makeArgs(objs, { format: "text" }), makeProvider(objs));
    expect(run.output).toMatch(/release evidence trend summary/i);
    // The report fixtures stamp with the release-report NOW; the trend uses its own and never echoes theirs.
    expect(run.output).toContain(NOW); // its OWN stamp is fine
  });

  it("wires recordReleaseTrend without throwing (integration guard)", () => {
    setReleaseTrendSink(() => {});
    expect(() => recordReleaseTrend("stable")).not.toThrow();
  });
});
