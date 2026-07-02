// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_SETTINGS } from "./retention";
import { buildLifecyclePolicy } from "./policy";
import {
  LIFECYCLE_PROVIDERS,
  isLifecycleProvider,
  renderLifecyclePolicy,
} from "./render";

const nonVersioned = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS);
const versioned = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS, {
  versioned: true,
});

describe("isLifecycleProvider", () => {
  it("accepts known providers and rejects others", () => {
    expect(isLifecycleProvider("aws-s3")).toBe(true);
    expect(isLifecycleProvider("cloudflare-r2")).toBe(true);
    expect(isLifecycleProvider("gcs")).toBe(false);
    expect(isLifecycleProvider("")).toBe(false);
  });
});

describe("renderLifecyclePolicy — every provider renders valid JSON", () => {
  it("produces parseable, non-empty documents for all providers", () => {
    for (const provider of LIFECYCLE_PROVIDERS) {
      const rendered = renderLifecyclePolicy(versioned, provider);
      expect(rendered.provider).toBe(provider);
      expect(rendered.format).toBe("json");
      expect(rendered.filename.length).toBeGreaterThan(0);
      // The document must be valid JSON.
      expect(() => JSON.parse(rendered.document)).not.toThrow();
    }
  });
});

describe("renderLifecyclePolicy — AWS S3 shape", () => {
  const rendered = renderLifecyclePolicy(versioned, "aws-s3");
  const doc = JSON.parse(rendered.document) as {
    Rules: Array<Record<string, unknown>>;
  };

  it("maps each agnostic rule to the S3 lifecycle shape", () => {
    const byId = new Map(doc.Rules.map((r) => [r.ID as string, r]));
    const input = byId.get("pdfxyz-input-expiration")!;
    expect(input.Status).toBe("Enabled");
    expect(input.Filter).toEqual({ Prefix: "inputs/" });
    expect(input.Expiration).toEqual({ Days: 1 });

    const abort = byId.get("pdfxyz-abort-multipart")!;
    expect(abort.AbortIncompleteMultipartUpload).toEqual({ DaysAfterInitiation: 1 });

    const noncurrent = byId.get("pdfxyz-noncurrent-version-expiration")!;
    expect(noncurrent.NoncurrentVersionExpiration).toEqual({ NoncurrentDays: 1 });

    const marker = byId.get("pdfxyz-expired-delete-marker")!;
    expect(marker.Expiration).toEqual({ ExpiredObjectDeleteMarker: true });
  });

  it("uses an s3api apply hint with a <bucket> placeholder, not a real bucket", () => {
    expect(rendered.applyHint).toContain("put-bucket-lifecycle-configuration");
    expect(rendered.applyHint).toContain("<bucket>");
  });
});

describe("renderLifecyclePolicy — Cloudflare R2 subset", () => {
  it("drops versioned rules and explains why", () => {
    const rendered = renderLifecyclePolicy(versioned, "cloudflare-r2");
    const doc = JSON.parse(rendered.document) as {
      Rules: Array<Record<string, unknown>>;
    };
    const ids = doc.Rules.map((r) => r.ID);
    expect(ids).not.toContain("pdfxyz-noncurrent-version-expiration");
    expect(ids).not.toContain("pdfxyz-expired-delete-marker");
    // The object-expiration and multipart rules survive.
    expect(ids).toContain("pdfxyz-input-expiration");
    expect(rendered.notes.join(" ")).toMatch(/no object versioning/i);
  });

  it("emits no versioning note for an already non-versioned policy", () => {
    const rendered = renderLifecyclePolicy(nonVersioned, "cloudflare-r2");
    // Nothing was dropped, so it does not claim it removed versioned rules.
    expect(rendered.notes.join(" ")).not.toMatch(/were omitted/i);
  });
});

describe("renderLifecyclePolicy — MinIO", () => {
  it("uses the mc ilm import hint", () => {
    const rendered = renderLifecyclePolicy(nonVersioned, "minio");
    expect(rendered.applyHint).toContain("mc ilm import");
  });
});

describe("renderLifecyclePolicy — generic", () => {
  it("emits the provider-agnostic model verbatim", () => {
    const rendered = renderLifecyclePolicy(nonVersioned, "generic");
    const doc = JSON.parse(rendered.document) as { version?: number };
    expect(doc.version).toBe(1);
  });
});

describe("renderLifecyclePolicy — content-free for every provider", () => {
  it("never leaks a bucket, endpoint, credential, or region", () => {
    for (const provider of LIFECYCLE_PROVIDERS) {
      const rendered = renderLifecyclePolicy(versioned, provider);
      const blob = `${rendered.document} ${rendered.applyHint} ${rendered.notes.join(" ")}`;
      for (const leak of [
        "amazonaws.com",
        "AKIA",
        "s3cr3t",
        "us-east-1",
        ".upstash.io",
      ]) {
        expect(blob).not.toContain(leak);
      }
    }
  });
});
