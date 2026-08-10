// @vitest-environment node
import { describe, expect, it } from "vitest";
import { projectProviderExport } from "./project";
import { encodeArtifactLifecycleMetadata } from "../../storage/s3-lifecycle-metadata";
import { encodeArtifactManifestMetadata } from "../../storage/s3-manifest-metadata";
import type { ArtifactManifest } from "../../artifacts/types";

const NOW = 1_700_000_000_000;
const FUTURE = NOW + 3_600_000;

/**
 * A maximally-hostile raw AWS export entry: every field the mission enumerates as forbidden
 * (object key, bucket, signed URL, endpoint, region, account id, ETag, filename, user id, IP,
 * token, OCR text, byte snippet, env secret) is present, riding alongside the two decodable
 * metadata blobs. NONE of these values may survive into the projected output or its receipt.
 */
const HOSTILE_ENTRY = {
  httpStatusCode: 200,
  ContentType: "application/pdf",
  ContentLength: 500_000,
  LastModified: "2024-03-15T12:34:56.789Z",
  // The two blobs the projector DOES decode — into bounded enums only.
  Metadata: {
    "artifact-lifecycle": encodeArtifactLifecycleMetadata({
      expiresAtMs: FUTURE,
      deleted: false,
    }),
    "artifact-manifest": encodeArtifactManifestMetadata({
      outputKind: "pdf",
      contentType: "application/pdf",
      byteCount: 500_000,
      retentionClass: "short",
      // Even the manifest's own string fields must never be emitted.
      toolSlug: "compress-SECRETSLUG-do-not-leak",
      processor: "compress",
      policyId: "pdfxyz-SECRETPOLICY-do-not-leak",
      policyVersion: 1,
    } satisfies ArtifactManifest),
    // Hostile user-metadata sub-keys — values must never be read.
    "original-filename": "invoice-Q3-CONFIDENTIAL-acme.pdf",
    "user-id": "u_9f8e7d6c5b4a",
    "user-email": "cfo@acmecorp.example",
    "client-ip": "203.0.113.42",
    "auth-token": "Bearer sk-live-abcdef0123456789",
    "ocr-text": "ACME CORP CONFIDENTIAL quarterly revenue 4200000 dollars",
    "byte-snippet": "%PDF-1.7 binary\\x00\\x01 preamble",
    "env-secret": "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIexampleKEY",
  },
  // Hostile top-level locators / identity / integrity.
  Key: "artifacts/tenants/acme-corp/2024/invoice-Q3-CONFIDENTIAL.pdf",
  Bucket: "acme-prod-pdf-artifacts",
  bucketName: "acme-prod-pdf-artifacts",
  signedUrl:
    "https://acme-prod-pdf-artifacts.s3.us-east-1.amazonaws.com/artifacts/x?X-Amz-Signature=abcdef0123456789",
  endpoint: "https://s3.us-east-1.amazonaws.com",
  region: "us-east-1",
  accountId: "123456789012",
  Owner: { DisplayName: "acme-ops-team", ID: "0a1b2c3d4e5f6071829" },
  ETag: '"d41d8cd98f00b204e9800998ecf8427e"',
  VersionId: "3HL4kqtJlcpXroDTDmjVBH40Nrjfkd",
  StorageClass: "GLACIER",
};

/** Every substring that would betray a locator, identity, or document content if leaked. */
const FORBIDDEN = [
  "acme",
  "invoice",
  "confidential",
  "amazonaws",
  "us-east-1",
  "123456789012",
  "d41d8cd98f00b204",
  "3hl4kq",
  "cfo@",
  "203.0.113",
  "bearer",
  "sk-live",
  "wjalrxut",
  "aws_secret",
  "quarterly revenue",
  "%pdf",
  "secretslug",
  "secretpolicy",
  "original-filename",
  "user-id",
  "u_9f8e7d6c",
  "glacier",
  "versionid",
  "signedurl",
  ".pdf",
];

describe("projection no-leak contract", () => {
  for (const target of ["evidence", "inventory"] as const) {
    it(`drops every hostile field when projecting to ${target}`, () => {
      const result = projectProviderExport(
        JSON.stringify({ objects: [HOSTILE_ENTRY] }),
        {
          target,
          source: "aws-s3",
          now: NOW,
        },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The ENTIRE serialized output — records AND the receipt — is inspected.
      const serialized = JSON.stringify({
        records: result.records,
        receipt: result.receipt,
      }).toLowerCase();
      for (const needle of FORBIDDEN) {
        expect(serialized).not.toContain(needle);
      }

      // Positive proof the decode still worked: the bounded retention deadline survives, and
      // the manifest resolved to `valid` / kind `pdf` WITHOUT leaking its string fields.
      expect(serialized).toContain(String(FUTURE));
      if (target === "inventory") {
        expect(result.records[0]).toMatchObject({
          manifest: "valid",
          kind: "pdf",
          processor: "compress",
        });
      }

      // The hostile metadata sub-keys were tallied as opaque blobs, never read.
      expect(
        result.receipt.droppedByCategory["metadata-blob"],
      ).toBeGreaterThanOrEqual(8);
    });
  }

  it("never emits a raw size or LastModified instant — only coarse buckets", () => {
    const result = projectProviderExport(
      JSON.stringify({ objects: [HOSTILE_ENTRY] }),
      {
        target: "inventory",
        source: "aws-s3",
        now: NOW,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.target !== "inventory") return;
    const serialized = JSON.stringify(result.records);
    expect(serialized).not.toContain("500000"); // raw ContentLength
    expect(serialized).not.toContain("2024-03-15"); // raw LastModified
    expect(result.records[0]?.size).toBe("64kb-1mb"); // bucketed
  });

  it("keeps the receipt free of any input echo even on a fully-hostile array", () => {
    const result = projectProviderExport(
      JSON.stringify([
        "hostile-scalar-acme",
        { Key: "acme/secret", ContentType: "application/pdf", Metadata: {} },
      ]),
      { target: "inventory", source: "aws-s3", now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.receipt).toLowerCase();
    expect(serialized).not.toContain("acme");
    expect(serialized).not.toContain("secret");
  });
});
