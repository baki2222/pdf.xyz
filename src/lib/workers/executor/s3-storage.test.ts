// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import {
  ARTIFACT_POLICY_ID,
  ARTIFACT_POLICY_VERSION,
  type ArtifactManifest,
} from "../artifacts";
import { parseS3Config, type S3StorageConfig } from "../storage/s3-config";
import {
  ARTIFACT_MANIFEST_METADATA_HEADER,
  decodeArtifactManifestMetadata,
} from "../storage/s3-manifest-metadata";
import {
  ARTIFACT_LIFECYCLE_METADATA_HEADER,
  decodeArtifactLifecycleMetadata,
} from "../storage/s3-lifecycle-metadata";
import {
  createS3ExecutorStorage,
  filenameForContentType,
  type S3ObjectFetch,
  type S3ObjectResponse,
} from "./s3-storage";

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);
const now = () => NOW;

const S3_SECRET = "s3-secret-value-1234567890";

/** Build a valid config through the real parser (never a real credential). */
function config(): S3StorageConfig {
  const parsed = parseS3Config({
    PDFXYZ_STORAGE_PROVIDER: "s3",
    PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
    PDFXYZ_S3_REGION: "auto",
    PDFXYZ_S3_BUCKET: "pdfxyz-store",
    PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
    PDFXYZ_S3_SECRET_ACCESS_KEY: S3_SECRET,
  });
  if (!parsed.ok) throw new Error("fixture config should parse");
  return parsed.config;
}

interface ScriptedResponse {
  status: number;
  contentType?: string;
  bytes?: Uint8Array;
  /** Raw `x-amz-meta-filename` value the fake object returns on a GET. */
  filenameMeta?: string;
}

interface RecordedCall {
  url: string;
  method: string;
  body?: Uint8Array;
  headers?: Record<string, string>;
}

/** A fake object transport that replays scripted responses and records calls. */
function fakeFetch(script: ScriptedResponse[]): {
  fn: S3ObjectFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fn: S3ObjectFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      ...(init.body ? { body: init.body } : {}),
      ...(init.headers ? { headers: init.headers } : {}),
    });
    const res = script[Math.min(i, script.length - 1)] ?? { status: 200 };
    i += 1;
    const response: S3ObjectResponse = {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: {
        get: (name) => {
          const key = name.toLowerCase();
          if (key === "content-type") return res.contentType ?? null;
          if (key === "x-amz-meta-filename") return res.filenameMeta ?? null;
          return null;
        },
      },
      arrayBuffer: async () =>
        (res.bytes ?? new Uint8Array()).slice().buffer as ArrayBuffer,
    };
    return response;
  };
  return { fn, calls };
}

/** A throwing transport, to prove best-effort deletes never propagate. */
const throwingFetch: S3ObjectFetch = async () => {
  throw new Error("network down");
};

describe("filenameForContentType", () => {
  it("names a PDF and falls back to a neutral name otherwise", () => {
    expect(filenameForContentType("application/pdf")).toBe("document.pdf");
    expect(filenameForContentType("application/pdf; charset=binary")).toBe("document.pdf");
    expect(filenameForContentType("image/png")).toBe("input");
  });
});

