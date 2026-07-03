// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { parseS3Config, type S3StorageConfig } from "../storage/s3-config";
import { buildObjectKey } from "../storage/s3-keys";
import {
  ARTIFACT_MANIFEST_METADATA_HEADER,
  encodeArtifactManifestMetadata,
} from "../storage/s3-manifest-metadata";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import type { ArtifactManifest } from "./types";
import type { ArtifactRetrievalBackend } from "./retrieval";
import {
  createS3ArtifactReader,
  createStorageArtifactBackend,
  resetArtifactRetrievalBackendForTests,
  resolveArtifactRetrievalBackend,
  setArtifactRetrievalBackendForTests,
  storageArtifactBackend,
  type S3ArtifactFetch,
  type S3ArtifactObjectResponse,
} from "./retrieval-storage";

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);
const now = () => NOW;
const S3_SECRET = "s3-secret-value-1234567890";
const ARTIFACT_ID = "art_abcdefghij0123456789";

const S3_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: S3_SECRET,
} as const;

function config(): S3StorageConfig {
  const parsed = parseS3Config({ ...S3_ENV });
  if (!parsed.ok) throw new Error("fixture config should parse");
  return parsed.config;
}

function manifest(byteCount: number): ArtifactManifest {
  return {
    outputKind: "pdf",
    contentType: "application/pdf",
    byteCount,
    retentionClass: "short",
    toolSlug: "compress-pdf",
    processor: "compress",
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
  };
}

interface Scripted {
  status: number;
  contentType?: string;
  bytes?: Uint8Array;
  manifestMeta?: string;
  /** Value for the object's `Content-Length` response header (a string as a bucket sends it). */
  contentLength?: string;
  /** Throw at the `fetch` call itself — a PRE-stream failure (DNS/reset before a response). */
  throws?: boolean;
  /** Return a 200 response whose `arrayBuffer()` then rejects — a mid-read STREAM failure. */
  throwsBody?: boolean;
}

function fakeFetch(script: Scripted[]): { fn: S3ArtifactFetch; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fn: S3ArtifactFetch = async (url) => {
    calls.push(url);
    const res = script[Math.min(i, script.length - 1)] ?? { status: 200 };
    i += 1;
    if (res.throws) throw new Error("network down");
    const response: S3ArtifactObjectResponse = {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: {
        get: (name) => {
          const key = name.toLowerCase();
          if (key === "content-type") return res.contentType ?? null;
          if (key === ARTIFACT_MANIFEST_METADATA_HEADER) return res.manifestMeta ?? null;
          if (key === "content-length") return res.contentLength ?? null;
          return null;
        },
      },
      arrayBuffer: async () => {
        // A body read that fails mid-stream (the 200 headers arrived, then the connection
        // dropped) — the reader must treat it as transient, never a truncated/false success.
        if (res.throwsBody) throw new Error("connection reset mid-body");
        return (res.bytes ?? new Uint8Array()).slice().buffer as ArrayBuffer;
      },
    };
    return response;
  };
  return { fn, calls };
}

afterEach(resetArtifactRetrievalBackendForTests);

