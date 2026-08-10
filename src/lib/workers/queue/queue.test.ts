// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job, type JobStatus } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import {
  createLocalDevQueue,
  createNotConfiguredQueue,
  mapQueueFailure,
} from "./index";

function jobAt(status: JobStatus, jobId = "job_1234567890"): Job {
  return {
    jobId,
    tool: "compress-pdf",
    capability: "secure-worker",
    status,
    progress: status === "completed" ? 100 : 0,
    ...(status === "completed"
      ? {
          artifacts: [
            {
              artifactId: "art_1234567890",
              filename: "out.pdf",
              contentType: "application/pdf",
              bytes: 3,
              url: "/api/artifacts/local/art_1234567890",
              expiresAt: new Date(10 * 60_000).toISOString(),
            },
          ],
        }
      : {}),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt: new Date(60 * 60_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

describe("not-configured queue provider", () => {
  it("disabled fails every op with not_configured", async () => {
    const q = createNotConfiguredQueue("disabled");
    expect(q.probe().ok).toBe(false);
    const outcomes = [
      await q.enqueue(jobAt("queued")),
      await q.lookupIdempotent("k"),
      await q.status("job_1234567890"),
      await q.cancel("job_1234567890"),
      await q.expire("job_1234567890"),
    ];
    for (const o of outcomes) {
      expect(o.ok).toBe(false);
      if (!o.ok) expect(o.error.reason).toBe("not_configured");
    }
    expect(q.capability().ready).toBe(false);
    expect(q.capability().configured).toBe(false);
  });

  it("remote-unimplemented fails with not_implemented and reports configured", async () => {
    const q = createNotConfiguredQueue("remote-unimplemented");
    const res = await q.status("job_1234567890");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("not_implemented");
    expect(q.capability()).toMatchObject({ ready: false, configured: true });
  });
});

describe("local-dev queue provider", () => {
  const make = () => {
    const store = new DevWorkerStore(() => 1_000);
    return { store, q: createLocalDevQueue({ store, now: () => 2_000 }) };
  };

  it("enqueues, reports status, and resolves idempotency", async () => {
    const { q } = make();
    const job = jobAt("completed");
    expect((await q.enqueue(job, "key-1")).ok).toBe(true);
    const status = await q.status(job.jobId);
    expect(status.ok && status.value.status).toBe("completed");
    const replay = await q.lookupIdempotent("key-1");
    expect(replay.ok && replay.value?.jobId).toBe(job.jobId);
    const miss = await q.lookupIdempotent("absent");
    expect(miss.ok && miss.value).toBeNull();
  });

  it("status of an unknown job is an honest not_found", async () => {
    const { q } = make();
    const res = await q.status("job_absentxxxx");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("not_found");
  });

  it("cancels an in-flight job and stamps updatedAt", async () => {
    const { q } = make();
    await q.enqueue(jobAt("processing"));
    const res = await q.cancel("job_1234567890");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("canceled");
    expect(res.value.updatedAt).toBe(new Date(2_000).toISOString());
  });

  it("refuses to cancel a completed job (conflict)", async () => {
    const { q } = make();
    await q.enqueue(jobAt("completed"));
    const res = await q.cancel("job_1234567890");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("conflict");
  });

  it("expires a completed job's outputs and drops its artifacts", async () => {
    const { q } = make();
    await q.enqueue(jobAt("completed"));
    const res = await q.expire("job_1234567890");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("expired");
    expect(res.value.artifacts).toBeUndefined();
  });

  it("refuses to expire a job that never completed (conflict)", async () => {
    const { q } = make();
    await q.enqueue(jobAt("processing"));
    const res = await q.expire("job_1234567890");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("conflict");
  });
});

describe("mapQueueFailure", () => {
  it("maps each reason to the right HTTP status and code", () => {
    expect(
      mapQueueFailure({ reason: "not_configured", message: "" }),
    ).toMatchObject({
      status: 503,
      body: { error: { code: "worker_not_configured" } },
    });
    expect(
      mapQueueFailure({ reason: "not_implemented", message: "" }).status,
    ).toBe(501);
    expect(mapQueueFailure({ reason: "not_found", message: "" }).status).toBe(
      404,
    );
    expect(mapQueueFailure({ reason: "conflict", message: "" })).toMatchObject({
      status: 409,
      body: { error: { code: "conflict" } },
    });
    // A transient broker outage maps to 500 (retryable), never a not-configured
    // stub — mirrors the storage provider's `unavailable` mapping.
    expect(
      mapQueueFailure({ reason: "unavailable", message: "" }),
    ).toMatchObject({
      status: 500,
      body: { error: { code: "internal_error" } },
    });
  });
});
