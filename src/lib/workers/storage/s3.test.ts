// @vitest-environment node
import { describe, expect, it } from "vitest";
import { JOB_LIMITS } from "@/lib/jobs";
import { parseS3Config, S3_ENV, type S3StorageConfig } from "./s3-config";
import { createS3Storage, type S3DeleteFetch } from "./s3";

const SECRET = "s3cr3tEXAMPLEkeyValue00000000000000000000";
const FILENAME = "quarterly-invoice.pdf";
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);
const now = () => NOW;

function config(
  overrides: Record<string, string | undefined> = {},
): S3StorageConfig {
  const parsed = parseS3Config({
    [S3_ENV.provider]: "s3",
    [S3_ENV.endpoint]: "https://s3.us-east-1.amazonaws.com",
    [S3_ENV.region]: "us-east-1",
    [S3_ENV.bucket]: "pdfxyz-prod",
    [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
    [S3_ENV.secretAccessKey]: SECRET,
    ...overrides,
  });
  if (!parsed.ok) throw new Error("invalid test config");
  return parsed.config;
}

/** A recording fake for the delete transport — no real network. */
function fakeFetch(responses: Array<{ ok: boolean; status: number }>) {
  const calls: Array<{ url: string; method: string }> = [];
  let i = 0;
  const fn: S3DeleteFetch = async (url, init) => {
    calls.push({ url, method: init.method });
    return responses[Math.min(i++, responses.length - 1)]!;
  };
  return { fn, calls };
}

const uploadReq = {
  sessionId: "sess_test0000000",
  filename: FILENAME,
  contentType: "application/pdf",
  declaredBytes: 2048,
};

describe("createS3Storage — readiness", () => {
  it("probes ready and advertises every capability", () => {
    const provider = createS3Storage(config(), { now });
    expect(provider.id).toBe("s3");
    expect(provider.probe().ok).toBe(true);
    expect(provider.capability()).toMatchObject({
      provider: "s3",
      ready: true,
      signedUploads: true,
      signedDownloads: true,
      deleteNow: true,
    });
  });
});

describe("createS3Storage — reserveUpload", () => {
  it("mints a signed, single-use PUT to an opaque-id key", async () => {
    const provider = createS3Storage(config(), { now });
    const res = await provider.reserveUpload(uploadReq);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.fileId).toMatch(/^f_[A-Za-z0-9_-]+$/);
    expect(res.value.filename).toBe(FILENAME);
    expect(res.value.target.method).toBe("PUT");
    // The PUT now also carries the sanitized filename as signed object metadata
    // (echoed by the client). Content-type stays locked to the declared type.
    expect(res.value.target.headers).toEqual({
      "content-type": "application/pdf",
      "x-amz-meta-filename": "quarterly-invoice.pdf",
    });
    expect(res.value.target.maxBytes).toBe(JOB_LIMITS.maxFileBytes);
    expect(res.value.expiresAt).toBe(new Date(NOW + 900_000).toISOString());

    const url = new URL(res.value.target.url);
    // Virtual-host addressing: bucket in the host, opaque id in the path.
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("pdfxyz-prod.s3.us-east-1.amazonaws.com");
    expect(url.pathname).toBe(`/inputs/${res.value.fileId}`);
    // A real SigV4 presign; content-type AND the filename metadata are signed, so
    // the client cannot alter either without breaking the signature.
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;x-amz-meta-filename",
    );
    expect(url.searchParams.get("X-Amz-Credential")).toContain("AKIAEXAMPLE0000000");
    expect(res.value.target.url).not.toContain(SECRET);
    // The client's filename is metadata only — never part of the bucket key/URL.
    expect(url.pathname).not.toContain("invoice");
    expect(url.search).not.toContain("invoice");
  });

  it("sanitizes an unsafe client filename into the metadata (path/case stripped)", async () => {
    const provider = createS3Storage(config(), { now });
    const res = await provider.reserveUpload({
      ...uploadReq,
      filename: "../../secret/Q3 Report.PDF",
    });
    if (!res.ok) throw new Error("reserve failed");
    // Display filename is the safe last segment, extension normalized.
    expect(res.value.filename).toBe("Q3 Report.pdf");
    expect(res.value.target.headers["x-amz-meta-filename"]).toBe("Q3%20Report.pdf");
    // No path component ever reaches the key or the signed URL.
    const url = new URL(res.value.target.url);
    expect(url.pathname).toBe(`/inputs/${res.value.fileId}`);
    expect(url.pathname).not.toContain("secret");
  });

  it("uses path-style addressing and a key prefix when configured", async () => {
    const provider = createS3Storage(
      config({
        [S3_ENV.endpoint]: "http://localhost:9000",
        [S3_ENV.forcePathStyle]: "true",
        [S3_ENV.keyPrefix]: "tenant-a",
      }),
      { now },
    );
    const res = await provider.reserveUpload(uploadReq);
    if (!res.ok) throw new Error("reserve failed");
    const url = new URL(res.value.target.url);
    expect(url.host).toBe("localhost:9000");
    expect(url.pathname).toBe(`/pdfxyz-prod/tenant-a/inputs/${res.value.fileId}`);
  });
  it("rejects an oversized upload before minting any signed target", async () => {
    const provider = createS3Storage(config(), { now });
    const res = await provider.reserveUpload({
      ...uploadReq,
      declaredBytes: JOB_LIMITS.maxFileBytes + 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.reason).toBe("payload_too_large");
  });
});

