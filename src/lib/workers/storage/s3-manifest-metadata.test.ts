// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_POLICY_ID,
  ARTIFACT_POLICY_VERSION,
  type ArtifactManifest,
} from "../artifacts";
import {
  ARTIFACT_MANIFEST_METADATA_HEADER,
  decodeArtifactManifestMetadata,
  encodeArtifactManifestMetadata,
} from "./s3-manifest-metadata";

function manifest(over: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    outputKind: "pdf",
    contentType: "application/pdf",
    byteCount: 1234,
    retentionClass: "short",
    toolSlug: "compress-pdf",
    processor: "compress",
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    ...over,
  };
}

describe("artifact manifest object-metadata", () => {
  it("uses the lowercase x-amz-meta header name", () => {
    expect(ARTIFACT_MANIFEST_METADATA_HEADER).toBe("x-amz-meta-artifact-manifest");
  });

  it("round-trips every field of a content-free manifest", () => {
    const m = manifest();
    const decoded = decodeArtifactManifestMetadata(encodeArtifactManifestMetadata(m));
    expect(decoded).toEqual(m);
  });

  it("round-trips each output kind + retention class + processor", () => {
    const variants: ArtifactManifest[] = [
      manifest({ outputKind: "text-sidecar", contentType: "text/plain", processor: "ocr" }),
      manifest({ outputKind: "archive", contentType: "application/zip", processor: "other" }),
      manifest({ outputKind: "image", contentType: "image/png", retentionClass: "ephemeral" }),
      manifest({ retentionClass: "extended", byteCount: 0 }),
    ];
    for (const m of variants) {
      expect(decodeArtifactManifestMetadata(encodeArtifactManifestMetadata(m))).toEqual(m);
    }
  });

  it("produces a header-safe ASCII token (no spaces, quotes, or control bytes)", () => {
    const token = encodeArtifactManifestMetadata(manifest({ toolSlug: "compress-pdf" }));
    expect(token).toMatch(/^[\x21-\x7e]+$/);
    expect(token).not.toContain(" ");
    expect(token).not.toContain('"');
  });

  it("decodes an absent/blank value to null (the honest manifest-less path)", () => {
    expect(decodeArtifactManifestMetadata(null)).toBeNull();
    expect(decodeArtifactManifestMetadata(undefined)).toBeNull();
    expect(decodeArtifactManifestMetadata("")).toBeNull();
    expect(decodeArtifactManifestMetadata("   ")).toBeNull();
  });

  it("rejects malformed encoding / JSON without throwing", () => {
    expect(decodeArtifactManifestMetadata("%")).toBeNull(); // bad percent-encoding
    expect(decodeArtifactManifestMetadata("not-json")).toBeNull();
    expect(decodeArtifactManifestMetadata(encodeURIComponent("[]"))).toBeNull(); // not an object
    expect(decodeArtifactManifestMetadata(encodeURIComponent("42"))).toBeNull();
  });

  it("rejects an out-of-enum or wrong-typed field (strict, never half-trusts)", () => {
    const bad = [
      { k: "exe", c: "application/pdf", b: 1, r: "short", t: "x", p: "compress", i: ARTIFACT_POLICY_ID, v: 1 },
      { k: "pdf", c: "application/pdf", b: -1, r: "short", t: "x", p: "compress", i: ARTIFACT_POLICY_ID, v: 1 },
      { k: "pdf", c: "application/pdf", b: 1, r: "forever", t: "x", p: "compress", i: ARTIFACT_POLICY_ID, v: 1 },
      { k: "pdf", c: "application/pdf", b: 1, r: "short", t: "x", p: "gpu", i: ARTIFACT_POLICY_ID, v: 1 },
      { k: "pdf", c: "application/pdf", b: 1, r: "short", t: "x", p: "compress", i: ARTIFACT_POLICY_ID }, // missing v
      { k: "pdf", c: "", b: 1, r: "short", t: "x", p: "compress", i: ARTIFACT_POLICY_ID, v: 1 }, // empty content-type
    ];
    for (const b of bad) {
      expect(decodeArtifactManifestMetadata(encodeURIComponent(JSON.stringify(b)))).toBeNull();
    }
  });

  it("rejects an oversized raw value before parsing", () => {
    const huge = "a".repeat(4096);
    expect(decodeArtifactManifestMetadata(huge)).toBeNull();
  });

  it("bounds absurdly long string fields (tool slug / policy id)", () => {
    const longSlug = manifest({ toolSlug: "x".repeat(200) });
    expect(
      decodeArtifactManifestMetadata(encodeArtifactManifestMetadata(longSlug)),
    ).toBeNull();
  });
});
