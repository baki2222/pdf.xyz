// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createLocalDevAdapter } from "./local-dev";
import { DevWorkerStore } from "./store";
import type { CompressionDeps } from "./compression/engine";
import type { WorkerAdapter } from "./types";

async function makePdf(pages = 4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  return doc.save();
}

/** No native engines installed — lossless still works via the default repacker. */
const noEngines: CompressionDeps = {
  tools: { ghostscript: false, qpdf: false, mutool: false },
};

describe("local-dev worker — compression job flow", () => {
  let store: DevWorkerStore;

  beforeEach(() => {
    store = new DevWorkerStore();
  });

  const makeAdapter = (): WorkerAdapter =>
    createLocalDevAdapter({ store, compressionDeps: noEngines });

  /** Create a session and upload the given bytes to its slot; returns the fileId. */
  async function seedUpload(
    adapter: WorkerAdapter,
    bytes: Uint8Array,
    filename = "report.pdf",
  ): Promise<string> {
    const session = await adapter.createUploadSession({
      tool: "compress-pdf",
      files: [{ filename, contentType: "application/pdf", bytes: bytes.byteLength }],
    });
    if (!session.ok) throw new Error("upload session should succeed");
    const slot = session.value.slots[0];
    if (!slot) throw new Error("session should mint a slot");
    expect(slot.url).toMatch(/^\/api\/uploads\/local\/f_/);
    const put = store.putBytes(slot.fileId, bytes);
    expect(put.ok).toBe(true);
    return slot.fileId;
  }

  it("completes a real lossless compression end to end", async () => {
    const adapter = makeAdapter();
    const pdf = await makePdf(6);
    const fileId = await seedUpload(adapter, pdf);

    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [fileId],
      options: { profile: "lossless" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.status).toBe(201);

    const job = created.value;
    expect(job.status).toBe("completed");
    expect(job.progress).toBe(100);
    expect(job.error).toBeUndefined();

    const artifact = job.artifacts?.[0];
    expect(artifact).toBeDefined();
    if (!artifact) return;
    expect(artifact.url).toMatch(/^\/api\/artifacts\/local\/art_/);
    expect(artifact.contentType).toBe("application/pdf");
    expect(artifact.bytes).toBeGreaterThan(0);

    // The stored artifact is a real, valid PDF preserving the page count.
    const stored = store.getArtifact(artifact.artifactId);
    expect(stored).toBeDefined();
    if (!stored) return;
    const reloaded = await PDFDocument.load(stored.bytes);
    expect(reloaded.getPageCount()).toBe(6);

    // Status endpoint returns the same terminal job.
    const fetched = await adapter.getJob(job.jobId);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.value.status).toBe("completed");

    // The input is wiped as soon as processing finishes (retention contract).
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("fails honestly for deep compression with no native engine — no dummy file", async () => {
    const adapter = makeAdapter();
    const fileId = await seedUpload(adapter, await makePdf());

    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [fileId],
      options: { profile: "deep" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const job = created.value;
    expect(job.status).toBe("failed");
    expect(job.artifacts).toBeUndefined();
    expect(job.error?.code).toBe("not_implemented");
    expect(job.error?.message).toMatch(/ghostscript|qpdf|mutool/i);
    expect(job.error?.message).toContain("WORKER_ARCHITECTURE.md");
    // Absolutely no artifact URL was minted.
    expect(JSON.stringify(job)).not.toContain("/api/artifacts/");
    // Even on failure, the input is wiped after the processing attempt.
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("defaults to the deep profile, so it fails honestly with no engine", async () => {
    const adapter = makeAdapter();
    const fileId = await seedUpload(adapter, await makePdf());
    const created = await adapter.createJob({ tool: "compress-pdf", inputs: [fileId] });
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.value.status).toBe("failed");
  });

  it("rejects a job whose input was never uploaded", async () => {
    const adapter = makeAdapter();
    const session = await adapter.createUploadSession({
      tool: "compress-pdf",
      files: [{ filename: "a.pdf", contentType: "application/pdf", bytes: 100 }],
    });
    if (!session.ok) throw new Error("no session");
    const slot = session.value.slots[0];
    if (!slot) throw new Error("no slot");

    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [slot.fileId],
      options: { profile: "lossless" },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error.body.error.code).toBe("unprocessable_entity");
    }
  });

  it("rejects an unknown or expired input file id", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: ["f_deadbeef00"],
      options: { profile: "lossless" },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.body.error.code).toBe("not_found");
  });

  it("requires exactly one input file", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: ["f_1234567890", "f_2345678901"],
      options: { profile: "lossless" },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.body.error.code).toBe("unprocessable_entity");
  });

  it("honors idempotency: the same key returns the same job without reprocessing", async () => {
    const adapter = makeAdapter();
    const fileId = await seedUpload(adapter, await makePdf());
    const first = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [fileId],
      options: { profile: "lossless" },
      idempotencyKey: "abc:1",
    });
    const second = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [fileId],
      options: { profile: "lossless" },
      idempotencyKey: "abc:1",
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.jobId).toBe(first.value.jobId);
      expect(second.status).toBe(200);
    }
  });

  it("returns not_implemented for tools the local worker does not support", async () => {
    const adapter = makeAdapter();
    const upload = await adapter.createUploadSession({
      tool: "ocr-pdf",
      files: [{ filename: "s.pdf", contentType: "application/pdf", bytes: 10 }],
    });
    expect(upload.ok).toBe(false);
    if (!upload.ok) expect(upload.error.body.error.code).toBe("not_implemented");

    const job = await adapter.createJob({ tool: "ocr-pdf", inputs: ["f_1234567890"] });
    expect(job.ok).toBe(false);
    if (!job.ok) expect(job.error.body.error.code).toBe("not_implemented");
  });

  it("rejects an invalid options.profile before running", async () => {
    const adapter = makeAdapter();
    const fileId = await seedUpload(adapter, await makePdf());
    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [fileId],
      options: { profile: "ultra" },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.body.error.code).toBe("invalid_request");
  });

  it("records a failed job for bytes that are not a valid PDF", async () => {
    const adapter = makeAdapter();
    const session = await adapter.createUploadSession({
      tool: "compress-pdf",
      files: [{ filename: "junk.pdf", contentType: "application/pdf", bytes: 4 }],
    });
    if (!session.ok) throw new Error("no session");
    const slot = session.value.slots[0];
    if (!slot) throw new Error("no slot");
    store.putBytes(slot.fileId, new Uint8Array([1, 2, 3, 4]));

    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [slot.fileId],
      options: { profile: "lossless" },
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.status).toBe("failed");
      expect(created.value.error?.code).toBe("unprocessable_entity");
    }
  });

  it("delete-now expires a completed job and wipes its artifact bytes", async () => {
    const adapter = makeAdapter();
    const fileId = await seedUpload(adapter, await makePdf(3));
    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [fileId],
      options: { profile: "lossless" },
    });
    if (!created.ok) throw new Error("job should complete");
    const artifactId = created.value.artifacts?.[0]?.artifactId;
    expect(artifactId).toBeDefined();
    if (!artifactId) return;
    expect(store.getArtifact(artifactId)).toBeDefined();

    // Delete now: the completed job moves to `expired`, its download disappears,
    // and the artifact bytes are actually gone from storage.
    const deleted = await adapter.cancelJob(created.value.jobId);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.value.status).toBe("expired");
    expect(deleted.value.artifacts).toBeUndefined();
    expect(store.getArtifact(artifactId)).toBeUndefined();
  });

  it("delete-now is idempotent on an already-failed job", async () => {
    const adapter = makeAdapter();
    const fileId = await seedUpload(adapter, await makePdf());
    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [fileId],
      options: { profile: "deep" }, // fails: no native engine
    });
    if (!created.ok) throw new Error("job should be created");
    expect(created.value.status).toBe("failed");
    const deleted = await adapter.cancelJob(created.value.jobId);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(deleted.value.status).toBe("failed");
  });

  it("delete-now on an unknown job is an honest not_found", async () => {
    const adapter = makeAdapter();
    const res = await adapter.cancelJob("job_deadbeef00");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.body.error.code).toBe("not_found");
  });
});
