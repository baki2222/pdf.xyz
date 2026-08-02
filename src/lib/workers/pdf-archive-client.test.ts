import { describe, expect, it } from "vitest";
import { canRunPdfArchive, runWorkerPdfToPdfA } from "./pdf-archive-client";
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
      declared: false,
      provider: null,
      model: null,
      configuredHere: false,
      ready: false,
      detail: "no ai declared",
    },
    ...overrides,
  };
}

describe("pdf-archive-client", () => {
  it("allows remote configured drainable worker", () => {
    expect(canRunPdfArchive(status())).toBe(true);
  });

  it("stays unavailable in local dev, which cannot run pdf-to-pdfa at all", () => {
    expect(canRunPdfArchive(status({ localDevOnly: true }))).toBe(false);
    // Even with qpdf probed available: qpdf is not Ghostscript, and `pdf-to-pdfa` is not
    // in LOCAL_DEV_SUPPORTED_TOOLS, so advertising it here would promise a job the local
    // adapter always rejects.
    expect(canRunPdfArchive(status({ localDevOnly: true, security: { available: true, operations: ["protect", "unlock", "repair", "optimize-web"], detail: "qpdf" } }))).toBe(false);
  });

  it("submits pdf-to-pdfa through the shared secure-worker job path", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string, init?: { body?: ArrayBuffer }) => {
      calls.push(input);
      if (input === "/api/uploads") return { ok: true, status: 200, json: async () => ({ uploadId: "up", slots: [{ fileId: "file", url: "/put", method: "PUT", headers: {} }] }), arrayBuffer: async () => new ArrayBuffer(0) };
      if (input === "/put") return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      if (input === "/api/jobs") {
        const body = JSON.parse(new TextDecoder().decode(init?.body));
        expect(body.tool).toBe("pdf-to-pdfa");
        return { ok: true, status: 200, json: async () => ({ jobId: "job", status: "completed", artifacts: [{ artifactId: "art", filename: "out.pdf", contentType: "application/pdf", bytes: 4, url: "/out" }] }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      if (input === "/out") return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
      throw new Error(String(input));
    };
    const result = await runWorkerPdfToPdfA({ filename: "in.pdf", bytes: new Uint8Array([1]) }, { fetchImpl, sleep: async () => {} });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["/api/uploads", "/put", "/api/jobs", "/out"]);
  });
});
