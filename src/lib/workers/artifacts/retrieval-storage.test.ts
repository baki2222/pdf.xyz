// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { parseS3Config, type S3StorageConfig } from "../storage/s3-config";
import { buildObjectKey } from "../storage/s3-keys";
import {
  ARTIFACT_MANIFEST_METADATA_HEADER,
  encodeArtifactManifestMetadata,
} from "../storage/s3-manifest-metadata";
import {
  ARTIFACT_LIFECYCLE_METADATA_HEADER,
  encodeArtifactLifecycleMetadata,
} from "../storage/s3-lifecycle-metadata";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import type { ArtifactManifest } from "./types";
import type { ArtifactRetrievalBackend } from "./retrieval";
import type { WorkerMetricSample } from "../observability/metrics";
import {
  resetArtifactExpirySink,
  setArtifactExpirySink,
} from "./expiry-metrics";
import {
  resetArtifactExpiryObserverForTests,
  setArtifactExpiryObserver,
  type ArtifactExpiryReceipt,
} from "./expiry-receipt";
import {
  createS3ArtifactReader,
  createStorageArtifactBackend,
  resetArtifactRetrievalBackendForTests,
  resolveArtifactRetrievalBackend,
  setArtifactRetrievalBackendForTests,
  storageArtifactBackend,
  type S3ArtifactFetch,
  type S3ArtifactObjectResponse,
  type S3ArtifactRead,
} from "./retrieval-storage";

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);
const now = () => NOW;
const S3_FIXTURE_CREDENTIAL = "s3-fixture-redacted-value";
const ARTIFACT_ID = "art_abcdefghij0123456789";
const FUTURE = NOW + 60 * 60_000; // 1h ahead — a live retention window
const PAST = NOW - 1; // just past — an expired retention window

const S3_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: S3_FIXTURE_CREDENTIAL,
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

/** A live (future-window) lifecycle metadata header value. */
const liveLifecycle = encodeArtifactLifecycleMetadata({
  expiresAtMs: FUTURE,
  deleted: false,
});
/** An expired (past-window) lifecycle metadata header value. */
const expiredLifecycle = encodeArtifactLifecycleMetadata({
  expiresAtMs: PAST,
  deleted: false,
});
/** A tombstoned lifecycle metadata header value (deleted before its window). */
const deletedLifecycle = encodeArtifactLifecycleMetadata({
  expiresAtMs: FUTURE,
  deleted: true,
});

interface Scripted {
  status: number;
  contentType?: string;
  bytes?: Uint8Array;
  manifestMeta?: string;
  /** Value for the `x-amz-meta-artifact-lifecycle` response header (signed lifecycle evidence). */
  lifecycleMeta?: string;
  /** Value for the object's `Content-Length` response header (a string as a bucket sends it). */
  contentLength?: string;
  /** Throw at the `fetch` call itself — a PRE-stream failure (DNS/reset before a response). */
  throws?: boolean;
  /** Return a 200 response whose `arrayBuffer()` then rejects — a mid-read STREAM failure. */
  throwsBody?: boolean;
}

function fakeFetch(script: Scripted[]): {
  fn: S3ArtifactFetch;
  calls: string[];
  bodyReads: number;
} {
  const calls: string[] = [];
  const counters = { bodyReads: 0 };
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
          if (key === ARTIFACT_MANIFEST_METADATA_HEADER)
            return res.manifestMeta ?? null;
          if (key === ARTIFACT_LIFECYCLE_METADATA_HEADER)
            return res.lifecycleMeta ?? null;
          if (key === "content-length") return res.contentLength ?? null;
          return null;
        },
      },
      arrayBuffer: async () => {
        counters.bodyReads += 1;
        // A body read that fails mid-stream (the 200 headers arrived, then the connection
        // dropped) — the reader must treat it as transient, never a truncated/false success.
        if (res.throwsBody) throw new Error("connection reset mid-body");
        return (res.bytes ?? new Uint8Array()).slice().buffer as ArrayBuffer;
      },
    };
    return response;
  };
  return {
    fn,
    calls,
    get bodyReads() {
      return counters.bodyReads;
    },
  };
}

afterEach(() => {
  resetArtifactRetrievalBackendForTests();
  resetArtifactExpirySink();
  resetArtifactExpiryObserverForTests();
});

