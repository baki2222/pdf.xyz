import { describe, expect, it } from "vitest";
import type { WorkerStatus } from "./status";
import {
  canRunPdfSecurity,
  runWorkerProtect,
  runWorkerUnlock,
  type FetchLike,
} from "./pdf-security-client";

const SECRET = "SENTINEL-PW-42";

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

/**
 * A routing fetch stub that walks the documented job flow and records every call.
 * `job` is the response to `POST /api/jobs`; `output` is the downloaded artifact.
 */
function harness(job: unknown, output: Uint8Array) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? new TextDecoder().decode(init.body) : undefined,
    });
    if (url === "/api/uploads") {
      return jsonResponse({
        slots: [
          {
            fileId: "file_1",
            url: "https://upload.example/slot",
            method: "PUT",
            headers: {},
          },
        ],
      });
    }
    if (url === "https://upload.example/slot") return jsonResponse({});
    if (url === "/api/jobs") return jsonResponse(job);
    if (url === "https://art.example/out") return bytesResponse(output);
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}
function bytesResponse(bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => toBuffer(bytes),
  };
}

const completedJob = {
  jobId: "job_1",
  status: "completed",
  artifacts: [
    {
      artifactId: "a_1",
      filename: "report-protected.pdf",
      contentType: "application/pdf",
      bytes: 10,
      url: "https://art.example/out",
      expiresAt: "2099-01-01T00:00:00Z",
    },
  ],
};

describe("runWorkerProtect", () => {
  it("runs the flow and carries the password ONLY in the job body, never a URL", async () => {
    const output = new Uint8Array([1, 2, 3, 4]);
    const { fetchImpl, calls } = harness(completedJob, output);
    const result = await runWorkerProtect(
      {
        filename: "report.pdf",
        bytes: new Uint8Array([9, 9]),
        password: SECRET,
        keyLength: 256,
      },
      { fetchImpl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toEqual(output);
    expect(result.artifact.filename).toBe("report-protected.pdf");

    // The password appears only in the /api/jobs request body.
    const jobCall = calls.find((c) => c.url === "/api/jobs");
    const parsed = JSON.parse(jobCall!.body!);
    expect(parsed.tool).toBe("protect-pdf");
    expect(parsed.options.password).toBe(SECRET);
    expect(parsed.options.keyLength).toBe(256);

    // No request URL may contain the password.
    for (const call of calls) expect(call.url).not.toContain(SECRET);
  });

  it("surfaces the server's typed error honestly (e.g. wrong password on unlock)", async () => {
    const failedJob = {
      jobId: "job_2",
      status: "failed",
      error: {
        code: "unprocessable_entity",
        message: "The password is incorrect.",
      },
    };
    const { fetchImpl } = harness(failedJob, new Uint8Array());
    const result = await runWorkerUnlock(
      { filename: "locked.pdf", bytes: new Uint8Array([9]), password: SECRET },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unprocessable_entity");
    expect(result.message).toMatch(/incorrect/i);
    // Even a failure never echoes the password.
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("canRunPdfSecurity", () => {
  const base = (over: Partial<WorkerStatus>): WorkerStatus =>
    ({
      localDevOnly: false,
      security: {
        available: false,
        operations: ["protect", "unlock"],
        detail: "",
      },
      providers: {
        storage: { ready: false },
        queue: { ready: false },
      },
      daemon: { drainable: false },
      ...over,
    }) as unknown as WorkerStatus;

  it("is false without a status", () => {
    expect(canRunPdfSecurity(null)).toBe(false);
    expect(canRunPdfSecurity(undefined)).toBe(false);
  });

  it("follows the honest local-dev qpdf probe", () => {
    expect(
      canRunPdfSecurity(
        base({
          localDevOnly: true,
          security: {
            available: true,
            operations: ["protect", "unlock"],
            detail: "",
          },
        }),
      ),
    ).toBe(true);
    expect(
      canRunPdfSecurity(
        base({
          localDevOnly: true,
          security: {
            available: false,
            operations: ["protect", "unlock"],
            detail: "",
          },
        }),
      ),
    ).toBe(false);
  });

  it("offers staging/production when storage + queue are ready and the daemon is drainable", () => {
    expect(
      canRunPdfSecurity(
        base({
          providers: {
            storage: { ready: true },
            queue: { ready: true },
          } as WorkerStatus["providers"],
          daemon: { drainable: true } as WorkerStatus["daemon"],
        }),
      ),
    ).toBe(true);
    // Missing any prerequisite keeps it off.
    expect(
      canRunPdfSecurity(
        base({
          providers: {
            storage: { ready: true },
            queue: { ready: false },
          } as WorkerStatus["providers"],
          daemon: { drainable: true } as WorkerStatus["daemon"],
        }),
      ),
    ).toBe(false);
  });
});
