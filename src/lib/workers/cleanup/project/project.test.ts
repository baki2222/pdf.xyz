// @vitest-environment node
import { describe, expect, it } from "vitest";
import { projectProviderExport, type ProjectionResult } from "./project";
import { encodeArtifactLifecycleMetadata } from "../../storage/s3-lifecycle-metadata";
import { encodeArtifactManifestMetadata } from "../../storage/s3-manifest-metadata";
import type { ArtifactManifest } from "../../artifacts/types";

/** A fixed clock; fixtures use extreme instants so the verdict is clock-robust. */
const NOW = 1_700_000_000_000;
const FUTURE = NOW + 60 * 60 * 1000; // +1h — a live retention window
const PAST = 1_000; // always past

/** A valid content-free manifest whose bounded kind/processor the projector should surface. */
function manifest(overrides: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    outputKind: "pdf",
    contentType: "application/pdf",
    byteCount: 2048,
    retentionClass: "short",
    toolSlug: "compress-pdf",
    processor: "compress",
    policyId: "pdfxyz-artifact-manifest",
    policyVersion: 1,
    ...overrides,
  };
}

/** Project and assert success, returning the target-narrowed ok result for further assertions. */
function project<T extends "evidence" | "inventory">(
  doc: unknown,
  target: T,
  source: "aws-s3" | "generic" = "aws-s3",
): Extract<ProjectionResult, { ok: true; target: T }> {
  const result = projectProviderExport(JSON.stringify(doc), {
    target,
    source,
    now: NOW,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result as Extract<ProjectionResult, { ok: true; target: T }>;
}

describe("projectProviderExport — AWS head-object → inventory", () => {
  const headObject = {
    httpStatusCode: 200,
    ContentType: "application/pdf; charset=binary",
    ContentLength: 2_000_000, // ~1.9 MiB → 1-10mb
    LastModified: new Date(NOW - 2 * 24 * 3_600_000).toISOString(), // 2 days old → 1-7d
    Metadata: {
      "artifact-lifecycle": encodeArtifactLifecycleMetadata({
        expiresAtMs: FUTURE,
        deleted: false,
      }),
      "artifact-manifest": encodeArtifactManifestMetadata(manifest()),
    },
    Key: "artifacts/job-xyz/output.pdf",
    ETag: '"deadbeefcafe"',
  };

  it("decodes the encoded metadata into bounded inventory fields", () => {
    const { records } = project({ objects: [headObject] }, "inventory");
    expect(records).toEqual([
      {
        expiresAtMs: FUTURE,
        manifest: "valid",
        provider: "remote-configured",
        kind: "pdf",
        processor: "compress",
        age: "1-7d",
        size: "1-10mb",
      },
    ]);
  });

  it("resolves verdict=projected (exit-worthy 0) and marks the record usable", () => {
    const { verdict, receipt } = project(
      { objects: [headObject] },
      "inventory",
    );
    expect(verdict).toBe("projected");
    expect(receipt.usableMetadata).toBe(1);
    expect(receipt.projectedRecords).toBe(1);
  });

  it("tallies the dropped locator + integrity fields without reading their values", () => {
    const { receipt } = project({ objects: [headObject] }, "inventory");
    expect(receipt.droppedByCategory.locator).toBeGreaterThanOrEqual(1); // Key
    expect(receipt.droppedByCategory.integrity).toBeGreaterThanOrEqual(1); // ETag
    expect(receipt.droppedFields).toBeGreaterThanOrEqual(2);
  });
});

describe("projectProviderExport — AWS head-object → evidence", () => {
  it("projects a present object with its decoded retention deadline", () => {
    const { records, verdict } = project(
      {
        objects: [
          {
            httpStatusCode: 200,
            Metadata: {
              "artifact-lifecycle": encodeArtifactLifecycleMetadata({
                expiresAtMs: FUTURE,
                deleted: false,
              }),
            },
            Key: "artifacts/a/b.pdf",
          },
        ],
      },
      "evidence",
    );
    expect(records).toEqual([{ presence: "present", expiresAtMs: FUTURE }]);
    expect(verdict).toBe("projected");
  });

  it("maps a NoSuchKey error to an absent probe (the positive cleanup signal)", () => {
    const { records, verdict } = project(
      {
        objects: [{ Error: { Code: "NoSuchKey" }, Key: "artifacts/gone.pdf" }],
      },
      "evidence",
    );
    expect(records).toEqual([{ presence: "absent" }]);
    expect(verdict).toBe("projected"); // an absence is a usable observation
  });

  it("maps a 404 status to absent and preserves a normalized activeDelete flag", () => {
    const { records } = project(
      { objects: [{ statusCode: 404, activeDelete: true }] },
      "evidence",
    );
    expect(records).toEqual([{ presence: "absent", activeDelete: true }]);
  });

  it("maps a 5xx / SlowDown to an error probe", () => {
    const a = project({ objects: [{ statusCode: 503 }] }, "evidence");
    const b = project(
      { objects: [{ Error: { Code: "SlowDown" } }] },
      "evidence",
    );
    expect(a.records).toEqual([{ presence: "error" }]);
    expect(b.records).toEqual([{ presence: "error" }]);
  });

  it("warns on an unrecognized status but still degrades safely to error", () => {
    const { records, receipt } = project(
      { objects: [{ statusCode: 418 }] },
      "evidence",
    );
    expect(records).toEqual([{ presence: "error" }]);
    expect(receipt.warnings["unrecognized-status"]).toBe(1);
  });
});

describe("projectProviderExport — envelope shapes & list-objects", () => {
  it("accepts a bare array", () => {
    const { records } = project(
      [{ presence: "absent" }],
      "evidence",
      "generic",
    );
    expect(records).toEqual([{ presence: "absent" }]);
  });

  it("accepts an S3 { Contents: [...] } listing", () => {
    const listing = {
      Contents: [
        {
          Key: "artifacts/x",
          Size: 1000,
          LastModified: new Date(NOW).toISOString(),
        },
      ],
    };
    const { receipt, verdict } = project(listing, "inventory");
    // A bare listing has no lifecycle/manifest/kind → not enough usable metadata.
    expect(verdict).toBe("insufficient");
    expect(receipt.warnings["missing-metadata"]).toBe(1);
  });

  it("accepts a { records: [...] } envelope", () => {
    const { records } = project(
      { records: [{ presence: "present" }] },
      "evidence",
      "generic",
    );
    expect(records).toEqual([{ presence: "present" }]);
  });
});

describe("projectProviderExport — unsafe & insufficient verdicts", () => {
  it("flags a present-but-tombstoned object as unsafe (exit-worthy 4)", () => {
    const { verdict, receipt } = project(
      {
        objects: [
          {
            httpStatusCode: 200,
            Metadata: {
              "artifact-lifecycle": encodeArtifactLifecycleMetadata({
                expiresAtMs: PAST,
                deleted: true,
              }),
            },
          },
        ],
      },
      "inventory",
    );
    expect(verdict).toBe("unsafe");
    expect(receipt.unsafe).toBe(1);
    expect(receipt.warnings["present-tombstoned"]).toBe(1);
  });

  it("does NOT flag an absent tombstoned object (that is the good case)", () => {
    const { verdict } = project(
      { objects: [{ presence: "absent", deleted: true }] },
      "evidence",
      "generic",
    );
    expect(verdict).toBe("projected");
  });

  it("counts a non-object entry as invalid & unsafe, dropping it (never passed through)", () => {
    const { records, receipt, verdict } = project(
      { objects: ["a-hostile-scalar", 42, { presence: "absent" }] },
      "evidence",
      "generic",
    );
    expect(records).toEqual([{ presence: "absent" }]);
    expect(receipt.droppedRecords).toBe(2);
    expect(receipt.warnings["invalid-record"]).toBe(2);
    expect(verdict).toBe("unsafe");
  });

  it("returns insufficient for an empty observation set", () => {
    const { verdict, receipt } = project({ objects: [] }, "inventory");
    expect(verdict).toBe("insufficient");
    expect(receipt.projectedRecords).toBe(0);
  });

  it("returns insufficient when every record is metadata-thin", () => {
    const { verdict } = project(
      { records: [{ provider: "remote-configured" }] },
      "inventory",
      "generic",
    );
    expect(verdict).toBe("insufficient");
  });
});

describe("projectProviderExport — generic normalized passthrough", () => {
  it("honors already-bounded enum fields and coarse buckets", () => {
    const { records } = project(
      {
        records: [
          {
            expiresAtMs: FUTURE,
            manifest: "valid",
            provider: "local-dev",
            kind: "text-sidecar",
            processor: "ocr",
            age: "7-30d",
            size: "under-64kb",
          },
        ],
      },
      "inventory",
      "generic",
    );
    expect(records).toEqual([
      {
        expiresAtMs: FUTURE,
        manifest: "valid",
        provider: "local-dev",
        kind: "text-sidecar",
        processor: "ocr",
        age: "7-30d",
        size: "under-64kb",
      },
    ]);
  });

  it("degrades an unrecognized kind to unknown with a warning", () => {
    const { records, receipt } = project(
      { objects: [{ ContentType: "application/x-not-a-thing", Metadata: {} }] },
      "inventory",
    );
    expect(records[0]?.kind).toBe("unknown");
    expect(receipt.warnings["unknown-kind"]).toBe(1);
  });

  it("collapses a tampered lifecycle blob to no evidence with a warning", () => {
    const { records, receipt } = project(
      {
        objects: [
          {
            httpStatusCode: 200,
            Metadata: { "artifact-lifecycle": "%7Bnot-json" },
          },
        ],
      },
      "evidence",
    );
    expect(records).toEqual([{ presence: "present" }]); // no expiresAtMs — failed toward "no evidence"
    expect(receipt.warnings["unusable-lifecycle"]).toBe(1);
  });
});

describe("projectProviderExport — input errors (exit 1)", () => {
  const cases: Array<{ text: string; issue: string }> = [
    { text: "", issue: "empty-document" },
    { text: "   ", issue: "empty-document" },
    { text: "{not json", issue: "malformed-json" },
    { text: "42", issue: "not-an-object" },
    { text: '{"nope": 1}', issue: "no-objects" },
  ];
  for (const { text, issue } of cases) {
    it(`rejects ${JSON.stringify(text.slice(0, 12))} as ${issue}`, () => {
      const result = projectProviderExport(text, {
        target: "evidence",
        source: "aws-s3",
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issue).toBe(issue);
    });
  }
});
