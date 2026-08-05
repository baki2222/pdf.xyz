// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DevWorkerStore } from "../store";
import {
  createLocalDevStorage,
  createNotConfiguredStorage,
  mapStorageFailure,
  type ReserveUploadRequest,
} from "./index";

const uploadReq: ReserveUploadRequest = {
  sessionId: "sess_1234567890",
  filename: "a.pdf",
  contentType: "application/pdf",
  declaredBytes: 42,
};

describe("not-configured storage provider (disabled)", () => {
  const provider = createNotConfiguredStorage("disabled");

  it("fails every operation with an honest not_configured reason", async () => {
    expect(provider.probe().ok).toBe(false);
    const outcomes = [
      await provider.reserveUpload(uploadReq),
      await provider.reserveDownload({
        artifactId: "art_1234567890",
        filename: "out.pdf",
        contentType: "application/pdf",
      }),
      await provider.deleteNow("artifact", "art_1234567890"),
    ];
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe("not_configured");
    }
  });

  it("reports no capability and never a variable name", () => {
    const cap = provider.capability();
    expect(cap).toMatchObject({
      provider: "disabled",
      ready: false,
      configured: false,
      signedUploads: false,
      signedDownloads: false,
      deleteNow: false,
    });
    expect(cap.detail).not.toMatch(/PDFXYZ_/);
  });
});

describe("not-configured storage provider (remote-unimplemented)", () => {
  const provider = createNotConfiguredStorage("remote-unimplemented");

  it("fails with not_implemented and reports configured-but-not-ready", async () => {
    const probe = provider.probe();
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error.reason).toBe("not_implemented");
    const cap = provider.capability();
    expect(cap.ready).toBe(false);
    expect(cap.configured).toBe(true);
  });
});

describe("local-dev storage provider", () => {
  const make = () => {
    const store = new DevWorkerStore(() => 1_000);
    return { store, provider: createLocalDevStorage({ store, now: () => 1_000 }) };
  };

  it("is ready and advertises every capability", () => {
    const { provider } = make();
    expect(provider.probe().ok).toBe(true);
    expect(provider.capability()).toMatchObject({
      provider: "local-dev",
      ready: true,
      signedUploads: true,
      signedDownloads: true,
      deleteNow: true,
    });
  });

  it("reserves a single-use upload target backed by the store", async () => {
    const { store, provider } = make();
    const res = await provider.reserveUpload(uploadReq);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.fileId).toMatch(/^f_/);
    expect(res.value.target.url).toBe(`/api/uploads/local/${res.value.fileId}`);
    expect(res.value.target.method).toBe("PUT");
    // The ceiling the store will actually enforce on the write (`putBytes`
    // rejects any other length), not the catalogue-wide limit.
    expect(res.value.target.maxBytes).toBe(uploadReq.declaredBytes);
    // The reservation is a real slot in the shared store.
    expect(store.getSlot(res.value.fileId)?.filename).toBe("a.pdf");
  });

  it("reserves a signed, expiring download target", async () => {
    const { provider } = make();
    const res = await provider.reserveDownload({
      artifactId: "art_1234567890",
      filename: "out.pdf",
      contentType: "application/pdf",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.target.url).toBe("/api/artifacts/local/art_1234567890");
    expect(res.value.target.method).toBe("GET");
    expect(res.value.target.expiresAt).toBe(res.value.expiresAt);
    expect(new Date(res.value.expiresAt).getTime()).toBeGreaterThan(1_000);
  });

  it("delete-now removes an input slot and is idempotent", async () => {
    const { store, provider } = make();
    const reserved = await provider.reserveUpload(uploadReq);
    if (!reserved.ok) throw new Error("reserve failed");
    const fileId = reserved.value.fileId;

    const first = await provider.deleteNow("input", fileId);
    expect(first.ok && first.value.deleted).toBe(true);
    expect(store.getSlot(fileId)).toBeUndefined();

    // Idempotent: a second delete succeeds, reporting the object already gone.
    const second = await provider.deleteNow("input", fileId);
    expect(second.ok && second.value.deleted).toBe(false);
  });

  it("delete-now removes an output artifact", async () => {
    const { store, provider } = make();
    store.putArtifact({
      artifactId: "art_1234567890",
      jobId: "job_1234567890",
      filename: "out.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const res = await provider.deleteNow("artifact", "art_1234567890");
    expect(res.ok && res.value.deleted).toBe(true);
    expect(store.getArtifact("art_1234567890")).toBeUndefined();
  });
});

describe("mapStorageFailure", () => {
  it("maps each reason to the right HTTP status and code", () => {
    expect(mapStorageFailure({ reason: "not_configured", message: "" })).toMatchObject({
      status: 503,
      body: { error: { code: "worker_not_configured" } },
    });
    expect(mapStorageFailure({ reason: "not_implemented", message: "" }).status).toBe(
      501,
    );
    expect(mapStorageFailure({ reason: "not_found", message: "gone" })).toMatchObject({
      status: 404,
      body: { error: { code: "not_found" } },
    });
    expect(
      mapStorageFailure({ reason: "payload_too_large", message: "big" }).status,
    ).toBe(413);
  });
});
