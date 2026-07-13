// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createLocalDevAdapter } from "./local-dev";
import { disabledSoundnessGate } from "./soundness";
import { disabledArtifactManifestGate } from "./artifacts/gate";
import { DevWorkerStore } from "./store";
import type { CompressionDeps } from "./compression/engine";
import type { QpdfRunner } from "./pdf-security/engine";
import type { QpdfStructureRunner } from "./pdf-structure/engine";
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
    // Compression reports no structured result metadata, so a compression job never
    // grows a `results` block (and never an OCR one) — the Phase 26 threading is
    // strictly opt-in per processor.
    expect(job.results).toBeUndefined();

    const artifact = job.artifacts?.[0];
    expect(artifact).toBeDefined();
    if (!artifact) return;
    expect(artifact.url).toMatch(/^\/api\/artifacts\/local\/art_/);
    expect(artifact.contentType).toBe("application/pdf");
    expect(artifact.bytes).toBeGreaterThan(0);
    // Output named from the uploaded slot's filename — same scheme the async
    // secure-worker path uses (deterministic `<base>-compressed.pdf`).
    expect(artifact.filename).toBe("report-compressed.pdf");

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

  it("names the output from the request's inputNames when supplied", async () => {
    const adapter = makeAdapter();
    const pdf = await makePdf(3);
    // The slot was reserved under a generic name; the job carries the real one.
    const fileId = await seedUpload(adapter, pdf, "upload.pdf");

    const created = await adapter.createJob({
      tool: "compress-pdf",
      inputs: [fileId],
      inputNames: ["../../Downloads/Q3 Report.PDF"],
      options: { profile: "lossless" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // Sanitized display name drives the output, aligned with the worker path.
    expect(created.value.artifacts?.[0]?.filename).toBe(
      "Q3 Report-compressed.pdf",
    );
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

  it("records a failed job for bytes that are not a valid PDF (soundness gate blocks it)", async () => {
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
      // The Phase 36 file-soundness gate now catches junk BEFORE the engine runs, so
      // the honest failure is `unsound_input` rather than the engine's own
      // `unprocessable_entity`. Either way: a real failed job, no artifact.
      expect(created.value.status).toBe("failed");
      expect(created.value.error?.code).toBe("unsound_input");
      expect(created.value.artifacts ?? []).toHaveLength(0);
    }
    // The rejected input was wiped (delete-now), matching the retention contract.
    expect(store.getSlot(slot.fileId)).toBeUndefined();
  });

  it("a disabled soundness gate lets junk reach the engine (the gate, not the engine, is the blocker)", async () => {
    const adapter = createLocalDevAdapter({
      store,
      compressionDeps: noEngines,
      soundness: disabledSoundnessGate(),
    });
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
      // With the gate disabled the input reaches the compression engine, which fails
      // honestly on non-PDF bytes with its OWN error — proving the earlier
      // `unsound_input` came from the gate, not the engine.
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

describe("local-dev worker — PDF security (protect/unlock) flow", () => {
  let store: DevWorkerStore;

  beforeEach(() => {
    store = new DevWorkerStore();
  });

  // A structurally-valid PDF carrying a content marker so a fake qpdf runner can
  // report "encrypted" by inspecting bytes (robust to any copying the store does),
  // never by object identity.
  function taggedPdf(tag: string): Uint8Array {
    return new TextEncoder().encode(
      `%PDF-1.7\n%tag:${tag}\n${"0".repeat(64)}\n%%EOF\n`,
    );
  }
  const isTagged = (bytes: Uint8Array, tag: string): boolean =>
    new TextDecoder().decode(bytes).includes(`tag:${tag}`);

  const fakeQpdf = (over: Partial<QpdfRunner> = {}): QpdfRunner => ({
    isEncrypted: async (b) => isTagged(b, "ENC"),
    protect: async () => taggedPdf("ENC"),
    unlock: async () => ({ ok: true, output: taggedPdf("DEC") }),
    ...over,
  });

  const adapterWith = (qpdf: QpdfRunner): WorkerAdapter =>
    createLocalDevAdapter({
      store,
      compressionDeps: noEngines,
      pdfSecurityDeps: { qpdf },
      // Isolate the security logic from the structural gates (exercised elsewhere).
      soundness: disabledSoundnessGate(),
      artifactManifest: disabledArtifactManifestGate(),
    });

  async function seed(
    adapter: WorkerAdapter,
    tool: string,
    bytes: Uint8Array,
    filename = "report.pdf",
  ): Promise<string> {
    const session = await adapter.createUploadSession({
      tool,
      files: [{ filename, contentType: "application/pdf", bytes: bytes.byteLength }],
    });
    if (!session.ok) throw new Error("upload session should succeed");
    const slot = session.value.slots[0];
    if (!slot) throw new Error("session should mint a slot");
    store.putBytes(slot.fileId, bytes);
    return slot.fileId;
  }

  it("protects a PDF end to end, names the artifact, and wipes the input", async () => {
    const adapter = adapterWith(fakeQpdf());
    const fileId = await seed(adapter, "protect-pdf", taggedPdf("PLAIN"), "statement.pdf");

    const created = await adapter.createJob({
      tool: "protect-pdf",
      inputs: [fileId],
      inputNames: ["statement.pdf"],
      options: { password: "s3cret-PW", keyLength: 256 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.value;
    expect(job.status).toBe("completed");
    expect(job.artifacts?.[0]?.filename).toBe("statement-protected.pdf");
    // The password never appears anywhere in the persisted job record.
    expect(JSON.stringify(job)).not.toContain("s3cret-PW");
    // The input is wiped right after processing (retention contract).
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("unlocks a PDF end to end", async () => {
    const adapter = adapterWith(fakeQpdf());
    const fileId = await seed(adapter, "unlock-pdf", taggedPdf("ENC"), "locked.pdf");
    const created = await adapter.createJob({
      tool: "unlock-pdf",
      inputs: [fileId],
      inputNames: ["locked.pdf"],
      options: { password: "s3cret-PW" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe("completed");
    expect(created.value.artifacts?.[0]?.filename).toBe("locked-unlocked.pdf");
    expect(JSON.stringify(created.value)).not.toContain("s3cret-PW");
  });

  it("rejects a missing password with a 4xx before creating a job", async () => {
    const adapter = adapterWith(fakeQpdf());
    const fileId = await seed(adapter, "protect-pdf", taggedPdf("PLAIN"));
    const created = await adapter.createJob({
      tool: "protect-pdf",
      inputs: [fileId],
      options: {},
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.body.error.code).toBe("invalid_request");
  });

  it("maps a wrong unlock password to a failed job, password-free", async () => {
    const adapter = adapterWith(
      fakeQpdf({ unlock: async () => ({ ok: false, wrongPassword: true }) }),
    );
    const fileId = await seed(adapter, "unlock-pdf", taggedPdf("ENC"), "locked.pdf");
    const created = await adapter.createJob({
      tool: "unlock-pdf",
      inputs: [fileId],
      options: { password: "WRONG-PW-9" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe("failed");
    expect(created.value.error?.code).toBe("unprocessable_entity");
    expect(created.value.error?.retryable).toBe(false);
    expect(JSON.stringify(created.value)).not.toContain("WRONG-PW-9");
  });
});

describe("local-dev worker — qpdf structure job flow", () => {
  let store: DevWorkerStore;

  beforeEach(() => {
    store = new DevWorkerStore();
  });

  function taggedPdf(tag: string): Uint8Array {
    return new TextEncoder().encode(
      `%PDF-1.7\n%tag:${tag}\n${"0".repeat(64)}\n%%EOF\n`,
    );
  }

  const fakeStructure = (over: Partial<QpdfStructureRunner> = {}): QpdfStructureRunner => ({
    repair: async () => taggedPdf("REPAIRED"),
    linearize: async () => taggedPdf("LINEARIZED"),
    ...over,
  });

  const adapterWith = (qpdf: QpdfStructureRunner): WorkerAdapter =>
    createLocalDevAdapter({
      store,
      compressionDeps: noEngines,
      pdfStructureDeps: { qpdf },
      soundness: disabledSoundnessGate(),
      artifactManifest: disabledArtifactManifestGate(),
    });

  async function seed(
    adapter: WorkerAdapter,
    tool: string,
    bytes: Uint8Array,
    filename = "report.pdf",
  ): Promise<string> {
    const session = await adapter.createUploadSession({
      tool,
      files: [{ filename, contentType: "application/pdf", bytes: bytes.byteLength }],
    });
    if (!session.ok) throw new Error("upload session should succeed");
    const slot = session.value.slots[0];
    if (!slot) throw new Error("session should mint a slot");
    store.putBytes(slot.fileId, bytes);
    return slot.fileId;
  }

  it("repairs a PDF end to end", async () => {
    const adapter = adapterWith(fakeStructure());
    const fileId = await seed(adapter, "repair-pdf", taggedPdf("DAMAGED"), "damaged.pdf");

    const created = await adapter.createJob({
      tool: "repair-pdf",
      inputs: [fileId],
      inputNames: ["damaged.pdf"],
      options: {},
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe("completed");
    expect(created.value.artifacts?.[0]?.filename).toBe("damaged-repaired.pdf");
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("optimizes a PDF for web end to end", async () => {
    const adapter = adapterWith(fakeStructure());
    const fileId = await seed(adapter, "optimize-web", taggedPdf("PLAIN"), "catalog.pdf");

    const created = await adapter.createJob({
      tool: "optimize-web",
      inputs: [fileId],
      inputNames: ["catalog.pdf"],
      options: {},
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe("completed");
    expect(created.value.artifacts?.[0]?.filename).toBe("catalog-web-optimized.pdf");
    expect(store.getSlot(fileId)).toBeUndefined();
  });
});
