// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Job, UploadSession } from "@/lib/jobs";
import type { OcrOptions } from "@/lib/jobs/ocr";
import { runWorkerOcr, type FetchLike } from "./ocr-client";

type Resp = Awaited<ReturnType<FetchLike>>;

function jsonResp(status: number, body: unknown): Resp {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function bytesResp(status: number, bytes: Uint8Array): Resp {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    arrayBuffer: async () => {
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      return buf;
    },
  };
}

interface Call {
  url: string;
  method: string;
  body?: ArrayBuffer;
  headers?: Record<string, string>;
}

function makeFetch(
  routes: Array<{
    match: (url: string, method: string) => boolean;
    respond: (call: Call) => Resp;
  }>,
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      body: init?.body,
      headers: init?.headers,
    };
    calls.push(call);
    const route = routes.find((r) => r.match(url, call.method));
    if (!route) throw new Error(`unexpected ${call.method} ${url}`);
    return route.respond(call);
  };
  return { fetchImpl, calls };
}

const SESSION: UploadSession = {
  sessionId: "sess_abcdefghij",
  tool: "ocr-pdf",
  slots: [
    {
      fileId: "f_abcdefghij",
      filename: "scan.pdf",
      url: "/api/uploads/local/f_abcdefghij",
      method: "PUT",
      headers: { "content-type": "application/pdf" },
    },
  ],
  expiresAt: new Date(0).toISOString(),
  retention: {
    inputTtlMinutes: 60,
    outputTtlMinutes: 60,
    persistsAfterJob: false,
  },
};

