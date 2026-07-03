// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, REQUIRED_WORKER_ENV, type Job } from "@/lib/jobs";
import { WORKER_MODE_ENV } from "@/lib/workers";
import { devWorkerStore, newArtifactId, newJobId } from "@/lib/workers/store";
import {
  ARTIFACT_POLICY_ID,
  ARTIFACT_POLICY_VERSION,
  type ArtifactManifest,
} from "@/lib/workers/artifacts";
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

function get(artifactId: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/artifacts/local/${artifactId}`),
    { params: Promise.resolve({ artifactId }) },
  );
}

function enableLocalDev() {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  process.env[WORKER_MODE_ENV] = "local-dev";
}

function disableWorker() {
  for (const name of REQUIRED_WORKER_ENV) delete process.env[name];
  delete process.env[WORKER_MODE_ENV];
}

/** A valid, content-free PDF provenance manifest whose byte count matches the bytes. */
function pdfManifest(
  byteCount: number,
  over: Partial<ArtifactManifest> = {},
): ArtifactManifest {
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

/** Seed a downloadable artifact (valid manifest by default) and return the stored entry. */
function seed(
  bytes: Uint8Array,
  opts: {
    filename?: string;
    contentType?: string;
    /** `undefined` ⇒ a valid PDF manifest; `null` ⇒ store WITHOUT a manifest. */
    manifest?: ArtifactManifest | null;
  } = {},
) {
  const artifactId = newArtifactId();
  const stored = devWorkerStore.putArtifact({
    artifactId,
    jobId: newJobId(),
    filename: opts.filename ?? "report-compressed.pdf",
    contentType: opts.contentType ?? "application/pdf",
    bytes,
    ...(opts.manifest === null
      ? {}
      : { manifest: opts.manifest ?? pdfManifest(bytes.byteLength) }),
  });
  return { artifactId, stored };
}

beforeEach(() => {
  devWorkerStore.reset();
  resetArtifactRetrievalSink();
});
afterEach(() => {
  disableWorker();
  resetArtifactRetrievalSink();
});

describe("GET /api/artifacts/local/[artifactId]", () => {
  it("is inert (503) unless local-dev mode is on", async () => {
    disableWorker();
    const res = await get(newArtifactId());
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("worker_not_configured");
  });

  it("rejects a malformed artifact id with 400", async () => {
    enableLocalDev();
    const res = await get("nope");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("returns 404 for an unknown artifact", async () => {
    enableLocalDev();
    const res = await get(newArtifactId());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("streams a manifest-valid PDF with safe, GENERATED headers", async () => {
    enableLocalDev();
    const bytes = enc("%PDF-1.7 body");
    const { artifactId } = seed(bytes, { filename: "My Secret Report.pdf" });

    const res = await get(artifactId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(bytes.byteLength));
    // The filename is GENERATED from the output kind/tool — never the stored/user name.
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="compressed.pdf"',
    );
    expect(res.headers.get("content-disposition")).not.toContain("Secret");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("still downloads a manifest-less artifact via intrinsic checks (gate-disabled honesty)", async () => {
    enableLocalDev();
    const bytes = enc("%PDF-1.7 legacy");
    const { artifactId } = seed(bytes, { manifest: null });

    const res = await get(artifactId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    // No processor provenance to draw on ⇒ the generic kind noun.
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="document.pdf"',
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("denies an expired artifact with 410 gone", async () => {
    enableLocalDev();
    const bytes = enc("%PDF gone");
    const { artifactId, stored } = seed(bytes);
    stored.expiresAt = Date.now() - 1; // force the retention window closed

    const res = await get(artifactId);
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("gone");
  });

  it("denies an explicitly-deleted artifact with 410 gone (distinct from an unknown 404)", async () => {
    enableLocalDev();
    const { artifactId } = seed(enc("%PDF bye"));
    expect(devWorkerStore.deleteArtifact(artifactId)).toBe(true);

    const res = await get(artifactId);
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("gone");
  });

  it("denies job_mismatch with 403 forbidden when ?job= names the wrong job", async () => {
    enableLocalDev();
    const { artifactId } = seed(enc("%PDF job"));
    const res = await GET(
      new Request(
        `http://localhost/api/artifacts/local/${artifactId}?job=${newJobId()}`,
      ),
      { params: Promise.resolve({ artifactId }) },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("denies an artifact whose manifest byte-count desynced (422 invalid_manifest)", async () => {
    enableLocalDev();
    const bytes = enc("%PDF four");
    const { artifactId } = seed(bytes, {
      manifest: pdfManifest(bytes.byteLength + 100), // recorded count ≠ actual bytes
    });

    const res = await get(artifactId);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unprocessable_entity");
  });

  it("denies an unsupported output kind with 415", async () => {
    enableLocalDev();
    const bytes = enc("weird bytes");
    const { artifactId } = seed(bytes, {
      contentType: "application/x-weird",
      manifest: pdfManifest(bytes.byteLength, {
        outputKind: "unknown",
        contentType: "application/x-weird",
      }),
    });

    const res = await get(artifactId);
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("unsupported_media_type");
  });

  it("denies an empty artifact with 422", async () => {
    enableLocalDev();
    const bytes = new Uint8Array();
    const { artifactId } = seed(bytes, { manifest: pdfManifest(0) });

    const res = await get(artifactId);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unprocessable_entity");
  });

  it("denies not_ready when the owning job is not completed (409)", async () => {
    enableLocalDev();
    const bytes = enc("%PDF pending");
    const artifactId = newArtifactId();
    const jobId = newJobId();
    devWorkerStore.putArtifact({
      artifactId,
      jobId,
      filename: "x.pdf",
      contentType: "application/pdf",
      bytes,
      manifest: pdfManifest(bytes.byteLength),
    });
    const job: Job = {
      jobId,
      tool: "compress-pdf",
      capability: "secure-worker",
      status: "processing",
      progress: 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      retention: DEFAULT_RETENTION,
    };
    devWorkerStore.putJob(job);

    const res = await get(artifactId);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
  });
});