describe("createS3ArtifactReader", () => {
  it("reads bytes + content-type + the decoded manifest on a live 200", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes,
        manifestMeta: encodeArtifactManifestMetadata(
          manifest(bytes.byteLength),
        ),
        lifecycleMeta: liveLifecycle,
      },
    ]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("ok");
    if (read.status === "ok") {
      expect(read.bytes).toEqual(bytes);
      expect(read.contentType).toBe("application/pdf");
      expect(read.manifest).toEqual(manifest(bytes.byteLength));
      expect(read.lifecycleState).toBe("live");
    }
    // Signed GET, targets the canonical artifact key by opaque id, never the secret.
    expect(calls[0]).toContain(`/artifacts/${ARTIFACT_ID}`);
    expect(calls[0]).toContain("X-Amz-Signature=");
    expect(calls[0]).not.toContain(S3_FIXTURE_CREDENTIAL);
  });

  it("yields a null manifest when no metadata is present (intrinsic path)", async () => {
    const { fn } = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes: new Uint8Array([9]),
      },
    ]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.manifest).toBeNull();
  });

  it("captures the bucket's Content-Length header as reportedLength", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { fn } = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes,
        contentLength: "4",
      },
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
      fetchImpl: fakeFetch([
        {
          status: 200,
          bytes: new Uint8Array([1]),
          contentLength: "not-a-number",
        },
      ]).fn,
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
    const server = createS3ArtifactReader(config(), {
      now,
      fetchImpl: fakeFetch([{ status: 503 }]).fn,
    });
    expect((await server.readArtifact(ARTIFACT_ID)).status).toBe("unavailable");
    const netw = createS3ArtifactReader(config(), {
      now,
      fetchImpl: fakeFetch([{ status: 0, throws: true }]).fn,
    });
    expect((await netw.readArtifact(ARTIFACT_ID)).status).toBe("unavailable");
  });

  it("maps a STREAM-read failure (200 headers, then arrayBuffer rejects) to unavailable", async () => {
    // The distinct second failure mode: the response status was fine, but reading the body
    // failed mid-stream. The reader must NOT surface a partial/false-ok — it is transient.
    const { fn } = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        throwsBody: true,
        lifecycleMeta: liveLifecycle,
      },
    ]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    expect((await reader.readArtifact(ARTIFACT_ID)).status).toBe("unavailable");
    // And it composes through the backend seam to the transient retrieval lifecycle (→ 503).
    const backend = createStorageArtifactBackend(reader, {
      provider: "remote-configured",
      ready: true,
    });
    expect((await backend.fetch(ARTIFACT_ID)).kind).toBe("unavailable");
  });

  it("rejects a malformed artifact id without touching storage", async () => {
    const { fn, calls } = fakeFetch([{ status: 200 }]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    expect((await reader.readArtifact("../etc/passwd")).status).toBe(
      "not-found",
    );
    expect(calls).toHaveLength(0);
  });

  it("reads the exact key the worker writeArtifact wrote (no drift)", async () => {
    const cfg = config();
    const { fn, calls } = fakeFetch([
      { status: 200, bytes: new Uint8Array([1]) },
    ]);
    const reader = createS3ArtifactReader(cfg, { now, fetchImpl: fn });
    await reader.readArtifact(ARTIFACT_ID);
    const key = buildObjectKey(cfg, "artifact", ARTIFACT_ID);
    expect(new URL(calls[0]!).pathname).toContain(key);
  });
});

describe("createS3ArtifactReader — lifecycle/expiry enforcement", () => {
  it("denies an expired-but-present object as `expired` WITHOUT reading its body", async () => {
    // The bucket still returns 200 (lifecycle rule has not reaped it), but the signed
    // retention window has passed — the reader must deny before buffering a single byte.
    const probe = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
        throwsBody: true,
        lifecycleMeta: expiredLifecycle,
      },
    ]);
    const reader = createS3ArtifactReader(config(), {
      now,
      fetchImpl: probe.fn,
    });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("expired");
    // The body was never read (throwsBody would have surfaced as `unavailable` otherwise).
    expect(probe.bodyReads).toBe(0);
  });

  it("denies a tombstoned object as `deleted` even with a future window", async () => {
    const probe = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes: new Uint8Array([1]),
        lifecycleMeta: deletedLifecycle,
      },
    ]);
    const reader = createS3ArtifactReader(config(), {
      now,
      fetchImpl: probe.fn,
    });
    expect((await reader.readArtifact(ARTIFACT_ID)).status).toBe("deleted");
    expect(probe.bodyReads).toBe(0);
  });

  it("serves a live-window object (lifecycleState `live`)", async () => {
    const { fn } = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes: new Uint8Array([1]),
        lifecycleMeta: liveLifecycle,
      },
    ]);
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.lifecycleState).toBe("live");
  });

  it("serves an object with NO / malformed lifecycle evidence honestly (lifecycleState `unknown`)", async () => {
    for (const lifecycleMeta of [undefined, "%%bogus", "not-json"]) {
      const { fn } = fakeFetch([
        {
          status: 200,
          contentType: "application/pdf",
          bytes: new Uint8Array([1]),
          lifecycleMeta,
        },
      ]);
      const reader = createS3ArtifactReader(config(), { now, fetchImpl: fn });
      const read = await reader.readArtifact(ARTIFACT_ID);
      expect(read.status).toBe("ok");
      if (read.status === "ok") expect(read.lifecycleState).toBe("unknown");
    }
  });
});

