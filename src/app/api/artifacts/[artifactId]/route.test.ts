// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_POLICY_ID,
  ARTIFACT_POLICY_VERSION,
  type ArtifactManifest,
  type ArtifactRetrievalBackend,
  type ArtifactRetrievalResult,
} from "@/lib/workers/artifacts";
import {
  resetArtifactRetrievalBackendForTests,
  setArtifactRetrievalBackendForTests,
} from "@/lib/workers/artifacts/retrieval-storage";
import {
  resetArtifactRetrievalSink,
  setArtifactRetrievalSink,
} from "@/lib/workers/artifacts/retrieval-metrics";
import {
  resetArtifactRetrievalObserverForTests,
  setArtifactRetrievalObserver,
  type ArtifactRetrievalReceipt,
} from "@/lib/workers/artifacts/retrieval-receipt";
import {
  createWorkerMetricsCollector,
  seriesFor,
} from "@/lib/workers/observability/collector";
import { RATE_LIMIT_ENV, policyFor } from "@/lib/ratelimit";
import { enforceRateLimit, resetRateLimitGuardForTests } from "@/lib/ratelimit/guard";
import { GET } from "./route";

const enc = (s: string) => new TextEncoder().encode(s);
const HANDLE = "art_abcdefghij0123456789";

/** Every S3/worker env name the resolver reads — cleared so the default backend is not-ready. */
const STORAGE_ENV_NAMES = [
  "PDFXYZ_STORAGE_PROVIDER",
  "PDFXYZ_S3_ENDPOINT",
  "PDFXYZ_S3_REGION",
  "PDFXYZ_S3_BUCKET",
  "PDFXYZ_S3_ACCESS_KEY_ID",
  "PDFXYZ_S3_SECRET_ACCESS_KEY",
  "PDFXYZ_WORKER_URL",
  "PDFXYZ_STORAGE_BUCKET",
  "PDFXYZ_JOB_QUEUE",
];

function clearStorageEnv(): void {
  for (const name of STORAGE_ENV_NAMES) delete process.env[name];
}

