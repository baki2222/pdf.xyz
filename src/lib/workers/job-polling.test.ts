// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Job } from "@/lib/jobs/types";
import { pollJobToTerminal, type PollFetch } from "./job-polling";

/**
 * These assertions exist because the loop they cover ran in production for
 * months in a shape where a single dropped packet threw away a finished file.
 * Each one fails on the code that shipped before this module:
 *   - the retry tests: the old loop returned on the FIRST non-2xx
 *   - the totality test: the old loop let a rejected `fetch` escape, and the
 *     panels had no `catch` and no `finally`, so the spinner never stopped
 *   - the job-id tests: the old timeout dropped `job.jobId` on the floor
 */

const RUNNING: Job = { jobId: "j_123", status: "running" } as unknown as Job;
const DONE: Job = { jobId: "j_123", status: "completed" } as unknown as Job;

/** No real waiting: the loop's timing is injected precisely so tests are fast. */
const noSleep = async () => {};

/** A `fetch` that replays a scripted sequence of outcomes, one per call. */
function scriptedFetch(
  steps: (
    | { kind: "reject" }
    | { kind: "status"; status: number }
    | { kind: "job"; job: Job }
    | { kind: "badBody" }
  )[],
): { impl: PollFetch; calls: () => number } {
  let i = 0;
  const impl: PollFetch = async () => {
    const step = steps[Math.min(i, steps.length - 1)]!;
    i += 1;
    if (step.kind === "reject") throw new TypeError("Failed to fetch");
    if (step.kind === "status") {
      return { ok: false, status: step.status, json: async () => ({}) };
    }
    if (step.kind === "badBody") {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      };
    }
    return { ok: true, status: 200, json: async () => step.job };
  };
  return { impl, calls: () => i };
}

const base = {
  job: RUNNING,
  pollIntervalMs: 10,
  maxPollAttempts: 20,
  sleepImpl: noSleep,
};

describe("pollJobToTerminal", () => {
  it("survives a transient blip and still returns the finished job", async () => {
    // The exact scenario that used to destroy a successful run: one 502, then
    // the job completes normally.
    const { impl } = scriptedFetch([
      { kind: "status", status: 502 },
      { kind: "job", job: DONE },
    ]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.job.status).toBe("completed");
  });

  it("survives a dropped connection, which fetch reports by throwing", async () => {
    const { impl } = scriptedFetch([
      { kind: "reject" },
      { kind: "reject" },
      { kind: "job", job: DONE },
    ]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(true);
  });

  it("never throws, however badly the network behaves", async () => {
    // The contract the panels rely on. Before this module the rejection escaped
    // all the way out of the panel's `start()`, `setBusy(false)` never ran, and
    // the button spun forever showing no error whatsoever.
    const { impl } = scriptedFetch([{ kind: "reject" }]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/lost contact/i);
      // Not the raw exception. "Failed to fetch" is not something to show a user.
      expect(result.message).not.toMatch(/TypeError|Failed to fetch/);
    }
  });

  it("gives up only after repeated consecutive failures", async () => {
    const { impl, calls } = scriptedFetch([{ kind: "status", status: 503 }]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(false);
    expect(calls()).toBe(3);
  });

  it("treats a good read as forgiveness, so scattered blips never accumulate", async () => {
    // Two blips separated by a success are not three in a row. A budget that
    // never reset would kill any sufficiently long job on a flaky connection.
    const { impl } = scriptedFetch([
      { kind: "status", status: 502 },
      { kind: "status", status: 502 },
      { kind: "job", job: RUNNING },
      { kind: "status", status: 502 },
      { kind: "status", status: 502 },
      { kind: "job", job: DONE },
    ]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(true);
  });

  it("does not retry a request the server says is wrong", async () => {
    // Retrying an unchanged 404 only delays an honest answer.
    const { impl, calls } = scriptedFetch([{ kind: "status", status: 404 }]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stillRunning).toBe(false);
    expect(calls()).toBe(1);
  });

  it("names the job it gave up on, when it gives up on time", async () => {
    // The defect this pins: the old loop had `job.jobId` in scope and dropped
    // it, so a job that finished moments later was unreachable forever.
    const { impl } = scriptedFetch([{ kind: "job", job: RUNNING }]);
    const result = await pollJobToTerminal({
      ...base,
      fetchImpl: impl,
      maxPollAttempts: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.jobId).toBe("j_123");
      expect(result.stillRunning).toBe(true);
    }
  });

  it("names the job it gave up on, when it gives up on the network", async () => {
    const { impl } = scriptedFetch([{ kind: "reject" }]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.jobId).toBe("j_123");
      expect(result.stillRunning).toBe(true);
    }
  });

  it("recovers from a 200 whose body cannot be read", async () => {
    const { impl } = scriptedFetch([
      { kind: "badBody" },
      { kind: "job", job: DONE },
    ]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(true);
  });

  it("reports a cancel as a cancel, not as a fault to retry", async () => {
    const controller = new AbortController();
    controller.abort();
    const { impl, calls } = scriptedFetch([{ kind: "reject" }]);
    const result = await pollJobToTerminal({
      ...base,
      fetchImpl: impl,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/canceled/i);
      expect(result.stillRunning).toBe(false);
    }
    expect(calls()).toBe(1);
  });

  it("returns a terminal job without polling at all", async () => {
    // local-dev is already terminal on create; it must not sleep or fetch.
    const { impl, calls } = scriptedFetch([{ kind: "reject" }]);
    const result = await pollJobToTerminal({
      ...base,
      job: DONE,
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    expect(calls()).toBe(0);
  });

  it("hands back a failed job as a reached answer, not as a poll failure", async () => {
    // `ok: true` means "we got an answer", not "the answer was good" — callers
    // keep their own job-level error handling.
    const failed = { jobId: "j_123", status: "failed" } as unknown as Job;
    const { impl } = scriptedFetch([{ kind: "job", job: failed }]);
    const result = await pollJobToTerminal({ ...base, fetchImpl: impl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.job.status).toBe("failed");
  });
});
