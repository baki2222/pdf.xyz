import { describe, expect, it } from "vitest";
import {
  canRunPdfStructure,
  runWorkerOptimizeWeb,
  runWorkerRepairPdf,
} from "./pdf-structure-client";
import type { FetchLike } from "./pdf-security-client";
import type { WorkerStatus } from "./status";

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
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

function harness(toolOutputName: string, output: Uint8Array) {
  const calls: { url: string; method: string; body?: string }[] = [];
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
    if (url === "/api/jobs") {
      return jsonResponse({
        jobId: "job_1",
        status: "completed",
        artifacts: [
          {
            artifactId: "a_1",
            filename: toolOutputName,
            contentType: "application/pdf",
            bytes: output.byteLength,
            url: "https://art.example/out",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        ],
      });
    }
    if (url === "https://art.example/out") return bytesResponse(output);
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls };
}

describe("pdf-structure client", () => {
  it("runs repair-pdf with an empty options object", async () => {
    const { fetchImpl, calls } = harness(
      "report-repaired.pdf",
      new Uint8Array([1, 2, 3]),
    );
    const result = await runWorkerRepairPdf(
      { filename: "report.pdf", bytes: new Uint8Array([9]) },
      { fetchImpl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.filename).toBe("report-repaired.pdf");
    const jobCall = calls.find((c) => c.url === "/api/jobs");
    const parsed = JSON.parse(jobCall!.body!);
    expect(parsed.tool).toBe("repair-pdf");
    expect(parsed.options).toEqual({});
  });

  it("runs optimize-web with an empty options object", async () => {
    const { fetchImpl, calls } = harness(
      "report-web-optimized.pdf",
      new Uint8Array([4, 5]),
    );
    const result = await runWorkerOptimizeWeb(
      { filename: "report.pdf", bytes: new Uint8Array([9]) },
      { fetchImpl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.filename).toBe("report-web-optimized.pdf");
    const parsed = JSON.parse(calls.find((c) => c.url === "/api/jobs")!.body!);
    expect(parsed.tool).toBe("optimize-web");
    expect(parsed.options).toEqual({});
  });

  it("uses the same qpdf worker availability as PDF security", () => {
    const status = {
      localDevOnly: true,
      security: {
        available: true,
        operations: ["protect", "unlock"],
        detail: "",
      },
    } as unknown as WorkerStatus;
    expect(canRunPdfStructure(status)).toBe(true);
  });
});
