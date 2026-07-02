/**
 * AWS Signature Version 4 **query-string (presigned URL)** signer, implemented
 * with `node:crypto` only — no `@aws-sdk/*` dependency.
 *
 * A presigned URL carries its own authorization in the query string, so the
 * browser can PUT/GET/DELETE a single object directly against S3/R2/MinIO without
 * the app server ever touching the bytes or shipping a credential to the client.
 * The signing *secret* is used only to derive the HMAC signing key here; it never
 * appears in the URL (only the non-secret access key id and the computed
 * signature do, exactly as every S3 presigned URL works).
 *
 * The signer is pure and deterministic: it takes the signing `date` as an input
 * (never calls `Date.now()`), so a fixed clock yields a byte-identical URL. That
 * is what makes it testable against AWS's published SigV4 example vectors.
 *
 * Reference: AWS "Signature Version 4" — authenticating requests using query
 * parameters (`X-Amz-*`), payload hash `UNSIGNED-PAYLOAD`.
 */

import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";
const AWS_REQUEST = "aws4_request";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface PresignParams {
  method: "GET" | "PUT" | "DELETE";
  protocol: "http:" | "https:";
  /** The host to sign (virtual-host `bucket.endpoint` or the endpoint host). */
  host: string;
  /** Raw object path with a leading slash, e.g. `/inputs/f_ab` or `/bucket/…`. */
  path: string;
  region: string;
  service?: string;
  accessKeyId: string;
  /** SECRET — used only to build the signing key; never placed in the URL. */
  secretAccessKey: string;
  /** SECRET — optional STS token, carried as `X-Amz-Security-Token`. */
  sessionToken?: string;
  /** Deterministic signing instant (UTC). No wall-clock is read internally. */
  date: Date;
  expiresSeconds: number;
  /** Headers to sign in addition to `host` (e.g. `content-type`). */
  signedHeaders?: Record<string, string>;
}

/** The presigned URL plus the intermediate strings (secret-free) for tests. */
export interface PresignResult {
  url: string;
  signature: string;
  credentialScope: string;
  amzDate: string;
  canonicalRequest: string;
  stringToSign: string;
}

/** RFC 3986 encoding — stricter than `encodeURIComponent` (also `!*'()`). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Encode a path per S3 rules: each segment encoded, the `/` separators kept. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

/** Split a signing instant into the `YYYYMMDDTHHMMSSZ` / `YYYYMMDD` pair. */
function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  // toISOString is always UTC with millis; strip separators + millis.
  const amzDate = date.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Build a presigned URL for a single-object request. The returned `url` is the
 * only value a caller needs; the other fields expose the (secret-free) canonical
 * strings so tests can pin them against known vectors.
 */
export function presignS3Url(params: PresignParams): PresignResult {
  const service = params.service ?? "s3";
  const { amzDate, dateStamp } = formatAmzDate(params.date);
  const credentialScope = `${dateStamp}/${params.region}/${service}/${AWS_REQUEST}`;

  // Canonical (signed) headers: always `host`, plus any extras, lowercased.
  const headers = new Map<string, string>([["host", params.host.trim()]]);
  for (const [name, value] of Object.entries(params.signedHeaders ?? {})) {
    headers.set(name.toLowerCase().trim(), value.trim());
  }
  const signedHeaderNames = [...headers.keys()].sort();
  const canonicalHeaders =
    signedHeaderNames.map((n) => `${n}:${headers.get(n)}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  // Query parameters that participate in the signature (signature itself is
  // appended afterwards and is never part of the canonical request).
  const query: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${params.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(params.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  if (params.sessionToken) query["X-Amz-Security-Token"] = params.sessionToken;

  const canonicalQuery = Object.entries(query)
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalUri = encodePath(params.path);
  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${params.secretAccessKey}`, dateStamp), params.region), service),
    AWS_REQUEST,
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const url =
    `${params.protocol}//${params.host}${canonicalUri}` +
    `?${canonicalQuery}&X-Amz-Signature=${signature}`;

  return { url, signature, credentialScope, amzDate, canonicalRequest, stringToSign };
}
