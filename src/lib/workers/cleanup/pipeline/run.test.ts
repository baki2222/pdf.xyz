// @vitest-environment node
/**
 * Unit proofs for the pipeline orchestrator over INJECTED stages (no spawn, no filesystem, no
 * cloud). It exercises every branch: both arms clean, each downstream verdict, the short-circuit
 * when a projection fails (the lens is never run on untrusted evidence), the fail-closed rollup,
 * and the content-free receipt + per-arm metric emission.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPipeline, type PipelineStages } from "./run";
import { setPipelineSink, resetPipelineSink } from "./metrics";
import { setPipelineObserver, resetPipelineObserverForTests } from "./receipt";
import type { PipelineReceipt } from "./types";
import type { WorkerMetricSample } from "../../observability/metrics";

const AT = "2026-07-03T00:00:00.000Z";

interface FakeConfig {
  projectEvidence?: { exitCode: number; projected?: string };
  projectInventory?: { exitCode: number; projected?: string };
  verify?: number;
  sweep?: number;
}

function makeStages(cfg: FakeConfig) {
  const calls = {
    project: [] as { target: string; rawText: string }[],
    verify: [] as string[],
    sweep: [] as string[],
  };
  const stages: PipelineStages = {
    project(target, rawText) {
      calls.project.push({ target, rawText });
      const c = target === "evidence" ? cfg.projectEvidence : cfg.projectInventory;
      return { exitCode: c?.exitCode ?? 0, projected: c?.projected ?? `PROJECTED:${target}` };
    },
    async verify(text) {
      calls.verify.push(text);
      return { exitCode: cfg.verify ?? 0 };
    },
    sweep(text) {
      calls.sweep.push(text);
      return { exitCode: cfg.sweep ?? 0 };
    },
  };
  return { stages, calls };
}

describe("runPipeline — arm composition + rollup", () => {
  it("both arms clean → exit 0 / ok, each lens fed its own projection", async () => {
    const { stages, calls } = makeStages({});
    const run = await runPipeline("RAW", stages, AT);
    expect(run.exitCode).toBe(0);
    expect(run.result.severity).toBe("ok");
    expect(run.result.arms).toEqual([
      { arm: "verify", code: 0, severity: "ok", projected: true },
      { arm: "sweep", code: 0, severity: "ok", projected: true },
    ]);
    expect(calls.project.map((c) => c.target)).toEqual(["evidence", "inventory"]);
    expect(calls.verify).toEqual(["PROJECTED:evidence"]);
    expect(calls.sweep).toEqual(["PROJECTED:inventory"]);
  });

  it("verify drift dominates a clean sweep → exit 3 / drift", async () => {
    const run = await runPipeline("RAW", makeStages({ verify: 3 }).stages, AT);
    expect(run.exitCode).toBe(3);
    expect(run.result.severity).toBe("drift");
    expect(run.result.arms[0]).toMatchObject({ arm: "verify", code: 3, severity: "drift" });
  });

  it("sweep breach dominates a clean verify → exit 4 / breach", async () => {
    const run = await runPipeline("RAW", makeStages({ sweep: 4 }).stages, AT);
    expect(run.exitCode).toBe(4);
    expect(run.result.severity).toBe("breach");
    expect(run.result.arms[1]).toMatchObject({ arm: "sweep", code: 4, severity: "breach" });
  });

  it("a failed EVIDENCE projection short-circuits the verify arm (lens never runs)", async () => {
    const { stages, calls } = makeStages({ projectEvidence: { exitCode: 2 } });
    const run = await runPipeline("RAW", stages, AT);
    expect(calls.verify).toEqual([]); // never fed an untrusted projection
    expect(run.result.arms[0]).toEqual({ arm: "verify", code: 2, severity: "unknown", projected: false });
    expect(run.exitCode).toBe(2); // unknown (sweep still clean)
  });

  it("a present-tombstoned (unsafe) INVENTORY projection short-circuits the sweep arm to breach", async () => {
    const { stages, calls } = makeStages({ projectInventory: { exitCode: 4 } });
    const run = await runPipeline("RAW", stages, AT);
    expect(calls.sweep).toEqual([]);
    expect(run.result.arms[1]).toEqual({ arm: "sweep", code: 4, severity: "breach", projected: false });
    expect(run.exitCode).toBe(4);
  });

  it("a malformed export (both projections usage) fails closed to exit 1 / usage, no lens runs", async () => {
    const { stages, calls } = makeStages({
      projectEvidence: { exitCode: 1 },
      projectInventory: { exitCode: 1 },
    });
    const run = await runPipeline("{ not json", stages, AT);
    expect(run.exitCode).toBe(1);
    expect(run.result.severity).toBe("usage");
    expect(calls.verify).toEqual([]);
    expect(calls.sweep).toEqual([]);
  });

  it("an unexpected downstream code folds to the usage band (fail closed, never 0)", async () => {
    const run = await runPipeline("RAW", makeStages({ verify: 7 }).stages, AT);
    expect(run.exitCode).toBe(1);
    expect(run.result.arms[0]).toMatchObject({ arm: "verify", code: 1, severity: "usage" });
  });
});

describe("runPipeline — output + receipt", () => {
  it("emits a stable, self-describing JSON document with an embedded receipt", async () => {
    const run = await runPipeline("RAW", makeStages({ verify: 3 }).stages, AT, "json");
    const doc = JSON.parse(run.output);
    expect(doc.tool).toBe("worker-cleanup-pipeline");
    expect(doc.schema).toBe("pdfxyz.cleanup-pipeline/1");
    expect(doc.dryRun).toBe(true);
    expect(doc.severity).toBe("drift");
    expect(doc.exitCode).toBe(3);
    expect(doc.receipt.category).toBe("cleanup-pipeline");
    expect(doc.receipt.policyId).toBe("pdfxyz-cleanup-evidence-pipeline");
    expect(doc.receipt.arms).toEqual(doc.arms);
  });

  it("renders a short human summary in text format", async () => {
    const run = await runPipeline("RAW", makeStages({ sweep: 4 }).stages, AT, "text");
    expect(run.output).toMatch(/cleanup pipeline \(dry-run, read-only\)/);
    expect(run.output).toMatch(/severity\s+breach/);
    expect(run.output).toMatch(/deletes nothing/i);
  });
});

describe("runPipeline — observability seams", () => {
  const samples: WorkerMetricSample[] = [];
  const receipts: PipelineReceipt[] = [];

  beforeEach(() => {
    samples.length = 0;
    receipts.length = 0;
    setPipelineSink((s) => samples.push(s));
    setPipelineObserver((r) => receipts.push(r));
  });
  afterEach(() => {
    resetPipelineSink();
    resetPipelineObserverForTests();
  });

  it("emits one bounded metric per arm and one receipt per run", async () => {
    await runPipeline("RAW", makeStages({ verify: 3, sweep: 4 }).stages, AT);
    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.metric)).toEqual([
      "worker_cleanup_pipeline_total",
      "worker_cleanup_pipeline_total",
    ]);
    expect(samples[0]!.labels).toEqual({ arm: "verify", severity: "drift" });
    expect(samples[1]!.labels).toEqual({ arm: "sweep", severity: "breach" });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.exitCode).toBe(4);
  });

  it("a throwing metric sink never breaks the run", async () => {
    setPipelineSink(() => {
      throw new Error("collector down");
    });
    const run = await runPipeline("RAW", makeStages({}).stages, AT);
    expect(run.exitCode).toBe(0); // still completed
  });
});
