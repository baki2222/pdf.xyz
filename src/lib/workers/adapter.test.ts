// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REQUIRED_WORKER_ENV,
  type CreateJobRequest,
  type CreateUploadSessionRequest,
} from "@/lib/jobs";
import { S3_ENV } from "./storage/s3-config";
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

const uploadReq: CreateUploadSessionRequest = {
  tool: "compress-pdf",
  files: [{ filename: "a.pdf", contentType: "application/pdf", bytes: 10 }],
};
const jobReq: CreateJobRequest = { tool: "compress-pdf", inputs: ["f_1234567890"] };

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

    // Jobs remain honestly not-configured — no queue/processor ships this phase.
    const job = await adapter.createJob(jobReq);
    expect(job.ok).toBe(false);
    if (!job.ok) {
      expect(job.error.status).toBe(503);
      expect(job.error.body.error.code).toBe("worker_not_configured");
    }
  });
});