/** A completed OCR job producing both a searchable PDF and a text sidecar. */
function completedJob(): Job {
  return {
    jobId: "job_abcdefghij",
    tool: "ocr-pdf",
    capability: "secure-worker",
    status: "completed",
    progress: 100,
    artifacts: [
      {
        artifactId: "art_pdf000000",
        filename: "scan-ocr.pdf",
        contentType: "application/pdf",
        bytes: 3,
        url: "/api/artifacts/local/art_pdf000000",
        expiresAt: new Date(0).toISOString(),
      },
      {
        artifactId: "art_txt000000",
        filename: "scan-ocr.txt",
        contentType: "text/plain",
        bytes: 2,
        url: "/api/artifacts/local/art_txt000000",
        expiresAt: new Date(0).toISOString(),
      },
    ],
    results: {
      ocr: {
        engine: "ocrmypdf",
        languages: ["eng", "spa"],
        outputMode: "both",
        producedSearchablePdf: true,
        producedTextSidecar: true,
        pageCount: 3,
        textCharacters: 128,
        meanConfidence: null,
        lowConfidenceWordRatio: null,
        recognizedWords: null,
      },
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt: new Date(0).toISOString(),
    retention: {
      inputTtlMinutes: 60,
      outputTtlMinutes: 60,
      persistsAfterJob: false,
    },
  };
}

const options: OcrOptions = {
  languages: ["eng", "spa"],
  outputMode: "both",
  redoOcr: false,
};

const input = {
  filename: "scan.pdf",
  bytes: new Uint8Array([1, 2, 3, 4, 5]),
  contentType: "application/pdf",
  options,
};

const PDF_OUT = new Uint8Array([9, 9, 9]);
const TXT_OUT = new Uint8Array([65, 66]);

describe("runWorkerOcr", () => {
  it("drives upload → job → download and returns every real artifact", async () => {
    const { fetchImpl, calls } = makeFetch([
      {
        match: (u, m) => u === "/api/uploads" && m === "POST",
        respond: () => jsonResp(201, SESSION),
      },
      {
        match: (u, m) => u === "/api/uploads/local/f_abcdefghij" && m === "PUT",
        respond: () => jsonResp(200, { ok: true }),
      },
      {
        match: (u, m) => u === "/api/jobs" && m === "POST",
        respond: () => jsonResp(201, completedJob()),
      },
      {
        match: (u) => u === "/api/artifacts/local/art_pdf000000",
        respond: () => bytesResp(200, PDF_OUT),
      },
      {
        match: (u) => u === "/api/artifacts/local/art_txt000000",
        respond: () => bytesResp(200, TXT_OUT),
      },
    ]);

    const result = await runWorkerOcr(input, { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]?.bytes).toEqual(PDF_OUT);
    expect(result.artifacts[1]?.bytes).toEqual(TXT_OUT);

    // The completed job carries the safe, structured OCR result metadata (from the
    // status API) so the UI can render a structural summary — pages, languages,
    // output kind, character count — never any recognized text.
    expect(result.job.results?.ocr).toMatchObject({
      outputMode: "both",
      languages: ["eng", "spa"],
      pageCount: 3,
      textCharacters: 128,
    });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/uploads",
      "PUT /api/uploads/local/f_abcdefghij",
      "POST /api/jobs",
      "GET /api/artifacts/local/art_pdf000000",
      "GET /api/artifacts/local/art_txt000000",
    ]);

    // The job request carried the exact, validated OCR options.
    const jobCall = calls[2];
    expect(jobCall).toBeDefined();
    if (!jobCall) return;
    const jobBody = JSON.parse(
      new TextDecoder().decode(jobCall.body as ArrayBuffer),
    );
    expect(jobBody).toMatchObject({
      tool: "ocr-pdf",
      inputs: ["f_abcdefghij"],
      options: {
        languages: ["eng", "spa"],
        outputMode: "both",
        redoOcr: false,
      },
    });

    // The upload session declared the input's content type.
    const sessionCall = calls[0];
    expect(sessionCall).toBeDefined();
    if (!sessionCall) return;
    const sessionBody = JSON.parse(
      new TextDecoder().decode(sessionCall.body as ArrayBuffer),
    );
    expect(sessionBody.files[0].contentType).toBe("application/pdf");
  });

  it("returns the server's honest not-configured error (no fake output)", async () => {
    const { fetchImpl, calls } = makeFetch([
      {
        match: (u) => u === "/api/uploads",
        respond: () =>
          jsonResp(503, {
            error: {
              code: "worker_not_configured",
              message:
                "The secure worker backend is not configured in this environment.",
              docs: "docs/WORKER_ARCHITECTURE.md",
            },
          }),
      },
    ]);

    const result = await runWorkerOcr(input, { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("worker_not_configured");
    // Never uploaded bytes, created a job, or downloaded anything.
    expect(calls).toHaveLength(1);
  });

  it("surfaces an honest failed job without inventing a searchable PDF", async () => {
    const failed: Job = {
      ...completedJob(),
      status: "failed",
      progress: 0,
      artifacts: undefined,
      error: {
        code: "not_implemented",
        message: "No OCR engine is installed on the worker.",
        retryable: false,
      },
    };
    const { fetchImpl, calls } = makeFetch([
      {
        match: (u) => u === "/api/uploads",
        respond: () => jsonResp(201, SESSION),
      },
      {
        match: (u) => u.startsWith("/api/uploads/local/"),
        respond: () => jsonResp(200, { ok: true }),
      },
      { match: (u) => u === "/api/jobs", respond: () => jsonResp(201, failed) },
    ]);

    const result = await runWorkerOcr(input, { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_implemented");
    // Never attempted an artifact download.
    expect(calls.some((c) => c.url.includes("/api/artifacts/"))).toBe(false);
  });

  it("polls a non-terminal job to completion", async () => {
    let jobFetches = 0;
    const { fetchImpl } = makeFetch([
      {
        match: (u) => u === "/api/uploads",
        respond: () => jsonResp(201, SESSION),
      },
      {
        match: (u) => u.startsWith("/api/uploads/local/"),
        respond: () => jsonResp(200, { ok: true }),
      },
      {
        match: (u, m) => u === "/api/jobs" && m === "POST",
        respond: () =>
          jsonResp(201, {
            ...completedJob(),
            status: "processing",
            progress: 10,
            artifacts: undefined,
          }),
      },
      {
        match: (u, m) => u.startsWith("/api/jobs/job_") && m === "GET",
        respond: () => {
          jobFetches += 1;
          return jobFetches < 2
            ? jsonResp(200, {
                ...completedJob(),
                status: "scanning",
                artifacts: undefined,
              })
            : jsonResp(200, completedJob());
        },
      },
      {
        match: (u) => u.startsWith("/api/artifacts/"),
        respond: () => bytesResp(200, PDF_OUT),
      },
    ]);

    const result = await runWorkerOcr(input, {
      fetchImpl,
      sleep: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(jobFetches).toBe(2);
  });

  it("gives up honestly if the job never reaches a terminal state", async () => {
    const { fetchImpl } = makeFetch([
      {
        match: (u) => u === "/api/uploads",
        respond: () => jsonResp(201, SESSION),
      },
      {
        match: (u) => u.startsWith("/api/uploads/local/"),
        respond: () => jsonResp(200, { ok: true }),
      },
      {
        match: (u, m) => u === "/api/jobs" && m === "POST",
        respond: () =>
          jsonResp(201, {
            ...completedJob(),
            status: "processing",
            artifacts: undefined,
          }),
      },
      {
        match: (u, m) => u.startsWith("/api/jobs/job_") && m === "GET",
        respond: () =>
          jsonResp(200, {
            ...completedJob(),
            status: "queued",
            artifacts: undefined,
          }),
      },
    ]);

    const result = await runWorkerOcr(input, {
      fetchImpl,
      sleep: async () => {},
      maxPollAttempts: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The client gives up on waiting, not on the job, and says so.
    expect(result.message).toMatch(/stopped waiting/i);
    expect(result.message).toMatch(/may still finish/i);
    // INVERTED 2026-09-27. This asserted `message` CONTAINS "job_": the id was
    // folded into prose, which a user could read and nothing could act on, so
    // no panel could resume the job. The id is data now, and stays out of the
    // sentence; `resumeWorkerOcr(result.jobId)` picks the job back up.
    expect(result.message).not.toContain("job_");
    expect(result.jobId).toMatch(/^job_/);
    expect(result.stillRunning).toBe(true);
  });
});
