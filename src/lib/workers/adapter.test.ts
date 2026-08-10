// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REQUIRED_WORKER_ENV,
  type CreateJobRequest,
  type CreateUploadSessionRequest,
} from "@/lib/jobs";
import { S3_ENV } from "./storage/s3-config";
import { REDIS_QUEUE_ENV } from "./queue/redis-config";
import { createFakeRedis } from "./queue/redis-fake";
import { getWorkerAdapter } from "./adapter";

const configuredEnv = (): Record<string, string> =>
  Object.fromEntries(REQUIRED_WORKER_ENV.map((name) => [name, "set"]));

const s3Env = (): Record<string, string> => ({
  [S3_ENV.provider]: "s3",
  [S3_ENV.endpoint]: "https://s3.us-east-1.amazonaws.com",
  [S3_ENV.region]: "us-east-1",
  [S3_ENV.bucket]: "pdfxyz-prod",
  [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
  [S3_ENV.secretAccessKey]: "s3cr3tEXAMPLEkeyValue00000000000000000000",
});

const redisEnv = (): Record<string, string> => ({
  [REDIS_QUEUE_ENV.provider]: "redis",
  [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
  [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
});

const uploadReq: CreateUploadSessionRequest = {
  tool: "compress-pdf",
  files: [{ filename: "a.pdf", contentType: "application/pdf", bytes: 10 }],
};
const jobReq: CreateJobRequest = {
  tool: "compress-pdf",
  inputs: ["f_1234567890"],
};

describe("getWorkerAdapter selection", () => {
  it("returns the disabled adapter by default (503 worker_not_configured)", async () => {
    const adapter = await getWorkerAdapter({});
    expect(adapter.mode).toBe("disabled");

    const outcomes = [
      await adapter.createUploadSession(uploadReq),
      await adapter.createJob(jobReq),
      await adapter.getJob("job_1234567890"),
      await adapter.cancelJob("job_1234567890"),
    ];
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.status).toBe(503);
        expect(outcome.error.body.error.code).toBe("worker_not_configured");
      }
    }
  });

  it("returns the remote not-implemented adapter when backend vars are present (501)", async () => {
    const adapter = await getWorkerAdapter(configuredEnv());
    expect(adapter.mode).toBe("remote-configured");

    // Every operation — including cancel/delete-now — is honest not_implemented.
    for (const outcome of [
      await adapter.createJob(jobReq),
      await adapter.cancelJob("job_1234567890"),
    ]) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.status).toBe(501);
        expect(outcome.error.body.error.code).toBe("not_implemented");
      }
    }
  });

  it("returns the local-dev adapter only when explicitly enabled", async () => {
    const adapter = await getWorkerAdapter({ PDFXYZ_WORKER_MODE: "local-dev" });
    expect(adapter.mode).toBe("local-dev");
  });

  it("mints real signed upload targets when S3 storage is configured (jobs still honest)", async () => {
    // Only storage is wired (no legacy backend vars), so the mode stays disabled
    // but the composed adapter uses the real S3 provider for uploads.
    const adapter = await getWorkerAdapter(s3Env());
    expect(adapter.mode).toBe("disabled");

    const session = await adapter.createUploadSession(uploadReq);
    expect(session.ok).toBe(true);
    if (session.ok) {
      expect(session.status).toBe(201);
      const slot = session.value.slots[0]!;
      expect(slot.fileId).toMatch(/^f_/);
      const url = new URL(slot.url);
      expect(url.host).toBe("pdfxyz-prod.s3.us-east-1.amazonaws.com");
      expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
      expect(slot.url).not.toContain("s3cr3t");
    }

    // Jobs remain honestly not-configured — the queue is not wired in this env.
    const job = await adapter.createJob(jobReq);
    expect(job.ok).toBe(false);
    if (!job.ok) {
      expect(job.error.status).toBe(503);
      expect(job.error.body.error.code).toBe("worker_not_configured");
    }
  });
});

describe("getWorkerAdapter — storage + queue composition", () => {
  it("enqueues a real queued job when BOTH storage and queue are configured", async () => {
    // Storage (S3) and queue (Redis) are wired independently; the mode is still
    // `disabled` (no legacy backend, no local-dev). The queue client is faked so
    // no real network is touched.
    const fake = createFakeRedis();
    const adapter = await getWorkerAdapter(
      { ...s3Env(), ...redisEnv() },
      { queue: { client: fake } },
    );
    expect(adapter.mode).toBe("disabled");

    const created = await adapter.createJob(jobReq);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // 202 Accepted, a real server-minted id, and — crucially — status `queued`,
    // never `completed`: no worker has run it, nothing is fabricated.
    expect(created.status).toBe(202);
    expect(created.value.jobId).toMatch(/^job_/);
    expect(created.value.status).toBe("queued");
    expect(created.value.artifacts).toBeUndefined();

    // Polling returns the same queued job (a deployed worker would advance it).
    const fetched = await adapter.getJob(created.value.jobId);
    expect(fetched.ok && fetched.value.status).toBe("queued");

    // The user can cancel their queued job now.
    const canceled = await adapter.cancelJob(created.value.jobId);
    expect(canceled.ok && canceled.value.status).toBe("canceled");
  });

  it("replays an idempotent job instead of enqueuing a duplicate", async () => {
    const fake = createFakeRedis();
    const adapter = await getWorkerAdapter(
      { ...s3Env(), ...redisEnv() },
      { queue: { client: fake } },
    );
    const withKey: CreateJobRequest = {
      ...jobReq,
      idempotencyKey: "replay-key-1",
    };
    const first = await adapter.createJob(withKey);
    const second = await adapter.createJob(withKey);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.jobId).toBe(first.value.jobId);
    expect(second.status).toBe(200); // idempotent replay, not a fresh 202
  });

  it("denies job creation when the queue is ready but storage is not", async () => {
    // Queue-only: a job's inputs have nowhere to be uploaded, so createJob denies
    // honestly (503) rather than enqueuing an unrunnable job.
    const fake = createFakeRedis();
    const adapter = await getWorkerAdapter(redisEnv(), {
      queue: { client: fake },
    });

    const upload = await adapter.createUploadSession(uploadReq);
    expect(upload.ok).toBe(false); // storage not configured

    const job = await adapter.createJob(jobReq);
    expect(job.ok).toBe(false);
    if (!job.ok) expect(job.error.status).toBe(503);
  });
});
