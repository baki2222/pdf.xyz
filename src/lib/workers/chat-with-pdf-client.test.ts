import { describe, expect, it } from "vitest";
import { canRunChatWithPdf, runWorkerChatWithPdf } from "./chat-with-pdf-client";
import type { WorkerStatus } from "./status";

function status(overrides: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    mode: "remote-configured",
    enabled: false,
    localDevOnly: false,
    detail: "remote",
    compress: { lossless: false, deep: false, engines: [] },
    ocr: { available: false, engine: null, languages: [], detail: "off" },
    scan: { active: false, detail: "not scanned" },
    security: { available: false, operations: ["protect", "unlock", "repair", "optimize-web"], detail: "qpdf" },
    providers: {
      storage: {
        provider: "s3",
        ready: true,
        configured: true,
        signedUploads: true,
        signedDownloads: true,
        deleteNow: true,
        detail: "ready",
      },
      queue: {
        provider: "redis",
        ready: true,
        configured: true,
        enqueue: true,
        status: true,
        cancel: true,
        atomicTransitions: true,
        detail: "ready",
      },
      processor: {
        ready: true,
        configured: true,
        executor: { mode: "not-implemented", ready: false, detail: "out-of-band daemon" },
        detail: "ready",
      },
    },
    daemon: {
      mode: "remote-configured",
      queueConfigured: true,
      storageConfigured: true,
      drainable: true,
      runsInThisProcess: false,
      detail: "ready",
    },
    ai: {
      declared: true,
      provider: "anthropic",
      model: "claude-sonnet-5",
      configuredHere: false,
      ready: true,
      detail: "ai declared",
    },
    ...overrides,
  };
}

describe("chat-with-pdf-client", () => {
  it("allows a remote, configured, drainable worker", () => {
    expect(canRunChatWithPdf(status())).toBe(true);
  });

  it("never advertises the flow for a local-dev-only worker", () => {
    expect(canRunChatWithPdf(status({ localDevOnly: true }))).toBe(false);
  });

  it("refuses up front when the deployment declares no AI provider", () => {
    // A drainable pipeline is not enough: with no model wired there is no
    // answer to produce, so the tool must not take the user's document first.
    expect(
      canRunChatWithPdf(
        status({
      ai: {
        declared: false,
        provider: null,
        model: null,
        configuredHere: false,
        ready: false,
        detail: "no ai provider is declared",
      },
        }),
      ),
    ).toBe(false);
  });

  it("is unavailable when status is absent", () => {
    expect(canRunChatWithPdf(null)).toBe(false);
    expect(canRunChatWithPdf(undefined)).toBe(false);
  });

  it("submits a question through the shared secure-worker job path", async () => {
    const calls: string[] = [];
    let jobBody: Record<string, unknown> | undefined;
    const fetchImpl = async (input: string, init?: { body?: ArrayBuffer }) => {
      calls.push(input);
      if (input === "/api/uploads") {
        const body = JSON.parse(new TextDecoder().decode(init?.body));
        expect(body.tool).toBe("chat-with-pdf");
        return { ok: true, status: 200, json: async () => ({ uploadId: "up", slots: [{ fileId: "file", url: "/put", method: "PUT", headers: {} }] }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      if (input === "/put") return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      if (input === "/api/jobs") {
        jobBody = JSON.parse(new TextDecoder().decode(init?.body));
        return { ok: true, status: 200, json: async () => ({ jobId: "job", status: "completed", artifacts: [{ artifactId: "art", filename: "in-answer.zip", contentType: "application/zip", bytes: 4, url: "/out" }] }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      if (input === "/out") return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
      throw new Error(String(input));
    };

    const result = await runWorkerChatWithPdf(
      {
        filename: "in.pdf",
        bytes: new Uint8Array([1]),
        question: "What is the total?",
        context: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      },
      { fetchImpl, sleep: async () => {} },
    );

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["/api/uploads", "/put", "/api/jobs", "/out"]);
    expect(jobBody?.tool).toBe("chat-with-pdf");
    expect(jobBody?.options).toEqual({
      question: "What is the total?",
      context: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
  });

  it("omits context from the job body when none is provided", async () => {
    let jobBody: Record<string, unknown> | undefined;
    const fetchImpl = async (input: string, init?: { body?: ArrayBuffer }) => {
      if (input === "/api/uploads") return { ok: true, status: 200, json: async () => ({ uploadId: "up", slots: [{ fileId: "file", url: "/put", method: "PUT", headers: {} }] }), arrayBuffer: async () => new ArrayBuffer(0) };
      if (input === "/put") return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      if (input === "/api/jobs") {
        jobBody = JSON.parse(new TextDecoder().decode(init?.body));
        return { ok: true, status: 200, json: async () => ({ jobId: "job", status: "completed", artifacts: [{ artifactId: "art", filename: "in-answer.zip", contentType: "application/zip", bytes: 4, url: "/out" }] }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      if (input === "/out") return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new Uint8Array([1]).buffer };
      throw new Error(String(input));
    };

    await runWorkerChatWithPdf(
      { filename: "in.pdf", bytes: new Uint8Array([1]), question: "What is the total?" },
      { fetchImpl, sleep: async () => {} },
    );

    expect(jobBody?.options).toEqual({ question: "What is the total?" });
  });

  it("surfaces the worker's honest error when no AI provider is configured", async () => {
    const fetchImpl = async (input: string) => {
      if (input === "/api/uploads") return { ok: true, status: 200, json: async () => ({ uploadId: "up", slots: [{ fileId: "file", url: "/put", method: "PUT", headers: {} }] }), arrayBuffer: async () => new ArrayBuffer(0) };
      if (input === "/put") return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      if (input === "/api/jobs") {
        return { ok: true, status: 200, json: async () => ({ jobId: "job", status: "failed", error: { code: "not_implemented", message: "No AI provider is configured on this worker." } }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      throw new Error(String(input));
    };

    const result = await runWorkerChatWithPdf(
      { filename: "in.pdf", bytes: new Uint8Array([1]), question: "What is the total?" },
      { fetchImpl, sleep: async () => {} },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("No AI provider is configured");
  });
});
