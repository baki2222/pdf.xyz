// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { DevWorkerStore } from "../store";
import { createLocalDevExecutorStorage } from "./local-dev-storage";

describe("local-dev executor storage", () => {
  let clock: number;
  let store: DevWorkerStore;
  let storage: ReturnType<typeof createLocalDevExecutorStorage>;

  beforeEach(() => {
    clock = 50_000;
    store = new DevWorkerStore(() => clock);
    storage = createLocalDevExecutorStorage({ store, now: () => clock });
  });

  it("reads an uploaded input as a processor-ready file", async () => {
    const slot = store.reserveSlot({
      sessionId: "sess_x0000000",
      filename: "in.pdf",
      contentType: "application/pdf",
      declaredBytes: 3,
    });
    store.putBytes(slot.fileId, new Uint8Array([1, 2, 3]));
    const file = await storage.readInput(slot.fileId);
    expect(file).toEqual({
      fileId: slot.fileId,
      filename: "in.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
      // The reservation's declared byte count rides along for the soundness gate.
      declaredBytes: 3,
    });
  });

  it("returns null for an unknown or not-yet-uploaded input", async () => {
    expect(await storage.readInput("f_missing0000")).toBeNull();
    const reserved = store.reserveSlot({
      sessionId: "sess_x0000000",
      filename: "in.pdf",
      contentType: "application/pdf",
      declaredBytes: 3,
    });
    // Reserved but no bytes uploaded yet.
    expect(await storage.readInput(reserved.fileId)).toBeNull();
  });

  it("writes an artifact and returns a signed-style download record", async () => {
    const record = await storage.writeArtifact({
      jobId: "job_x000000000",
      filename: "out.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([7, 7]),
    });
    expect(record.artifactId).toMatch(/^art_/);
    expect(record.url).toBe(`/api/artifacts/local/${record.artifactId}`);
    expect(record.bytes).toBe(2);
    // Bytes are actually persisted and downloadable.
    expect(store.getArtifact(record.artifactId)?.bytes).toEqual(
      new Uint8Array([7, 7]),
    );
  });

  it("delete-now wipes inputs and artifacts idempotently", async () => {
    const slot = store.reserveSlot({
      sessionId: "sess_x0000000",
      filename: "in.pdf",
      contentType: "application/pdf",
      declaredBytes: 1,
    });
    store.putBytes(slot.fileId, new Uint8Array([1]));
    await storage.deleteInput(slot.fileId);
    expect(store.getSlot(slot.fileId)).toBeUndefined();
    await expect(storage.deleteInput(slot.fileId)).resolves.toBeUndefined();

    const record = await storage.writeArtifact({
      jobId: "job_x000000000",
      filename: "out.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1]),
    });
    await storage.deleteArtifact(record.artifactId);
    expect(store.getArtifact(record.artifactId)).toBeUndefined();
  });
});
