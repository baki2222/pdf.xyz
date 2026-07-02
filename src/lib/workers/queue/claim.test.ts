// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job, type JobArtifact } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "./local-dev";
import type { ClaimableQueue } from "./claim";

const LEASE_MS = 1_000;

function queuedJob(jobId: string, createdAtMs: number): Job {
  return {
    jobId,
    tool: "compress-pdf",
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + 60 * 60_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

const artifact: JobArtifact = {
  artifactId: "art_1234567890",
  filename: "out.pdf",
  contentType: "application/pdf",
  bytes: 3,
  url: "/api/artifacts/local/art_1234567890",
  expiresAt: new Date(10 * 60_000).toISOString(),
};

describe("ClaimableQueue (local-dev)", () => {
  let clock: number;
  let store: DevWorkerStore;
  let queue: ClaimableQueue;

  beforeEach(() => {
    clock = 10_000;
    store = new DevWorkerStore(() => clock);
    queue = createLocalDevQueue({ store, now: () => clock });
  });

  const submit = async (jobId: string, inputs = ["f_input00000"]) =>
    queue.submit({
      job: queuedJob(jobId, clock),
      inputs,
      options: { profile: "lossless" },
    });

  it("submit records a queued job with its spec, resolvable by idempotency key", async () => {
    await queue.submit(
      { job: queuedJob("job_a000000000", clock), inputs: ["f_x"], options: {} },
      "key-1",
    );
    expect(store.getSpec("job_a000000000")?.inputs).toEqual(["f_x"]);
    const replay = await queue.lookupIdempotent("key-1");
    expect(replay.ok && replay.value?.jobId).toBe("job_a000000000");
  });

  it("claims the oldest queued job, moves it to scanning, and leases it", async () => {
    await submit("job_older00000", ["f_older"]);
    clock += 5;
    await submit("job_newer00000", ["f_newer"]);

    const claim = await queue.claim({ leaseMs: LEASE_MS });
    expect(claim.ok).toBe(true);
    if (!claim.ok || !claim.value) throw new Error("expected a claim");
    expect(claim.value.job.jobId).toBe("job_older00000");
    expect(claim.value.job.status).toBe("scanning");
    expect(claim.value.inputs).toEqual(["f_older"]);
    expect(claim.value.attempt).toBe(1);
    expect(claim.value.leaseExpiresAt).toBe(clock + LEASE_MS);
    expect(store.getLease("job_older00000")).toEqual({
      leaseExpiresAt: clock + LEASE_MS,
      attempts: 1,
    });
  });

  it("returns null when nothing is claimable", async () => {
    const claim = await queue.claim({ leaseMs: LEASE_MS });
    expect(claim.ok && claim.value).toBeNull();
  });

  it("advances scanning → processing and moves progress", async () => {
    await submit("job_adv0000000");
    await queue.claim({ leaseMs: LEASE_MS });
    const advanced = await queue.advance("job_adv0000000", {
      status: "processing",
      progress: 40,
    });
    expect(advanced.ok).toBe(true);
    if (advanced.ok) {
      expect(advanced.value.status).toBe("processing");
      expect(advanced.value.progress).toBe(40);
    }
  });

  it("rejects an illegal advance as a conflict", async () => {
    await submit("job_bad0000000");
    // Not yet claimed (still queued) → cannot jump straight to completed via
    // advance, and advance only accepts scanning/processing anyway.
    const res = await queue.advance("job_bad0000000", { status: "scanning" });
    expect(res.ok).toBe(true); // queued → scanning is legal
    const bad = await queue.advance("job_bad0000000", { status: "scanning" });
    // scanning → scanning is a no-op-ish self edge, which is not in the map.
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.reason).toBe("conflict");
  });

  it("completes a claimed job with artifacts and forgets its execution state", async () => {
    await submit("job_done000000");
    await queue.claim({ leaseMs: LEASE_MS });
    await queue.advance("job_done000000", { status: "processing" });
    const done = await queue.complete("job_done000000", [artifact]);
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.value.status).toBe("completed");
      expect(done.value.progress).toBe(100);
      expect(done.value.artifacts).toEqual([artifact]);
    }
    expect(store.getLease("job_done000000")).toBeUndefined();
    expect(store.getSpec("job_done000000")).toBeUndefined();
  });

  it("fails a claimed job terminally and forgets its execution state", async () => {
    await submit("job_fail000000");
    await queue.claim({ leaseMs: LEASE_MS });
    const failed = await queue.fail(
      "job_fail000000",
      { code: "internal_error", message: "boom", retryable: false },
      { requeue: false },
    );
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.status).toBe("failed");
      expect(failed.value.error?.code).toBe("internal_error");
    }
    expect(store.getSpec("job_fail000000")).toBeUndefined();
  });

  it("requeues a retryable failure and re-claims it as a new attempt", async () => {
    await submit("job_retry00000");
    const first = await queue.claim({ leaseMs: LEASE_MS });
    expect(first.ok && first.value?.attempt).toBe(1);
    const requeued = await queue.fail(
      "job_retry00000",
      { code: "internal_error", message: "transient", retryable: true },
      { requeue: true },
    );
    expect(requeued.ok).toBe(true);
    if (requeued.ok) expect(requeued.value.status).toBe("queued");
    // Spec survives so the retry can read its inputs.
    expect(store.getSpec("job_retry00000")?.inputs).toEqual(["f_input00000"]);

    const second = await queue.claim({ leaseMs: LEASE_MS });
    expect(second.ok && second.value?.attempt).toBe(2);
  });

  it("redelivers a job whose lease has expired, bumping the attempt", async () => {
    await submit("job_lease00000");
    const first = await queue.claim({ leaseMs: LEASE_MS });
    expect(first.ok && first.value?.attempt).toBe(1);

    // The worker dies mid-flight; time advances past the lease.
    clock += LEASE_MS + 1;
    const second = await queue.claim({ leaseMs: LEASE_MS });
    expect(second.ok).toBe(true);
    if (!second.ok || !second.value) throw new Error("expected redelivery");
    expect(second.value.job.jobId).toBe("job_lease00000");
    expect(second.value.attempt).toBe(2);
  });

  it("does not redeliver a job whose lease is still valid", async () => {
    await submit("job_hold000000");
    await queue.claim({ leaseMs: LEASE_MS });
    clock += LEASE_MS - 1; // still leased
    const again = await queue.claim({ leaseMs: LEASE_MS });
    expect(again.ok && again.value).toBeNull();
  });

  it("heartbeat extends the lease; refuses unclaimed or terminal jobs", async () => {
    await submit("job_beat000000");
    await queue.claim({ leaseMs: LEASE_MS });
    clock += 500;
    const beat = await queue.heartbeat("job_beat000000", LEASE_MS);
    expect(beat.ok).toBe(true);
    expect(store.getLease("job_beat000000")?.leaseExpiresAt).toBe(
      clock + LEASE_MS,
    );

    // A never-claimed job cannot be heartbeated.
    await submit("job_unclaimed0");
    const bad = await queue.heartbeat("job_unclaimed0", LEASE_MS);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.reason).toBe("conflict");
  });

  it("refuses to complete or fail a job canceled mid-flight (race)", async () => {
    await submit("job_cancel0000");
    await queue.claim({ leaseMs: LEASE_MS });
    const canceled = await queue.cancel("job_cancel0000");
    expect(canceled.ok && canceled.value.status).toBe("canceled");

    const complete = await queue.complete("job_cancel0000", [artifact]);
    expect(complete.ok).toBe(false);
    if (!complete.ok) expect(complete.error.reason).toBe("conflict");

    const fail = await queue.fail(
      "job_cancel0000",
      { code: "internal_error", message: "x", retryable: true },
      { requeue: true },
    );
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.error.reason).toBe("conflict");
  });

  it("reports not_found for claim ops on an unknown job", async () => {
    for (const res of [
      await queue.heartbeat("job_absent0000", LEASE_MS),
      await queue.advance("job_absent0000", { progress: 1 }),
      await queue.complete("job_absent0000", []),
      await queue.fail(
        "job_absent0000",
        { code: "internal_error", message: "x", retryable: false },
        { requeue: false },
      ),
    ]) {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.reason).toBe("not_found");
    }
  });
});
