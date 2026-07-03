// @vitest-environment node
/**
 * Phase 42 REGRESSION GUARD on the Phase 41 invariant the cleanup verifier premises on.
 *
 * The cleanup verifier reasons about the SAME lifecycle evidence the retrieval boundary
 * enforces: an `expired`/`deleted` object is one the download route DENIES (`410 Gone`) BEFORE a
 * single byte is read. This test re-asserts, from the cleanup module, that the storage-backed
 * retrieval reader still denies an expired-but-present and a tombstoned-but-present object
 * without ever buffering its body — so the "retrieval-only denial" the verifier reports (a
 * present-but-denied object) really is a denial that never touched the bytes, and a future
 * change to the reader that streamed a gone artifact's bytes would fail here.
 */
import { describe, expect, it } from "vitest";
import { parseS3Config } from "../storage/s3-config";
import {
  ARTIFACT_LIFECYCLE_METADATA_HEADER,
  encodeArtifactLifecycleMetadata,
} from "../storage/s3-lifecycle-metadata";
import {
  createS3ArtifactReader,
  type S3ArtifactFetch,
  type S3ArtifactObjectResponse,
} from "../artifacts/retrieval-storage";

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);
const now = () => NOW;
const ARTIFACT_ID = "art_abcdefghij0123456789";
const FUTURE = NOW + 60 * 60_000;
const PAST = NOW - 1;

const S3_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-fixture-redacted-value",
} as const;

function config() {
  const parsed = parseS3Config({ ...S3_ENV });
  if (!parsed.ok) throw new Error("fixture config should parse");
  return parsed.config;
}

/**
 * A fake object transport that returns a 200 carrying the given lifecycle metadata, and COUNTS
 * how many times its body was read. If the reader ever buffers a gone object's body, `bodyReads`
 * rises above zero and the assertion fails.
 */
function fetchWithLifecycle(lifecycleMeta: string): { fn: S3ArtifactFetch; bodyReads: () => number } {
  let bodyReads = 0;
  const fn: S3ArtifactFetch = async () => {
    const response: S3ArtifactObjectResponse = {
      ok: true,
      status: 200,
      headers: {
        get: (name) =>
          name.toLowerCase() === ARTIFACT_LIFECYCLE_METADATA_HEADER ? lifecycleMeta : null,
      },
      arrayBuffer: async () => {
        bodyReads += 1;
        return new Uint8Array([1, 2, 3]).buffer;
      },
    };
    return response;
  };
  return { fn, bodyReads: () => bodyReads };
}

describe("Phase 41 invariant (Phase 42 regression): deny before byte reads", () => {
  it("denies an expired-but-present object without reading its body", async () => {
    const probe = fetchWithLifecycle(encodeArtifactLifecycleMetadata({ expiresAtMs: PAST, deleted: false }));
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: probe.fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("expired");
    expect(probe.bodyReads()).toBe(0);
  });

  it("denies a tombstoned-but-present object without reading its body", async () => {
    const probe = fetchWithLifecycle(encodeArtifactLifecycleMetadata({ expiresAtMs: FUTURE, deleted: true }));
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: probe.fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("deleted");
    expect(probe.bodyReads()).toBe(0);
  });

  it("still reads the body for a live object (the guard is denial-specific)", async () => {
    const probe = fetchWithLifecycle(encodeArtifactLifecycleMetadata({ expiresAtMs: FUTURE, deleted: false }));
    const reader = createS3ArtifactReader(config(), { now, fetchImpl: probe.fn });
    const read = await reader.readArtifact(ARTIFACT_ID);
    expect(read.status).toBe("ok");
    expect(probe.bodyReads()).toBe(1);
  });
});
