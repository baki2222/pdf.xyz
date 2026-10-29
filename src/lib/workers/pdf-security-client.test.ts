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

describe("the upload, through the whole run (2026-10-29)", () => {
  /**
   * The chain, not the unit: `uploadToWorkerSlot` may move the bytes to a
   * fresh slot after a 403, and the job is only right if it is created from
   * THAT slot. A client that kept using the first slot's fileId would pass
   * every test of the shared function and create a job with no file.
   */
  function storage(puts: number[]) {
    const calls: Recorded[] = [];
    let sessions = 0;
    let put = 0;
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? new TextDecoder().decode(init.body) : undefined,
      });
      if (url === "/api/uploads") {
        sessions += 1;
        return jsonResponse({
          slots: [
            {
              fileId: `file_${sessions}`,
              url: `https://upload.example/slot${sessions}`,
              method: "PUT",
              headers: {},
            },
          ],
        });
      }
      if (url.startsWith("https://upload.example/")) {
        const status = puts[put] ?? 200;
        put += 1;
        return {
          ok: status === 200,
          status,
          json: async () => {
            throw new SyntaxError("XML, not JSON");
          },
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      if (url === "/api/jobs") return jsonResponse(completedJob);
      if (url === "https://art.example/out")
        return bytesResponse(new Uint8Array([1]));
      throw new Error(`unexpected url ${url}`);
    };
    return { fetchImpl, calls };
  }

  it("a 403 on the first slot: the job is created from the FRESH slot", async () => {
    const { fetchImpl, calls } = storage([403, 200]);
    const result = await runWorkerUnlock(
      { filename: "locked.pdf", bytes: new Uint8Array([9]), password: SECRET },
      { fetchImpl },
    );
    expect(result.ok).toBe(true);
    const job = JSON.parse(calls.find((c) => c.url === "/api/jobs")!.body!);
    expect(job.inputs).toEqual(["file_2"]);
  });

  it("a storage refusal reaches the reader with its status, not the old fallback", async () => {
    const { fetchImpl, calls } = storage([400]);
    const result = await runWorkerUnlock(
      { filename: "locked.pdf", bytes: new Uint8Array([9]), password: SECRET },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("the storage service answered 400");
    expect(result.message).not.toContain("upload.example");
    expect(result.message).not.toBe("Uploading the file to the worker failed.");
    // Nothing was processed: no job was created.
    expect(calls.some((c) => c.url === "/api/jobs")).toBe(false);
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
