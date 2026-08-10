// @vitest-environment node
import { describe, expect, it } from "vitest";
import { presignS3Url } from "./s3-signer";

/**
 * AWS's own published Signature Version 4 presigned-URL example — the canonical
 * known-answer test for a query-string GET with `UNSIGNED-PAYLOAD`. Reproducing
 * its documented signature byte-for-byte proves the signer is spec-correct.
 * These are AWS's well-known EXAMPLE credentials (fake, published in the docs).
 * See: AWS SigV4 "Authenticating Requests: Using Query Parameters".
 */
const AWS_EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  host: "examplebucket.s3.amazonaws.com",
  path: "/test.txt",
  // 2013-05-24T00:00:00Z, the exact instant used in the AWS example.
  date: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
  expiresSeconds: 86400,
  expectedSignature:
    "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
};

describe("presignS3Url — AWS known-answer vector", () => {
  const result = presignS3Url({
    method: "GET",
    protocol: "https:",
    host: AWS_EXAMPLE.host,
    path: AWS_EXAMPLE.path,
    region: AWS_EXAMPLE.region,
    accessKeyId: AWS_EXAMPLE.accessKeyId,
    secretAccessKey: AWS_EXAMPLE.secretAccessKey,
    date: AWS_EXAMPLE.date,
    expiresSeconds: AWS_EXAMPLE.expiresSeconds,
  });

  it("reproduces the documented signature exactly", () => {
    expect(result.signature).toBe(AWS_EXAMPLE.expectedSignature);
  });

  it("builds the documented canonical request and string-to-sign", () => {
    expect(result.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host",
        "host:examplebucket.s3.amazonaws.com",
        "",
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n"),
    );
    expect(
      result.stringToSign.startsWith("AWS4-HMAC-SHA256\n20130524T000000Z\n"),
    ).toBe(true);
    expect(result.credentialScope).toBe("20130524/us-east-1/s3/aws4_request");
  });

  it("appends the signature to the returned URL and never the secret", () => {
    const url = new URL(result.url);
    expect(url.searchParams.get("X-Amz-Signature")).toBe(
      AWS_EXAMPLE.expectedSignature,
    );
    expect(url.searchParams.get("X-Amz-Credential")).toBe(
      "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
    );
    expect(result.url).not.toContain(AWS_EXAMPLE.secretAccessKey);
  });
});

describe("presignS3Url — behavior", () => {
  const base = {
    method: "PUT" as const,
    protocol: "https:" as const,
    host: "bucket.example.com",
    path: "/inputs/f_abc",
    region: "auto",
    accessKeyId: "AKIAEXAMPLE0000000",
    secretAccessKey: "s3cr3t/keyEXAMPLE+value0000000000000000",
    date: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
    expiresSeconds: 900,
  };

  it("is deterministic for identical inputs", () => {
    expect(presignS3Url(base).url).toBe(presignS3Url(base).url);
  });

  it("signs extra headers into X-Amz-SignedHeaders (sorted)", () => {
    const { url } = presignS3Url({
      ...base,
      signedHeaders: { "content-type": "application/pdf" },
    });
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host",
    );
  });

  it("carries an STS session token when present", () => {
    const { url } = presignS3Url({
      ...base,
      sessionToken: "FQoGZXIvYXdzEXAMPLE",
    });
    expect(new URL(url).searchParams.get("X-Amz-Security-Token")).toBe(
      "FQoGZXIvYXdzEXAMPLE",
    );
  });

  it("produces a 64-char hex signature and the standard query params", () => {
    const url = new URL(presignS3Url(base).url);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  });
});
