// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REQUIRED_WORKER_ENV,
  type CreateJobRequest,
  type CreateUploadSessionRequest,
} from "@/lib/jobs";
import { getWorkerAdapter } from "./adapter";

const configuredEnv = (): Record<string, string> =>
  Object.fromEntries(REQUIRED_WORKER_ENV.map((name) => [name, "set"]));

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

    const outcome = await adapter.createJob(jobReq);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.status).toBe(501);
      expect(outcome.error.body.error.code).toBe("not_implemented");
    }
  });

  it("returns the local-dev adapter only when explicitly enabled", async () => {
    const adapter = await getWorkerAdapter({ PDFXYZ_WORKER_MODE: "local-dev" });
    expect(adapter.mode).toBe("local-dev");
  });
});
