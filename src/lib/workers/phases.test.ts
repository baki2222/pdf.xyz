// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Job, JobStatus } from "@/lib/jobs/types";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";
import { pollJobToTerminal, type PollFetch } from "./job-polling";
import {
  JOB_PHASES,
  phaseOfStatus,
  stageForPhase,
  type JobPhase,
} from "./phases";

/**
 * The docket (`LiveStages`) stamps a stage only when a phase that maps to it
 * was OBSERVED. These hold the map to the stage lists it indexes, in both
 * directions, so a renamed stage id cannot leave a phase pointing at nothing
 * (the docket would then show a live job as never starting) and a new stage
 * cannot ship that no phase can ever reach.
 */

const FILE_TOOL = getToolBySlug("protect-pdf")!;
const AI_TOOL = getToolBySlug("summarize-pdf")!;
const URL_TOOL = getToolBySlug("webpage-to-pdf")!;

const PIPELINES = {
  "scan active": workerPipelineStages(true, FILE_TOOL),
  "scan off": workerPipelineStages(false, FILE_TOOL),
  "scan unknown": workerPipelineStages(null, FILE_TOOL),
  "ai, scan active": workerPipelineStages(true, AI_TOOL),
  "ai, scan off": workerPipelineStages(false, AI_TOOL),
};

describe("phases → stages", () => {
  it("health: the phase list and every pipeline are non-trivial", () => {
    expect(JOB_PHASES.length).toBeGreaterThanOrEqual(9);
    for (const stages of Object.values(PIPELINES))
      expect(stages.length).toBe(5);
  });

  for (const [name, stages] of Object.entries(PIPELINES)) {
    it(`${name}: every phase's stage is in the list (phase → stage)`, () => {
      const ids = new Set(stages.map((s) => s.id));
      for (const phase of JOB_PHASES) {
        const stage = stageForPhase(phase, stages);
        if (stage !== null) expect(ids, phase).toContain(stage);
      }
    });

    it(`${name}: every stage but delete is reached by some phase (stage → phase)`, () => {
      const reached = new Set(
        JOB_PHASES.map((p) => stageForPhase(p, stages)).filter(Boolean),
      );
      const unreached = stages
        .map((s) => s.id)
        .filter((id) => id !== "delete" && !reached.has(id));
      expect(unreached).toEqual([]);
    });
  }

  it("never produces delete — for any phase, on any pipeline", () => {
    const all = [
      ...Object.values(PIPELINES),
      workerPipelineStages(null, URL_TOOL),
    ];
    for (const stages of all)
      for (const phase of JOB_PHASES)
        expect(stageForPhase(phase, stages)).not.toBe("delete");
  });

  it("positive control: delete IS a stage, so the check above can see it", () => {
    for (const stages of Object.values(PIPELINES))
      expect(stages.map((s) => s.id)).toContain("delete");
  });

  it("the URL pipeline: its address check is never observed, everything after it is", () => {
    const stages = workerPipelineStages(null, URL_TOOL);
    const reached = new Set(JOB_PHASES.map((p) => stageForPhase(p, stages)));
    expect(reached.has("address")).toBe(false);
    expect(reached.has("process")).toBe(true);
    expect(reached.has("download")).toBe(true);
  });
});

describe("each phase fires once per distinct status, in order", () => {
  const job = (status: JobStatus): Job =>
    ({ jobId: "job_abc", status }) as unknown as Job;

  it("pollJobToTerminal reports a status once when it changes, never on a repeat", async () => {
    const replies: JobStatus[] = [
      "queued",
      "scanning",
      "scanning",
      "processing",
      "processing",
      "processing",
      "completed",
    ];
    let i = 0;
    const fetchImpl: PollFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => job(replies[Math.min(i++, replies.length - 1)]!),
    });
    const statuses: JobStatus[] = [];
    const result = await pollJobToTerminal({
      job: job("queued"),
      fetchImpl,
      pollIntervalMs: 1,
      maxPollAttempts: 20,
      sleepImpl: async () => {},
      onStatus: (s) => statuses.push(s),
    });
    expect(result.ok).toBe(true);
    expect(statuses).toEqual(["queued", "scanning", "processing", "completed"]);
  });

  it("phaseOfStatus: the job record's statuses become phases in pipeline order", () => {
    const order: JobPhase[] = (
      ["queued", "scanning", "processing", "completed"] as JobStatus[]
    ).map(phaseOfStatus);
    expect(order).toEqual(["queued", "scanning", "processing", "done"]);
    for (const terminal of ["failed", "expired", "canceled"] as JobStatus[])
      expect(phaseOfStatus(terminal)).toBe("failed");
  });
});
