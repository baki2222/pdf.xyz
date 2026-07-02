// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  S3_ENV,
  isS3StorageSelected,
  parseS3Config,
  resolveStorageCapability,
} from "./s3-config";

// Fake credentials only — nothing here is a real key.
const SECRET = "s3cr3tEXAMPLEkeyValue00000000000000000000";
const validEnv = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  [S3_ENV.provider]: "s3",
  [S3_ENV.endpoint]: "https://s3.us-east-1.amazonaws.com",
  [S3_ENV.region]: "us-east-1",
  [S3_ENV.bucket]: "pdfxyz-prod",
  [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
  [S3_ENV.secretAccessKey]: SECRET,
  ...overrides,
});

describe("isS3StorageSelected", () => {
  it("is true only when the provider flag is exactly s3 (case-insensitive)", () => {
    expect(isS3StorageSelected({})).toBe(false);
    expect(isS3StorageSelected({ [S3_ENV.provider]: "gcs" })).toBe(false);
    expect(isS3StorageSelected({ [S3_ENV.provider]: "S3" })).toBe(true);
    expect(isS3StorageSelected({ [S3_ENV.provider]: "  s3 " })).toBe(true);
  });
});

describe("parseS3Config — selection", () => {
  it("reports not-selected (no issues) when the provider flag is unset", () => {
    const result = parseS3Config({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.selected).toBe(false);
      expect(result.issues).toEqual([]);
    }
  });
});

describe("parseS3Config — valid config", () => {
  it("parses a complete config with sane defaults", () => {
    const result = parseS3Config(validEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      protocol: "https:",
      host: "s3.us-east-1.amazonaws.com",
      region: "us-east-1",
      bucket: "pdfxyz-prod",
      accessKeyId: "AKIAEXAMPLE0000000",
      forcePathStyle: false,
      keyPrefix: "",
      uploadTtlSeconds: 900,
      downloadTtlSeconds: 900,
    });
  });

  it("parses optional flags, prefix, TTLs, and session token", () => {
    const result = parseS3Config(
      validEnv({
        [S3_ENV.endpoint]: "http://localhost:9000",
        [S3_ENV.region]: "auto",
        [S3_ENV.forcePathStyle]: "true",
        [S3_ENV.keyPrefix]: "/tenant-a/",
        [S3_ENV.sessionToken]: "FQoGZXIvYXdzEXAMPLEtoken",
        [S3_ENV.uploadTtlSeconds]: "120",
        [S3_ENV.downloadTtlSeconds]: "60",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      protocol: "http:",
      host: "localhost:9000",
      region: "auto",
      forcePathStyle: true,
      keyPrefix: "tenant-a", // surrounding slashes stripped
      sessionToken: "FQoGZXIvYXdzEXAMPLEtoken",
      uploadTtlSeconds: 120,
      downloadTtlSeconds: 60,
    });
  });
});

describe("parseS3Config — missing required variables", () => {
  const required = [
    S3_ENV.endpoint,
    S3_ENV.region,
    S3_ENV.bucket,
    S3_ENV.accessKeyId,
    S3_ENV.secretAccessKey,
  ];

  for (const name of required) {
    it(`fails (selected) and names ${name} when it is absent`, () => {
      const result = parseS3Config(validEnv({ [name]: undefined }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.selected).toBe(true);
      expect(result.issues.map((i) => i.field)).toContain(name);
    });

    it(`treats a blank ${name} as missing`, () => {
      const result = parseS3Config(validEnv({ [name]: "   " }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.map((i) => i.field)).toContain(name);
    });
  }
});

describe("parseS3Config — malformed values", () => {
  it("rejects a non-URL / non-http endpoint or one with a path", () => {
    for (const endpoint of [
      "not-a-url",
      "ftp://example.com",
      "https://example.com/bucket-path",
      "https://user:pass@example.com",
    ]) {
      const result = parseS3Config(validEnv({ [S3_ENV.endpoint]: endpoint }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((i) => i.field)).toContain(S3_ENV.endpoint);
    }
  });

  it("rejects malformed bucket, region, and access key id", () => {
    expect(parseS3Config(validEnv({ [S3_ENV.bucket]: "a" })).ok).toBe(false);
    expect(parseS3Config(validEnv({ [S3_ENV.bucket]: "bad/slash" })).ok).toBe(false);
    expect(parseS3Config(validEnv({ [S3_ENV.region]: "us east 1" })).ok).toBe(false);
    expect(parseS3Config(validEnv({ [S3_ENV.accessKeyId]: "has space" })).ok).toBe(
      false,
    );
  });

  it("rejects a secret containing whitespace", () => {
    const result = parseS3Config(validEnv({ [S3_ENV.secretAccessKey]: "bad secret" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.field)).toContain(S3_ENV.secretAccessKey);
  });

  it("rejects an unrecognized force-path-style flag", () => {
    const result = parseS3Config(validEnv({ [S3_ENV.forcePathStyle]: "maybe" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.field)).toContain(S3_ENV.forcePathStyle);
  });

  it("rejects a traversal / illegal key prefix", () => {
    for (const prefix of ["../escape", "a/../b", "bad space"]) {
      expect(parseS3Config(validEnv({ [S3_ENV.keyPrefix]: prefix })).ok).toBe(false);
    }
  });

  it("rejects out-of-range or non-integer TTLs", () => {
    for (const ttl of ["0", "abc", "999999999", "12.5"]) {
      const result = parseS3Config(validEnv({ [S3_ENV.uploadTtlSeconds]: ttl }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((i) => i.field)).toContain(S3_ENV.uploadTtlSeconds);
    }
  });
});

describe("parseS3Config — never leaks a secret value", () => {
  it("keeps issue messages free of the secret value", () => {
    // A config where the secret is present but something else is malformed.
    const result = parseS3Config(validEnv({ [S3_ENV.bucket]: "a" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain(SECRET);
    // Every issue references a known variable NAME, nothing else.
    for (const issue of result.issues) {
      expect(Object.values(S3_ENV)).toContain(issue.field);
    }
  });
});

describe("resolveStorageCapability", () => {
  it("returns a ready S3 capability when fully configured", () => {
    const cap = resolveStorageCapability(validEnv());
    expect(cap).not.toBeNull();
    expect(cap).toMatchObject({
      provider: "s3",
      ready: true,
      configured: true,
      signedUploads: true,
      signedDownloads: true,
      deleteNow: true,
    });
  });

  it("returns null (fall back to honest not-configured) when unset or invalid", () => {
    expect(resolveStorageCapability({})).toBeNull();
    expect(
      resolveStorageCapability(validEnv({ [S3_ENV.bucket]: undefined })),
    ).toBeNull();
  });

  it("never exposes bucket, endpoint, region, key id, or secret", () => {
    const cap = resolveStorageCapability(
      validEnv({ [S3_ENV.keyPrefix]: "tenant-a" }),
    );
    const serialized = JSON.stringify(cap);
    for (const leak of [
      "pdfxyz-prod",
      "s3.us-east-1.amazonaws.com",
      "us-east-1",
      "AKIAEXAMPLE0000000",
      SECRET,
      "tenant-a",
      "PDFXYZ_",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });
});