function get(id: string = HANDLE, query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/artifacts/${id}${query}`), {
    params: Promise.resolve({ artifactId: id }),
  });
}

function pdfManifest(byteCount: number, over: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    outputKind: "pdf",
    contentType: "application/pdf",
    byteCount,
    retentionClass: "short",
    toolSlug: "compress-pdf",
    processor: "compress",
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    ...over,
  };
}

function liveResult(
  bytes: Uint8Array,
  over: Partial<{ contentType: string; manifest: ArtifactManifest | null; jobCompleted: boolean }> = {},
): ArtifactRetrievalResult {
  return {
    kind: "live",
    artifact: {
      contentType: over.contentType ?? "application/pdf",
      byteLength: bytes.byteLength,
      bytes,
      manifest: over.manifest === undefined ? pdfManifest(bytes.byteLength) : over.manifest,
      jobCompleted: over.jobCompleted ?? true,
    },
  };
}

/** Register a fake ready storage backend that resolves `result`. */
function useBackend(result: ArtifactRetrievalResult, ready = true): void {
  const backend: ArtifactRetrievalBackend = {
    capability: () => ({ provider: ready ? "remote-configured" : "not-configured", ready }),
    fetch: async () => result,
  };
  setArtifactRetrievalBackendForTests(backend);
}

beforeEach(() => {
  clearStorageEnv();
  resetArtifactRetrievalBackendForTests();
  resetArtifactRetrievalSink();
});
afterEach(() => {
  resetArtifactRetrievalBackendForTests();
  resetArtifactRetrievalSink();
  resetArtifactRetrievalObserverForTests();
  clearStorageEnv();
});

describe("GET /api/artifacts/[artifactId] — storage-backed retrieval", () => {
  it("answers 503 (no fake wired, storage absent) — honest no-config posture", async () => {
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("worker_not_configured");
  });

  it("rejects a malformed handle with 400 before any backend work", async () => {
    useBackend(liveResult(enc("%PDF")));
    const res = await get("not-a-handle");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("streams a manifest-valid completed artifact with safe, GENERATED headers", async () => {
    const bytes = enc("%PDF-1.7 storage body");
    useBackend(liveResult(bytes));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(bytes.byteLength));
    // Generated from the manifest's kind/processor — never a stored/user name or object key.
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="compressed.pdf"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("streams a manifest-less artifact via intrinsic checks (honesty, no provenance claim)", async () => {
    const bytes = enc("%PDF legacy");
    useBackend(liveResult(bytes, { manifest: null }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="document.pdf"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("returns 404 for a missing object (a bucket 404 is honest not_found)", async () => {
    useBackend({ kind: "absent" });
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("returns 410 for an expired or deleted object", async () => {
    useBackend({ kind: "expired" });
    expect((await get()).status).toBe(410);
    useBackend({ kind: "deleted" });
    expect((await get()).status).toBe(410);
  });

  it("returns 422 for a manifest that fails re-validation (byte-count desync)", async () => {
    const bytes = enc("%PDF desync");
    useBackend(liveResult(bytes, { manifest: pdfManifest(bytes.byteLength + 100) }));
    const res = await get();
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unprocessable_entity");
  });

  it("returns a retryable 503 service_unavailable for a transient storage failure", async () => {
    useBackend({ kind: "unavailable" });
    const res = await get();
    expect(res.status).toBe(503);
    // Distinct from worker_not_configured: storage IS configured, it just hiccupped.
    expect((await res.json()).error.code).toBe("service_unavailable");
  });
});

describe("GET /api/artifacts/[artifactId] — privacy (headers/body leak nothing)", () => {
  const FORBIDDEN = [
    "/etc/passwd",
    "Confidential Salaries.pdf",
    "X-Amz-Signature=deadbeef",
    "AWS_SECRET_ACCESS_KEY",
    "123-45-6789", // SSN in the document bytes
    "patient record", // recognized OCR text in the document bytes
    "https://pdfxyz-secret.s3.amazonaws.com/artifacts/art_x", // a signed URL / object key
    "pdfxyz-secret-bucket", // bucket name
    "s3.us-east-1.amazonaws.com", // endpoint
    "Bearer tok_hostile", // a request token
  ];

  it("never echoes a hostile content-type param, object key, bucket, OCR text, or token into any header", async () => {
    const bytes = enc("123-45-6789 patient record X-Amz-Signature=deadbeef");
    useBackend(
      liveResult(bytes, {
        // A raw content-type whose parameter is stuffed with a secret; the served type is canonical.
        contentType: "application/pdf; note=AWS_SECRET_ACCESS_KEY",
        // A manifest whose (unused-downstream) fields are stuffed with secrets.
        manifest: pdfManifest(bytes.byteLength, { toolSlug: "pdfxyz-secret-bucket" }),
      }),
    );
    const res = await get();
    expect(res.status).toBe(200);
    const headerBlob = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    for (const secret of FORBIDDEN) {
      expect(headerBlob, `header leaked "${secret}"`).not.toContain(secret);
    }
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="compressed.pdf"');
  });

  it("a denial body carries only a fixed, content-free code + message", async () => {
    useBackend({ kind: "unavailable" });
    const res = await get();
    const text = JSON.stringify(await res.json());
    for (const secret of FORBIDDEN) expect(text).not.toContain(secret);
  });
});

describe("GET /api/artifacts/[artifactId] — observability", () => {
  let collector: ReturnType<typeof createWorkerMetricsCollector>;
  beforeEach(() => {
    collector = createWorkerMetricsCollector();
    setArtifactRetrievalSink(collector.sink);
  });

  it("emits a bounded served metric for a storage-backed download", async () => {
    useBackend(liveResult(enc("%PDF metric")));
    await get();
    const served = seriesFor(collector.snapshot(), "worker_artifact_retrieval_total", {
      outcome: "served",
      reason: "ok",
      kind: "pdf",
    });
    expect(served).toHaveLength(1);
  });

  it("emits a bounded denied metric carrying the transient storage_error reason", async () => {
    useBackend({ kind: "unavailable" });
    await get();
    const denied = seriesFor(collector.snapshot(), "worker_artifact_retrieval_total", {
      outcome: "denied",
      reason: "storage_error",
    });
    expect(denied).toHaveLength(1);
    // Closed, low-cardinality label set — including the bounded storage provider.
    expect(Object.keys(denied[0]!.labels).sort()).toEqual([
      "kind",
      "outcome",
      "provider",
      "reason",
    ]);
    // A configured (ready) storage backend reports remote-configured, never a bucket name.
    expect(denied[0]!.labels.provider).toBe("remote-configured");
  });

  it("emits a content-free receipt that never carries the handle", async () => {
    const receipts: ArtifactRetrievalReceipt[] = [];
    setArtifactRetrievalObserver((r) => receipts.push(r));
    useBackend(liveResult(enc("%PDF receipt")));
    await get();
    expect(receipts[0]).toMatchObject({ category: "retrieval", outcome: "served", reason: "ok" });
    expect(JSON.stringify(receipts[0])).not.toContain(HANDLE);
  });
});

describe("GET /api/artifacts/[artifactId] — abuse guard", () => {
  beforeEach(() => {
    resetRateLimitGuardForTests();
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  });
  afterEach(() => {
    resetRateLimitGuardForTests();
    delete process.env[RATE_LIMIT_ENV.provider];
  });

  it("throttles downloads with a 429 before any backend work", async () => {
    useBackend(liveResult(enc("%PDF")));
    const policy = policyFor("artifacts.fetch");
    const bare = new Request("http://localhost/api/artifacts/x");
    for (let i = 0; i < policy.limit; i++) await enforceRateLimit("artifacts.fetch", bare);

    const denied = await get();
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("rate_limited");
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
