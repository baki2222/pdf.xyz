// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Job, UploadSession } from "@/lib/jobs";
import { runWorkerCompression, type FetchLike } from "./client";

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
  tool: "compress-pdf",
  slots: [
    {
      fileId: "f_abcdefghij",
      filename: "report.pdf",
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

function completedJob(): Job {
  return {
    jobId: "job_abcdefghij",
    tool: "compress-pdf",
    capability: "hybrid",
    status: "completed",
    progress: 100,
    artifacts: [
      {
        artifactId: "art_abcdefghij",
        filename: "report-compressed.pdf",
        contentType: "application/pdf",
        bytes: 3,
        url: "/api/artifacts/local/art_abcdefghij",
        expiresAt: new Date(0).toISOString(),
      },
    ],
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

const input = {
  filename: "report.pdf",
  bytes: new Uint8Array([1, 2, 3, 4, 5]),
  profile: "deep" as const,
  targetDpi: 150,
};

const OUTPUT = new Uint8Array([9, 9, 9]);

describe("runWorkerCompression", () => {
  it("drives upload → job → download and returns the real output", async () => {
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
        match: (u, m) =>
          u === "/api/artifacts/local/art_abcdefghij" && m === "GET",
        respond: () => bytesResp(200, OUTPUT),
      },
    ]);

    const result = await runWorkerCompression(input, { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toEqual(OUTPUT);
    expect(result.artifact.artifactId).toBe("art_abcdefghij");

    // The whole documented flow ran, in order.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/uploads",
      "PUT /api/uploads/local/f_abcdefghij",
      "POST /api/jobs",
      "GET /api/artifacts/local/art_abcdefghij",
    ]);

    // The upload PUT echoed the slot headers and carried the exact bytes.
    const put = calls[1];
    const jobCall = calls[2];
    expect(put).toBeDefined();
    expect(jobCall).toBeDefined();
    if (!put || !jobCall) return;
    expect(put.headers).toEqual({ "content-type": "application/pdf" });
    expect(new Uint8Array(put.body as ArrayBuffer)).toEqual(input.bytes);

    // The job request carried the deep profile + DPI, plus the display filename
    // as inputNames (so the worker names the output after it).
    const jobBody = JSON.parse(
      new TextDecoder().decode(jobCall.body as ArrayBuffer),
    );
    expect(jobBody).toMatchObject({
      tool: "compress-pdf",
      inputs: ["f_abcdefghij"],
      inputNames: ["report.pdf"],
      options: { profile: "deep", targetDpi: 150 },
    });
  });

  it("sends grayscale only when it is on, so a colour run's options are unchanged", async () => {
    const bodies: unknown[] = [];
    const routes = [
      {
        match: (u: string, m: string) => u === "/api/uploads" && m === "POST",
        respond: () => jsonResp(201, SESSION),
      },
      {
        match: (u: string, m: string) =>
          u === "/api/uploads/local/f_abcdefghij" && m === "PUT",
        respond: () => jsonResp(200, { ok: true }),
      },
      {
        match: (u: string, m: string) => u === "/api/jobs" && m === "POST",
        respond: (call: Call) => {
          bodies.push(
            JSON.parse(new TextDecoder().decode(call.body as ArrayBuffer)),
          );
          return jsonResp(201, completedJob());
        },
      },
      {
        match: (u: string, m: string) =>
          u === "/api/artifacts/local/art_abcdefghij" && m === "GET",
        respond: () => bytesResp(200, OUTPUT),
      },
    ];
    await runWorkerCompression(
      { ...input, targetDpi: 72, grayscale: true },
      { fetchImpl: makeFetch(routes).fetchImpl },
    );
    await runWorkerCompression(input, {
      fetchImpl: makeFetch(routes).fetchImpl,
    });
    // Target size (2026-10-31): sent when set, and only then (bodies[1]).
    await runWorkerCompression(
      { ...input, targetBytes: 200 * 1024 },
      { fetchImpl: makeFetch(routes).fetchImpl },
    );
    expect(bodies).toHaveLength(3);
    expect((bodies[2] as { options: unknown }).options).toEqual({
      profile: "deep",
      targetDpi: 150,
      targetBytes: 200 * 1024,
    });
    expect((bodies[0] as { options: unknown }).options).toEqual({
      profile: "deep",
      targetDpi: 72,
      grayscale: true,
    });
    expect((bodies[1] as { options: unknown }).options).toEqual({
      profile: "deep",
      targetDpi: 150,
    });
  });

  it("returns the server's honest error when the job fails (no fake file)", async () => {
    const failed: Job = {
      ...completedJob(),
      status: "failed",
      progress: 0,
      artifacts: undefined,
      error: {
        code: "not_implemented",
        message:
          "Deep image compression requires a native engine. Install one of: ghostscript, qpdf, mutool.",
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

    const result = await runWorkerCompression(input, { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_implemented");
    expect(result.message).toMatch(/native engine/i);
    // Never attempted an artifact download.
    expect(calls.some((c) => c.url.includes("/api/artifacts/"))).toBe(false);
  });

  it("surfaces an honest not-configured error from the upload session", async () => {
    const { fetchImpl } = makeFetch([
      {
        match: (u) => u === "/api/uploads",
        respond: () =>
          jsonResp(503, {
            error: {
              code: "worker_not_configured",
              message: "The secure worker backend is not configured.",
              docs: "docs/WORKER_ARCHITECTURE.md",
            },
          }),
      },
    ]);

    const result = await runWorkerCompression(input, { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("worker_not_configured");
  });

  it("fails honestly when the upload transport rejects the bytes", async () => {
    const { fetchImpl, calls } = makeFetch([
      {
        match: (u) => u === "/api/uploads",
        respond: () => jsonResp(201, SESSION),
      },
      {
        match: (u) => u.startsWith("/api/uploads/local/"),
        respond: () =>
          jsonResp(413, {
            error: {
              code: "payload_too_large",
              message: "Too large.",
              docs: "x",
            },
          }),
      },
    ]);
    const result = await runWorkerCompression(input, { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("payload_too_large");
    // Never created a job after a failed upload.
    expect(calls.some((c) => c.url === "/api/jobs")).toBe(false);
  });

  it("polls a non-terminal job to completion", async () => {
    let jobFetches = 0;
    const { fetchImpl, calls } = makeFetch([
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
            progress: 20,
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
                status: "processing",
                progress: 60,
                artifacts: undefined,
              })
            : jsonResp(200, completedJob());
        },
      },
      {
        match: (u) => u.startsWith("/api/artifacts/"),
        respond: () => bytesResp(200, OUTPUT),
      },
    ]);

    const result = await runWorkerCompression(input, {
      fetchImpl,
      sleep: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(jobFetches).toBe(2);
    expect(calls.filter((c) => c.url.startsWith("/api/jobs/job_")).length).toBe(
      2,
    );
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

    const result = await runWorkerCompression(input, {
      fetchImpl,
      sleep: async () => {},
      maxPollAttempts: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Giving up on WAITING is not the same as the job having failed, and the
    // difference matters to whoever is holding the file. The message says which
    // one happened, and names the job — the old wording ("Timed out waiting for
    // the worker.") implied the job was over and dropped the id it had in hand,
    // so a run that finished moments later was unreachable forever.
    expect(result.message).toMatch(/stopped waiting/i);
    expect(result.message).toMatch(/may still finish/i);
    expect(result.message).toContain("job_");
  });
});