describe("createS3Storage — reserveDownload", () => {
  it("mints a signed, expiring GET for an artifact id", async () => {
    const provider = createS3Storage(config(), { now });
    const res = await provider.reserveDownload({
      artifactId: "art_TEST00000000",
      filename: "out.pdf",
      contentType: "application/pdf",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.target.method).toBe("GET");
    expect(res.value.expiresAt).toBe(new Date(NOW + 900_000).toISOString());
    expect(res.value.target.expiresAt).toBe(res.value.expiresAt);
    const url = new URL(res.value.target.url);
    expect(url.pathname).toBe("/artifacts/art_TEST00000000");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(res.value.target.url).not.toContain(SECRET);
  });
  it("rejects malformed artifact ids instead of signing arbitrary keys", async () => {
    const provider = createS3Storage(config(), { now });
    const res = await provider.reserveDownload({
      artifactId: "../escape.pdf",
      filename: "out.pdf",
      contentType: "application/pdf",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.reason).toBe("not_found");
  });
});

describe("createS3Storage — deleteNow", () => {
  it("executes a signed DELETE and reports the object gone on 204", async () => {
    const { fn, calls } = fakeFetch([{ ok: true, status: 204 }]);
    const provider = createS3Storage(config(), { now, fetchImpl: fn });
    const res = await provider.deleteNow("input", "f_TEST00000000");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({ kind: "input", id: "f_TEST00000000", deleted: true });
    expect(res.value.deletedAt).toBe(new Date(NOW).toISOString());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("DELETE");
    expect(new URL(calls[0]!.url).pathname).toBe("/inputs/f_TEST00000000");
  });

  it("treats a 404 as an idempotent success (already gone)", async () => {
    const { fn } = fakeFetch([{ ok: false, status: 404 }]);
    const provider = createS3Storage(config(), { now, fetchImpl: fn });
    const res = await provider.deleteNow("artifact", "art_TEST00000000");
    expect(res.ok && res.value.deleted).toBe(true);
  });

  it("does not issue network requests for malformed ids", async () => {
    const { fn, calls } = fakeFetch([{ ok: true, status: 204 }]);
    const provider = createS3Storage(config(), { now, fetchImpl: fn });
    const res = await provider.deleteNow("artifact", "../../tenant/secret");
    expect(res.ok && res.value.deleted).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("returns an honest unavailable failure on a server error", async () => {
    const { fn } = fakeFetch([{ ok: false, status: 500 }]);
    const provider = createS3Storage(config(), { now, fetchImpl: fn });
    const res = await provider.deleteNow("artifact", "art_TEST00000000");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.reason).toBe("unavailable");
  });

  it("returns an honest unavailable failure when the network throws", async () => {
    const provider = createS3Storage(config(), {
      now,
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    const res = await provider.deleteNow("input", "f_TEST00000000");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.reason).toBe("unavailable");
  });
});
