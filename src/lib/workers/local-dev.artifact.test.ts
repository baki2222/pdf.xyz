// @vitest-environment node
/**
 * Proof that the synchronous local-dev adapter validates a produced output through
 * the SAME artifact-manifest gate the async executor runs, BEFORE any artifact is
 * stored or a download minted:
 *  - the default gate blesses a real compression PDF, so the happy path is unchanged
 *    (a completed job with one downloadable artifact);
 *  - a gate that rejects the output makes the job fail honestly with a typed
 *    `artifact_invalid` error and NO artifact — even though compression itself
 *    succeeded;
 *  - a disabled gate publishes the output and never reports it as validated.
 *
 * Runs on the in-memory store with the real (lossless) compression engine — no
 * network, bucket, or native binary.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createLocalDevAdapter } from "./local-dev";
import {
  createArtifactManifestGate,
  disabledArtifactManifestGate,
  DEFAULT_ARTIFACT_POLICY,
} from "./artifacts";
import { DevWorkerStore } from "./store";
import type { CompressionDeps } from "./compression/engine";
import type { WorkerAdapter } from "./types";

const noEngines: CompressionDeps = {
  tools: { ghostscript: false, qpdf: false, mutool: false },
};

async function makePdf(pages = 4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  return doc.save();
}

async function runCompression(adapter: WorkerAdapter, store: DevWorkerStore) {
  const pdf = await makePdf();
  const session = await adapter.createUploadSession({
    tool: "compress-pdf",
    files: [
      { filename: "report.pdf", contentType: "application/pdf", bytes: pdf.byteLength },
    ],
  });
  if (!session.ok) throw new Error("session should succeed");
  const fileId = session.value.slots[0]!.fileId;
  store.putBytes(fileId, pdf);
  const created = await adapter.createJob({
    tool: "compress-pdf",
    inputs: [fileId],
    options: { profile: "lossless" },
  });
  if (!created.ok) throw new Error("createJob should return a job record");
  return created.value;
}

describe("local-dev adapter — artifact-manifest gate", () => {
  it("the default gate blesses a real compression PDF (happy path unchanged)", async () => {
    const store = new DevWorkerStore();
    const adapter = createLocalDevAdapter({ store, compressionDeps: noEngines });
    const job = await runCompression(adapter, store);

    expect(job.status).toBe("completed");
    expect(job.artifacts ?? []).toHaveLength(1);
    expect(job.artifacts?.[0]?.contentType).toBe("application/pdf");
    expect(job.error).toBeUndefined();
  });

  it("a rejecting gate fails the job honestly with no artifact (even though compression succeeded)", async () => {
    const store = new DevWorkerStore();
    // A 1-byte ceiling rejects any real PDF as `oversize_artifact` — a deterministic
    // way to exercise the rejection path without a broken engine.
    const adapter = createLocalDevAdapter({
      store,
      compressionDeps: noEngines,
      artifactManifest: createArtifactManifestGate({
        ...DEFAULT_ARTIFACT_POLICY,
        maxBytes: 1,
      }),
    });
    const job = await runCompression(adapter, store);

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("artifact_invalid");
    expect(job.error?.retryable).toBe(false);
    expect(job.artifacts ?? []).toHaveLength(0);
    // The client error is fixed and content-free (never the specific reason).
    expect(job.error?.message).not.toMatch(/oversize|byte|ceiling/i);
  });

  it("a disabled gate publishes the output (unchanged, never reported as validated)", async () => {
    const store = new DevWorkerStore();
    const adapter = createLocalDevAdapter({
      store,
      compressionDeps: noEngines,
      artifactManifest: disabledArtifactManifestGate(),
    });
    const job = await runCompression(adapter, store);

    expect(job.status).toBe("completed");
    expect(job.artifacts ?? []).toHaveLength(1);
  });
});