describe("GET /api/artifacts/local/[artifactId] — privacy (headers leak nothing)", () => {
  const FORBIDDEN = [
    "/etc/passwd",
    "Confidential Salaries.pdf",
    "X-Amz-Signature=deadbeef",
    "AWS_SECRET_ACCESS_KEY",
    "123-45-6789", // an SSN embedded in the document bytes
    "patient record", // recognized OCR text in the document bytes
    "https://bucket.s3.amazonaws.com/outputs/x", // a signed URL
  ];

  it("never echoes a hostile filename, object key, OCR text, or signed URL into any header", async () => {
    enableLocalDev();
    // A produced output whose stored filename + content-type parameter + bytes are all
    // stuffed with secrets. The served bytes ARE the document (not a leak); the guard is
    // that NONE of the response HEADERS carry any of it.
    const bytes = enc("123-45-6789 patient record X-Amz-Signature=deadbeef");
    const { artifactId } = seed(bytes, {
      filename: "/etc/passwd Confidential Salaries.pdf",
      contentType: "application/pdf; note=AWS_SECRET_ACCESS_KEY",
      manifest: pdfManifest(bytes.byteLength),
    });

    const res = await get(artifactId);
    expect(res.status).toBe(200);

    const headerBlob = [...res.headers.entries()]
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    for (const secret of FORBIDDEN) {
      expect(headerBlob, `header leaked "${secret}"`).not.toContain(secret);
    }
    // The disposition is the generated name, and the canonical content-type has no param.
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="compressed.pdf"',
    );
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("a denial body carries only a fixed, content-free code + message", async () => {
    enableLocalDev();
    const bytes = enc("desync");
    const { artifactId } = seed(bytes, {
      filename: "/etc/passwd Confidential Salaries.pdf",
      manifest: pdfManifest(bytes.byteLength + 1),
    });

    const res = await get(artifactId);
    const text = JSON.stringify(await res.json());
    for (const secret of FORBIDDEN) expect(text).not.toContain(secret);
  });
});

describe("GET /api/artifacts/local/[artifactId] — retrieval observability", () => {
  let collector: ReturnType<typeof createWorkerMetricsCollector>;
  beforeEach(() => {
    collector = createWorkerMetricsCollector();
    setArtifactRetrievalSink(collector.sink);
    enableLocalDev();
  });

  it("emits a bounded served metric for a valid download", async () => {
    const bytes = enc("%PDF metric");
    const { artifactId } = seed(bytes);
    await get(artifactId);

    const served = seriesFor(collector.snapshot(), "worker_artifact_retrieval_total", {
      outcome: "served",
      reason: "ok",
      kind: "pdf",
    });
    expect(served).toHaveLength(1);
    expect(served[0]!.value).toBe(1);
  });

  it("emits a bounded denied metric with the distinct reason", async () => {
    await get(newArtifactId()); // unknown → denied/not_found

    const denied = seriesFor(collector.snapshot(), "worker_artifact_retrieval_total", {
      outcome: "denied",
      reason: "not_found",
    });
    expect(denied).toHaveLength(1);
    // The label set is closed — only outcome/reason/kind/provider, all bounded enums.
    expect(Object.keys(denied[0]!.labels).sort()).toEqual([
      "kind",
      "outcome",
      "provider",
      "reason",
    ]);
    // The local route always reports the in-process developer store as the provider.
    expect(denied[0]!.labels.provider).toBe("local-dev");
  });
});

describe("GET /api/artifacts/local/[artifactId] — retrieval receipts", () => {
  beforeEach(enableLocalDev);
  afterEach(resetArtifactRetrievalObserverForTests);

  it("emits a content-free receipt (served AND denied) that never carries the handle", async () => {
    const receipts: ArtifactRetrievalReceipt[] = [];
    setArtifactRetrievalObserver((r) => receipts.push(r));

    const { artifactId } = seed(enc("%PDF receipt"));
    await get(artifactId); // served
    await get(newArtifactId()); // denied not_found

    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toMatchObject({
      category: "retrieval",
      outcome: "served",
      reason: "ok",
      kind: "pdf",
      provider: "local-dev",
      policyId: ARTIFACT_POLICY_ID,
      policyVersion: ARTIFACT_POLICY_VERSION,
    });
    expect(receipts[1]).toMatchObject({ outcome: "denied", reason: "not_found" });
    for (const r of receipts) {
      // Closed key set; no handle, filename, key, path, or byte.
      expect(Object.keys(r).sort()).toEqual(
        ["category", "kind", "outcome", "policyId", "policyVersion", "provider", "reason"].sort(),
      );
      expect(JSON.stringify(r)).not.toContain(artifactId);
    }
  });
});

describe("GET /api/artifacts/local/[artifactId] — abuse guard", () => {
  beforeEach(() => {
    resetRateLimitGuardForTests();
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  });
  afterEach(() => {
    resetRateLimitGuardForTests();
    delete process.env[RATE_LIMIT_ENV.provider];
  });

  it("throttles downloads with a 429 before any store work, even outside local-dev", async () => {
    disableWorker();
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    const policy = policyFor("artifacts.fetch");
    const bare = new Request("http://localhost/api/artifacts/local/x");
    for (let i = 0; i < policy.limit; i++) await enforceRateLimit("artifacts.fetch", bare);

    // The guard runs first, so a flood is answered 429 (not the 503 not-configured).
    const denied = await get(newArtifactId());
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.code).toBe("rate_limited");
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