describe("createS3ExecutorStorage — readInput", () => {
  const fileId = "f_abcdefghij0123456789";

  it("recovers the sanitized original filename from x-amz-meta-filename", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes,
        filenameMeta: "Q3%20Report.pdf",
      },
    ]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });

    const file = await storage.readInput(fileId);
    expect(file).toEqual({
      fileId,
      filename: "Q3 Report.pdf",
      contentType: "application/pdf",
      bytes,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    // Signed, and targets the input object's private key — never the raw secret.
    expect(calls[0]!.url).toContain("/inputs/f_abcdefghij0123456789");
    expect(calls[0]!.url).toContain("X-Amz-Signature=");
    expect(calls[0]!.url).not.toContain(S3_SECRET);
  });

  it("falls back to a content-type name when no metadata is present (legacy)", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { fn } = fakeFetch([{ status: 200, contentType: "application/pdf", bytes }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });

    const file = await storage.readInput(fileId);
    expect(file).toEqual({
      fileId,
      filename: "document.pdf",
      contentType: "application/pdf",
      bytes,
    });
  });

  it("re-sanitizes a tampered metadata value so no path can escape", async () => {
    const bytes = new Uint8Array([1]);
    const { fn } = fakeFetch([
      {
        status: 200,
        contentType: "application/pdf",
        bytes,
        filenameMeta: encodeURIComponent("../../etc/passwd.pdf"),
      },
    ]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });
    const file = await storage.readInput(fileId);
    expect(file?.filename).toBe("passwd.pdf");
    expect(file?.filename).not.toContain("/");
  });

  it("returns null for a genuinely missing object (404)", async () => {
    const { fn } = fakeFetch([{ status: 404 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });
    expect(await storage.readInput(fileId)).toBeNull();
  });

  it("throws on a transient failure so the job is retried, not lost", async () => {
    const { fn } = fakeFetch([{ status: 503 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });
    await expect(storage.readInput(fileId)).rejects.toThrow();
  });

  it("rejects a malformed file id without touching storage", async () => {
    const { fn, calls } = fakeFetch([{ status: 200 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });
    expect(await storage.readInput("../etc/passwd")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("createS3ExecutorStorage — writeArtifact", () => {
  const input = {
    jobId: "job_abcdefghij012345",
    filename: "report-compressed.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array([9, 8, 7, 6]),
  };

  /** A valid, content-free PDF provenance manifest matching `input`. */
  const manifest: ArtifactManifest = {
    outputKind: "pdf",
    contentType: "application/pdf",
    byteCount: input.bytes.byteLength,
    retentionClass: "short",
    toolSlug: "compress-pdf",
    processor: "compress",
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
  };

  it("PUTs real bytes and returns an OPAQUE download route, never a signed URL", async () => {
    const { fn, calls } = fakeFetch([{ status: 200 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });

    const artifact = await storage.writeArtifact(input);
    expect(artifact.artifactId).toMatch(/^art_[A-Za-z0-9_-]{10,64}$/);
    expect(artifact.bytes).toBe(4);
    expect(artifact.filename).toBe("report-compressed.pdf");
    // The client-facing URL is this app's opaque retrieval route — no bucket host, key,
    // or signature ever reaches the client.
    expect(artifact.url).toBe(`/api/artifacts/${artifact.artifactId}`);
    expect(artifact.url).not.toContain("X-Amz-Signature=");
    expect(artifact.url).not.toContain(S3_SECRET);
    // expiresAt is the artifact retention / lifecycle-deletion window (not a link TTL).
    expect(artifact.expiresAt).toBe(
      new Date(NOW + DEFAULT_RETENTION.outputTtlMinutes * 60_000).toISOString(),
    );

    // The PUT carried the real bytes to the canonical opaque-id key, the declared
    // content-type, and a safe, signed Content-Disposition.
    const put = calls.find((c) => c.method === "PUT");
    expect(put).toBeDefined();
    expect(put!.body).toEqual(input.bytes);
    expect(new URL(put!.url).pathname).toContain(`/artifacts/${artifact.artifactId}`);
    expect(put!.headers?.["content-type"]).toBe("application/pdf");
    expect(put!.headers?.["content-disposition"]).toBe(
      "attachment; filename=\"report-compressed.pdf\"; filename*=UTF-8''report-compressed.pdf",
    );
    expect(new URL(put!.url).searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-disposition",
    );
    expect(put!.url).not.toContain(S3_SECRET);
  });

  it("stamps the content-free manifest as SIGNED object metadata (round-trips)", async () => {
    const { fn, calls } = fakeFetch([{ status: 200 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });

    await storage.writeArtifact({ ...input, manifest });
    const put = calls.find((c) => c.method === "PUT")!;
    const stamped = put.headers?.[ARTIFACT_MANIFEST_METADATA_HEADER];
    expect(stamped).toBeDefined();
    // The stored value re-validates back to the exact content-free manifest.
    expect(decodeArtifactManifestMetadata(stamped)).toEqual(manifest);
    // It is a SIGNED header, so the client cannot tamper it on its PUT.
    expect(new URL(put.url).searchParams.get("X-Amz-SignedHeaders")).toContain(
      ARTIFACT_MANIFEST_METADATA_HEADER,
    );
  });

  it("stamps SIGNED lifecycle evidence carrying the SAME retention window as expiresAt", async () => {
    const { fn, calls } = fakeFetch([{ status: 200 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });

    const artifact = await storage.writeArtifact(input);
    const put = calls.find((c) => c.method === "PUT")!;
    const stamped = put.headers?.[ARTIFACT_LIFECYCLE_METADATA_HEADER];
    expect(stamped).toBeDefined();
    // The stored evidence re-validates to the retention window, byte-identical to the
    // expiresAt the client is told, with no tombstone (active deletion is a bucket DELETE).
    const decoded = decodeArtifactLifecycleMetadata(stamped);
    expect(decoded).toEqual({
      expiresAtMs: Date.parse(artifact.expiresAt),
      deleted: false,
    });
    // It is a SIGNED header, so the client cannot tamper it on its PUT.
    expect(new URL(put.url).searchParams.get("X-Amz-SignedHeaders")).toContain(
      ARTIFACT_LIFECYCLE_METADATA_HEADER,
    );
    // Lifecycle evidence rides EVERY artifact, independent of whether a manifest was recorded.
    expect(stamped).not.toContain(S3_SECRET);
  });

  it("omits the manifest header entirely when no manifest was recorded", async () => {
    const { fn, calls } = fakeFetch([{ status: 200 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });

    await storage.writeArtifact(input); // no manifest
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers?.[ARTIFACT_MANIFEST_METADATA_HEADER]).toBeUndefined();
    expect(new URL(put.url).searchParams.get("X-Amz-SignedHeaders")).not.toContain(
      ARTIFACT_MANIFEST_METADATA_HEADER,
    );
  });

  it("throws when the artifact PUT is rejected (job not completed)", async () => {
    const { fn } = fakeFetch([{ status: 500 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });
    await expect(storage.writeArtifact(input)).rejects.toThrow();
  });
});

describe("createS3ExecutorStorage — deletes are best-effort and idempotent", () => {
  it("issues signed DELETEs and never throws, even when storage is unreachable", async () => {
    const { fn, calls } = fakeFetch([{ status: 204 }, { status: 204 }]);
    const storage = createS3ExecutorStorage(config(), { now, fetchImpl: fn });
    await storage.deleteInput("f_abcdefghij0123456789");
    await storage.deleteArtifact("art_abcdefghij0123456789");
    expect(calls.map((c) => c.method)).toEqual(["DELETE", "DELETE"]);

    const failing = createS3ExecutorStorage(config(), { now, fetchImpl: throwingFetch });
    await expect(failing.deleteInput("f_abcdefghij0123456789")).resolves.toBeUndefined();
    await expect(
      failing.deleteArtifact("art_abcdefghij0123456789"),
    ).resolves.toBeUndefined();
  });
});