describe("createS3ArtifactReader", () => {
  it("reads bytes + content-type + the decoded manifest on a 200", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes,
        manifestMeta: encodeArtifactManifestMetadata(manifest(bytes.byteLength)),
      },
    ]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("ok");
    if (read.status === "ok") {
      expect(read.bytes).toEqual(bytes);
      expect(read.contentType).toBe("application/pdf");
      expect(read.manifest).toEqual(manifest(bytes.byteLength));
    }
    // Signed GET, targets the canonical artifact key by opaque id, never the secret.
    expect(calls[0]).toContain(`/artifacts/${ARTIFACT_ID}`);
    expect(calls[0]).toContain("X-Amz-Signature=");
    expect(calls[0]).not.toContain(S3_SECRET);
  });

  it("yields a null manifest when no metadata is present (intrinsic path)", async () => {
    const { fn } = fakeFetch([{ status: 200, contentType: "application/pdf", bytes: new Uint8Array([9]) }]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.manifest).toBeNull();
  });

  it("captures the bucket's Content-Length header as reportedLength", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { fn } = fakeFetch([
      { status: 200, contentType: "application/pdf", bytes, contentLength: "4" },
    ]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.reportedLength).toBe(4);
  });

  it("yields a null reportedLength when Content-Length is absent or malformed", async () => {
    const absent = createS3ArtifactReader(config(), {
      now,
      fetchImpl: fakeFetch([{ status: 200, bytes: new Uint8Array([1]) }]).fn,
    });
    const readA = await absent.readArtifact(ARTIFACT_ID);
    if (readA.status === "ok") expect(readA.reportedLength).toBeNull();

    const malformed = createS3ArtifactReader(config(), {
      now,
      fetchImpl: fakeFetch([{ status: 200, bytes: new Uint8Array([1]), contentLength: "not-a-number" }]).fn,
    });
    const readB = await malformed.readArtifact(ARTIFACT_ID);
    if (readB.status === "ok") expect(readB.reportedLength).toBeNull();
  });

  it("maps a 404 to not-found", async () => {
    const { fn } = fakeFetch([{ status: 404 }]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    expect((await reader.readArtifact(ARTIFACT_ID)).status).toBe("not-found");
  });

  it("maps a 5xx and a network error to unavailable (retryable, never a false not-found)", async () => {
    const server = createS3ArtifactReader(config(), { now, fetchImpl: fakeFetch([{ status: 503 }]).fn });
    expect((await server.readArtifact(ARTIFACT_ID)).status).toBe("unavailable");
    const netw = createS3ArtifactReader(config(), { now, fetchImpl: fakeFetch([{ status: 0, throws: true }]).fn });
    expect((await netw.readArtifact(ARTIFACT_ID)).status).toBe("unavailable");
  });

  it("maps a STREAM-read failure (200 headers, then arrayBuffer rejects) to unavailable", async () => {
    // The distinct second failure mode: the response status was fine, but reading the body
    // failed mid-stream. The reader must NOT surface a partial/false-ok — it is transient.
    const { fn } = fakeFetch([
      { status: 200, contentType: "application/pdf", throwsBody: true },
    ]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    expect((await reader.readArtifact(ARTIFACT_ID)).status).toBe("unavailable");
    // And it composes through the backend seam to the transient retrieval lifecycle (→ 503).
    const backend = createStorageArtifactBackend(reader, { provider: "remote-configured", ready: true });
    expect((await backend.fetch(ARTIFACT_ID)).kind).toBe("unavailable");
  });

  it("rejects a malformed artifact id without touching storage", async () => {
    const { fn, calls } = fakeFetch([{ status: 200 }]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    expect((await reader.readArtifact("../etc/passwd")).status).toBe("not-found");
    expect(calls).toHaveLength(0);
  });

  it("reads the exact key the worker writeArtifact wrote (no drift)", async () => {
    const cfg = config();
    const { fn, calls } = fakeFetch([{ status: 200, bytes: new Uint8Array([1]) }]);
    const reader = createS3ArtifactReader(cfg, { now, fetchImpl: fn });
    await reader.readArtifact(ARTIFACT_ID);
    const key = buildObjectKey(cfg, "artifact", ARTIFACT_ID);
    expect(new URL(calls[0]!).pathname).toContain(key);
  });
});

describe("createStorageArtifactBackend — lifecycle mapping", () => {
  const cap = { provider: "remote-configured", ready: true } as const;

  it("maps a read ok to a live artifact (job completed, no owning-job binding)", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const backend = createStorageArtifactBackend(
      {
        readArtifact: async () => ({
          status: "ok",
          bytes,
          contentType: "application/pdf",
          manifest: manifest(3),
          reportedLength: 3,
        }),
      },
      cap,
    );
    const result = await backend.fetch(ARTIFACT_ID);
    expect(result.kind).toBe("live");
    if (result.kind === "live") {
      expect(result.artifact.jobCompleted).toBe(true);
      expect(result.artifact.jobId).toBeUndefined();
      expect(result.artifact.byteLength).toBe(3);
      // The bucket's declared length is carried through for the delivery layer to verify.
      expect(result.artifact.reportedLength).toBe(3);
    }
  });

  it("maps not-found to absent and unavailable to the transient outcome", async () => {
    const absent = createStorageArtifactBackend(
      { readArtifact: async () => ({ status: "not-found" }) },
      cap,
    );
    expect((await absent.fetch(ARTIFACT_ID)).kind).toBe("absent");
    const transient = createStorageArtifactBackend(
      { readArtifact: async () => ({ status: "unavailable" }) },
      cap,
    );
    expect((await transient.fetch(ARTIFACT_ID)).kind).toBe("unavailable");
  });
});

describe("resolveArtifactRetrievalBackend", () => {
  it("is ready when S3 is fully configured", () => {
    const backend = resolveArtifactRetrievalBackend({ ...S3_ENV });
    expect(backend.capability()).toEqual({ provider: "remote-configured", ready: true });
  });

  it("is not-configured (and never ready) with no storage wired", () => {
    const backend = resolveArtifactRetrievalBackend({});
    expect(backend.capability().ready).toBe(false);
    expect(backend.capability().provider).toBe("not-configured");
  });

  it("stays not-ready when a worker backend is present but S3 is not selected (no fingerprinting)", () => {
    const backend = resolveArtifactRetrievalBackend({
      PDFXYZ_WORKER_URL: "https://worker.example.com",
      PDFXYZ_STORAGE_BUCKET: "b",
      PDFXYZ_JOB_QUEUE: "q",
    });
    expect(backend.capability().ready).toBe(false);
    expect(backend.capability().provider).toBe("remote-configured");
  });
});

describe("storageArtifactBackend — test override", () => {
  it("returns the registered fake, then the env-resolved backend after reset", () => {
    const fake: ArtifactRetrievalBackend = {
      capability: () => ({ provider: "remote-configured", ready: true }),
      fetch: async () => ({ kind: "absent" }),
    };
    setArtifactRetrievalBackendForTests(fake);
    expect(storageArtifactBackend({})).toBe(fake);
    resetArtifactRetrievalBackendForTests();
    expect(storageArtifactBackend({})).not.toBe(fake);
  });
});