describe("createStorageArtifactBackend — lifecycle mapping", () => {
  const cap = { provider: "remote-configured", ready: true } as const;

  function readerReturning(read: S3ArtifactRead) {
    return { readArtifact: async () => read };
  }

  it("maps a live read to a live artifact (job completed, no owning-job binding)", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const backend = createStorageArtifactBackend(
      readerReturning({
        status: "ok",
        bytes,
        contentType: "application/pdf",
        manifest: manifest(3),
        reportedLength: 3,
        lifecycleState: "live",
      }),
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

  it("maps expired/deleted to the matching lifecycle denial (→ 410)", async () => {
    const expired = createStorageArtifactBackend(
      readerReturning({ status: "expired" }),
      cap,
    );
    expect((await expired.fetch(ARTIFACT_ID)).kind).toBe("expired");
    const deleted = createStorageArtifactBackend(
      readerReturning({ status: "deleted" }),
      cap,
    );
    expect((await deleted.fetch(ARTIFACT_ID)).kind).toBe("deleted");
  });

  it("maps not-found to absent and unavailable to the transient outcome", async () => {
    const absent = createStorageArtifactBackend(
      readerReturning({ status: "not-found" }),
      cap,
    );
    expect((await absent.fetch(ARTIFACT_ID)).kind).toBe("absent");
    const transient = createStorageArtifactBackend(
      readerReturning({ status: "unavailable" }),
      cap,
    );
    expect((await transient.fetch(ARTIFACT_ID)).kind).toBe("unavailable");
  });
});

describe("createStorageArtifactBackend — content-free lifecycle observability", () => {
  const cap = { provider: "remote-configured", ready: true } as const;

  function spies() {
    const metrics: WorkerMetricSample[] = [];
    const receipts: ArtifactExpiryReceipt[] = [];
    setArtifactExpirySink((m) => metrics.push(m));
    setArtifactExpiryObserver((r) => receipts.push(r));
    return { metrics, receipts };
  }

  function backendFor(read: S3ArtifactRead) {
    return createStorageArtifactBackend(
      { readArtifact: async () => read },
      cap,
    );
  }

  const liveOk: S3ArtifactRead = {
    status: "ok",
    bytes: new Uint8Array([1]),
    contentType: "application/pdf",
    manifest: manifest(1),
    reportedLength: 1,
    lifecycleState: "live",
  };
  const unknownOk: S3ArtifactRead = {
    ...liveOk,
    manifest: null,
    lifecycleState: "unknown",
  };

  it("emits the resolved state for each present-object read (served/expired/deleted/unknown)", async () => {
    const cases: Array<[S3ArtifactRead, string]> = [
      [liveOk, "live"],
      [unknownOk, "unknown"],
      [{ status: "expired" }, "expired"],
      [{ status: "deleted" }, "deleted"],
    ];
    for (const [read, expected] of cases) {
      const { metrics, receipts } = spies();
      await backendFor(read).fetch(ARTIFACT_ID);
      expect(metrics).toHaveLength(1);
      expect(metrics[0]!.metric).toBe("worker_artifact_expiry_total");
      expect(metrics[0]!.labels).toEqual({
        state: expected,
        provider: "remote-configured",
      });
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.state).toBe(expected);
      expect(receipts[0]!.provider).toBe("remote-configured");
      resetArtifactExpirySink();
      resetArtifactExpiryObserverForTests();
    }
  });

  it("emits NOTHING for a not-found or transient read (no present object to evaluate)", async () => {
    for (const read of [
      { status: "not-found" },
      { status: "unavailable" },
    ] as const) {
      const { metrics, receipts } = spies();
      await backendFor(read).fetch(ARTIFACT_ID);
      expect(metrics).toHaveLength(0);
      expect(receipts).toHaveLength(0);
      resetArtifactExpirySink();
      resetArtifactExpiryObserverForTests();
    }
  });

  it("the emitted metric + receipt carry no handle, key, bucket, or instant", async () => {
    const { metrics, receipts } = spies();
    await backendFor({ status: "expired" }).fetch(ARTIFACT_ID);
    const serialized = JSON.stringify({ metrics, receipts }).toLowerCase();
    for (const bad of [
      ARTIFACT_ID.toLowerCase(),
      "art_",
      "pdfxyz-store",
      "://",
      "amazonaws",
      String(PAST),
    ]) {
      expect(serialized).not.toContain(bad);
    }
  });

  it("a throwing sink/observer never breaks the download decision", async () => {
    setArtifactExpirySink(() => {
      throw new Error("collector down");
    });
    setArtifactExpiryObserver(() => {
      throw new Error("siem down");
    });
    const result = await backendFor(liveOk).fetch(ARTIFACT_ID);
    expect(result.kind).toBe("live");
  });
});

describe("resolveArtifactRetrievalBackend", () => {
  it("is ready when S3 is fully configured", () => {
    const backend = resolveArtifactRetrievalBackend({ ...S3_ENV });
    expect(backend.capability()).toEqual({
      provider: "remote-configured",
      ready: true,
    });
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
