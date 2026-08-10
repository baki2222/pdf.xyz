// @vitest-environment node
/**
 * Contract for the content-free artifact lifecycle-evidence object-metadata codec: a stable
 * ASCII round-trip, the minimal live record, the optional tombstone marker, and STRICT total
 * decoding (any malformed value collapses to `null` = "no evidence", never a half-trusted
 * record and never a throw).
 */
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_LIFECYCLE_METADATA_HEADER,
  decodeArtifactLifecycleMetadata,
  encodeArtifactLifecycleMetadata,
} from "./s3-lifecycle-metadata";

const EXPIRES = Date.UTC(2026, 0, 2, 4, 0, 0);

describe("artifact lifecycle object-metadata", () => {
  it("uses the lowercase x-amz-meta header name", () => {
    expect(ARTIFACT_LIFECYCLE_METADATA_HEADER).toBe(
      "x-amz-meta-artifact-lifecycle",
    );
  });

  it("round-trips a live record (window only, no tombstone)", () => {
    const encoded = encodeArtifactLifecycleMetadata({
      expiresAtMs: EXPIRES,
      deleted: false,
    });
    expect(decodeArtifactLifecycleMetadata(encoded)).toEqual({
      expiresAtMs: EXPIRES,
      deleted: false,
    });
  });

  it("round-trips a tombstoned record", () => {
    const encoded = encodeArtifactLifecycleMetadata({
      expiresAtMs: EXPIRES,
      deleted: true,
    });
    expect(decodeArtifactLifecycleMetadata(encoded)).toEqual({
      expiresAtMs: EXPIRES,
      deleted: true,
    });
  });

  it("omits the tombstone marker for a live artifact (minimal `{e}` token)", () => {
    const live = encodeArtifactLifecycleMetadata({
      expiresAtMs: EXPIRES,
      deleted: false,
    });
    const tomb = encodeArtifactLifecycleMetadata({
      expiresAtMs: EXPIRES,
      deleted: true,
    });
    expect(decodeURIComponent(live)).toBe(`{"e":${EXPIRES}}`);
    expect(decodeURIComponent(tomb)).toBe(`{"e":${EXPIRES},"d":1}`);
  });

  it("produces a header-safe ASCII token (no spaces, quotes, or control bytes)", () => {
    const token = encodeArtifactLifecycleMetadata({
      expiresAtMs: EXPIRES,
      deleted: true,
    });
    expect(token).toMatch(/^[\x21-\x7e]+$/);
    expect(token).not.toContain(" ");
    expect(token).not.toContain('"');
  });

  it("decodes an absent/blank value to null (the honest no-evidence path)", () => {
    expect(decodeArtifactLifecycleMetadata(null)).toBeNull();
    expect(decodeArtifactLifecycleMetadata(undefined)).toBeNull();
    expect(decodeArtifactLifecycleMetadata("")).toBeNull();
    expect(decodeArtifactLifecycleMetadata("   ")).toBeNull();
  });

  it("rejects malformed encoding / JSON without throwing", () => {
    expect(decodeArtifactLifecycleMetadata("%")).toBeNull(); // bad percent-encoding
    expect(decodeArtifactLifecycleMetadata("not-json")).toBeNull();
    expect(
      decodeArtifactLifecycleMetadata(encodeURIComponent("[]")),
    ).toBeNull(); // not an object
    expect(
      decodeArtifactLifecycleMetadata(encodeURIComponent("42")),
    ).toBeNull();
  });

  it("rejects a non-integer / negative expiry or a wrong tombstone marker (strict)", () => {
    const bad = [
      { e: -1 },
      { e: 1.5 },
      { e: "1700000000000" },
      {}, // no expiry
      { e: EXPIRES, d: 0 }, // marker present but not exactly 1
      { e: EXPIRES, d: true },
      { e: EXPIRES, d: "1" },
    ];
    for (const b of bad) {
      expect(
        decodeArtifactLifecycleMetadata(encodeURIComponent(JSON.stringify(b))),
      ).toBeNull();
    }
  });

  it("rejects an oversized raw value before parsing", () => {
    expect(decodeArtifactLifecycleMetadata("a".repeat(512))).toBeNull();
  });
});
