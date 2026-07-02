/**
 * Server-side configuration for the S3-compatible object-storage provider —
 * parsed from the environment, validated for **presence and shape only**.
 *
 * Security posture (this is the load-bearing rule of the whole module):
 *  - We read the credential *values* only to build a signing key inside the
 *    provider closure. They are **never** logged, serialized, returned to a
 *    client, or placed in a {@link StorageCapability}/status response. A parse
 *    failure names the offending *variable* (e.g. `PDFXYZ_S3_BUCKET`) — never its
 *    value.
 *  - This is a node-free leaf (plain string parsing + the WHATWG `URL`), so the
 *    presence-only status reporter (`providers.ts`) can derive storage readiness
 *    from it without pulling `node:crypto` or the signer into a client bundle.
 *
 * Selection is explicit: storage is only treated as S3 when
 * `PDFXYZ_STORAGE_PROVIDER=s3`. When it is unset the parser reports "not
 * selected" and the caller falls back to the honest not-configured / local-dev
 * behavior. When it *is* set but any required variable is missing or malformed,
 * the parse fails and the caller preserves the honest `not_configured` posture —
 * it never mints a target from a half-configured backend.
 */

import type { FieldError } from "@/lib/jobs";
import type { StorageCapability } from "./types";

/** The environment variables this provider reads (names only; never values). */
export const S3_ENV = {
  provider: "PDFXYZ_STORAGE_PROVIDER",
  endpoint: "PDFXYZ_S3_ENDPOINT",
  region: "PDFXYZ_S3_REGION",
  bucket: "PDFXYZ_S3_BUCKET",
  accessKeyId: "PDFXYZ_S3_ACCESS_KEY_ID",
  secretAccessKey: "PDFXYZ_S3_SECRET_ACCESS_KEY",
  forcePathStyle: "PDFXYZ_S3_FORCE_PATH_STYLE",
  keyPrefix: "PDFXYZ_S3_KEY_PREFIX",
  sessionToken: "PDFXYZ_S3_SESSION_TOKEN",
  uploadTtlSeconds: "PDFXYZ_S3_UPLOAD_TTL_SECONDS",
  downloadTtlSeconds: "PDFXYZ_S3_DOWNLOAD_TTL_SECONDS",
} as const;

/** The value of {@link S3_ENV.provider} that selects this provider. */
export const S3_PROVIDER_VALUE = "s3";

/** SigV4 hard ceiling for a presigned URL's lifetime (7 days), in seconds. */
export const MAX_PRESIGN_TTL_SECONDS = 604_800;
const DEFAULT_UPLOAD_TTL_SECONDS = 900; // 15 min: enough for a large, slow PUT.
const DEFAULT_DOWNLOAD_TTL_SECONDS = 900;

type EnvSource = Record<string, string | undefined>;

/**
 * A validated, ready-to-sign S3 configuration. Holds the credential values used
 * only to sign requests inside the provider closure — this object must never be
 * logged, serialized, or handed to a client.
 */
export interface S3StorageConfig {
  /** Parsed endpoint origin (no path/query): the account/region/MinIO host. */
  readonly protocol: "http:" | "https:";
  readonly host: string;
  readonly region: string;
  readonly bucket: string;
  /** Non-secret key identifier (appears in every presigned URL, by design). */
  readonly accessKeyId: string;
  /** SECRET — the signing key input. Never logged or returned. */
  readonly secretAccessKey: string;
  /** SECRET — optional STS session token for temporary credentials. */
  readonly sessionToken?: string;
  /** Path-style (`host/bucket/key`, for MinIO/some R2) vs virtual-host. */
  readonly forcePathStyle: boolean;
  /** Optional, sanitized key prefix for sharing a bucket. May be empty. */
  readonly keyPrefix: string;
  /** Signed-URL lifetimes (seconds), clamped to the SigV4 ceiling. */
  readonly uploadTtlSeconds: number;
  readonly downloadTtlSeconds: number;
}

/** Outcome of parsing the environment for an S3 configuration. */
export type ParseS3ConfigResult =
  | { ok: true; config: S3StorageConfig }
  | {
      ok: false;
      /** Whether `PDFXYZ_STORAGE_PROVIDER=s3` was set at all. */
      selected: boolean;
      /** Missing/malformed variables, by NAME only. Server-side diagnostics. */
      issues: FieldError[];
    };

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when this environment explicitly selects the S3 provider. */
export function isS3StorageSelected(env: EnvSource = process.env): boolean {
  return read(env, S3_ENV.provider)?.toLowerCase() === S3_PROVIDER_VALUE;
}

const BUCKET_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{1,61}[A-Za-z0-9]$/;
const REGION_RE = /^[A-Za-z0-9][A-Za-z0-9\-]{0,62}$/;
const ACCESS_KEY_RE = /^[A-Za-z0-9]{3,256}$/;
// A credential/token value: printable ASCII with no spaces. Deliberately loose
// so we never reject a valid secret (base64/hex/±/=), only obvious junk.
const SECRET_RE = /^[\x21-\x7e]{8,1024}$/;
const PREFIX_RE = /^[A-Za-z0-9/_\-]{1,256}$/;

/** Parse a boolean flag; unset ⇒ default, unrecognized ⇒ error. */
function parseFlag(
  raw: string | undefined,
  fallback: boolean,
): { ok: true; value: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, value: fallback };
  const v = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return { ok: true, value: true };
  if (["false", "0", "no", "off"].includes(v)) return { ok: true, value: false };
  return { ok: false };
}

/** Parse a positive-integer TTL within the SigV4 ceiling; unset ⇒ default. */
function parseTtl(
  raw: string | undefined,
  fallback: number,
): { ok: true; value: number } | { ok: false } {
  if (raw === undefined) return { ok: true, value: fallback };
  if (!/^\d{1,7}$/.test(raw)) return { ok: false };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PRESIGN_TTL_SECONDS) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

/** Normalize + validate the endpoint to a bare origin (no path/query/creds). */
function parseEndpoint(
  raw: string,
): { ok: true; protocol: "http:" | "https:"; host: string } | { ok: false } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  // An endpoint is an origin: reject an embedded path, query, fragment, or
  // credentials so a typo can't silently redirect uploads somewhere unexpected.
  if (url.username || url.password || url.search || url.hash) return { ok: false };
  if (url.pathname !== "" && url.pathname !== "/") return { ok: false };
  if (!url.host) return { ok: false };
  return { ok: true, protocol: url.protocol, host: url.host };
}

/** Strip surrounding slashes and reject traversal/illegal chars in a prefix. */
function parseKeyPrefix(
  raw: string | undefined,
): { ok: true; value: string } | { ok: false } {
  if (raw === undefined) return { ok: true, value: "" };
  const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "") return { ok: true, value: "" };
  if (trimmed.includes("..") || !PREFIX_RE.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

/**
 * Parse and validate the S3 configuration from an environment source. Presence
 * and shape only: it confirms every required variable is present and well-formed
 * but never checks a credential against the live service (that happens when the
 * client uses the signed URL). `env` is injectable for deterministic tests.
 */
export function parseS3Config(env: EnvSource = process.env): ParseS3ConfigResult {
  if (!isS3StorageSelected(env)) {
    return { ok: false, selected: false, issues: [] };
  }

  const issues: FieldError[] = [];
  const miss = (name: string, message: string) =>
    issues.push({ field: name, message });

  // Required.
  const endpointRaw = read(env, S3_ENV.endpoint);
  let endpoint: { protocol: "http:" | "https:"; host: string } | null = null;
  if (!endpointRaw) {
    miss(S3_ENV.endpoint, "Set the S3-compatible endpoint origin (https URL).");
  } else {
    const parsed = parseEndpoint(endpointRaw);
    if (!parsed.ok) {
      miss(S3_ENV.endpoint, "Must be an http(s) origin with no path or query.");
    } else {
      endpoint = { protocol: parsed.protocol, host: parsed.host };
    }
  }

  const region = read(env, S3_ENV.region);
  if (!region) miss(S3_ENV.region, "Set the bucket region (e.g. `auto`).");
  else if (!REGION_RE.test(region)) miss(S3_ENV.region, "Malformed region.");

  const bucket = read(env, S3_ENV.bucket);
  if (!bucket) miss(S3_ENV.bucket, "Set the bucket name.");
  else if (!BUCKET_RE.test(bucket)) miss(S3_ENV.bucket, "Malformed bucket name.");

  const accessKeyId = read(env, S3_ENV.accessKeyId);
  if (!accessKeyId) miss(S3_ENV.accessKeyId, "Set the access key id.");
  else if (!ACCESS_KEY_RE.test(accessKeyId)) {
    miss(S3_ENV.accessKeyId, "Malformed access key id.");
  }

  const secretAccessKey = read(env, S3_ENV.secretAccessKey);
  if (!secretAccessKey) miss(S3_ENV.secretAccessKey, "Set the secret access key.");
  else if (!SECRET_RE.test(secretAccessKey)) {
    miss(S3_ENV.secretAccessKey, "Malformed secret access key.");
  }

  // Optional.
  const sessionTokenRaw = read(env, S3_ENV.sessionToken);
  if (sessionTokenRaw !== undefined && !SECRET_RE.test(sessionTokenRaw)) {
    miss(S3_ENV.sessionToken, "Malformed session token.");
  }

  const flag = parseFlag(read(env, S3_ENV.forcePathStyle), false);
  if (!flag.ok) miss(S3_ENV.forcePathStyle, "Must be true or false.");

  const prefix = parseKeyPrefix(read(env, S3_ENV.keyPrefix));
  if (!prefix.ok) {
    miss(S3_ENV.keyPrefix, "Malformed key prefix (no `..`, no leading slash).");
  }

  const uploadTtl = parseTtl(
    read(env, S3_ENV.uploadTtlSeconds),
    DEFAULT_UPLOAD_TTL_SECONDS,
  );
  if (!uploadTtl.ok) {
    miss(S3_ENV.uploadTtlSeconds, `Integer seconds 1–${MAX_PRESIGN_TTL_SECONDS}.`);
  }

  const downloadTtl = parseTtl(
    read(env, S3_ENV.downloadTtlSeconds),
    DEFAULT_DOWNLOAD_TTL_SECONDS,
  );
  if (!downloadTtl.ok) {
    miss(S3_ENV.downloadTtlSeconds, `Integer seconds 1–${MAX_PRESIGN_TTL_SECONDS}.`);
  }

  if (
    issues.length > 0 ||
    !endpoint ||
    !region ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !flag.ok ||
    !prefix.ok ||
    !uploadTtl.ok ||
    !downloadTtl.ok
  ) {
    return { ok: false, selected: true, issues };
  }

  return {
    ok: true,
    config: {
      protocol: endpoint.protocol,
      host: endpoint.host,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      ...(sessionTokenRaw ? { sessionToken: sessionTokenRaw } : {}),
      forcePathStyle: flag.value,
      keyPrefix: prefix.value,
      uploadTtlSeconds: uploadTtl.value,
      downloadTtlSeconds: downloadTtl.value,
    },
  };
}

/**
 * The client-safe capability of a *ready* S3 provider. Deliberately contains no
 * bucket, endpoint, account, key id, region, or secret — only the honest "this
 * environment can mint signed targets and delete objects" signal and a generic
 * explanation.
 */
export function s3StorageCapability(): StorageCapability {
  return {
    provider: "s3",
    ready: true,
    configured: true,
    signedUploads: true,
    signedDownloads: true,
    deleteNow: true,
    detail:
      "S3-compatible object storage is configured and ready: the app mints short-lived, signed upload and download URLs and can delete objects on demand. Files transfer directly between the browser and encrypted storage — never through this app server.",
  };
}

/**
 * Presence-only storage readiness for the status layer. Returns the ready S3
 * capability when S3 is selected AND fully valid; otherwise `null`, signaling
 * the caller to fall back to the mode-based (honest not-configured / local-dev)
 * capability. A selected-but-misconfigured deployment therefore reports as
 * not-configured to the client (no fingerprinting), while server-side diagnostics
 * remain available via {@link parseS3Config}. Never reads or returns a secret.
 */
export function resolveStorageCapability(
  env: EnvSource = process.env,
): StorageCapability | null {
  const parsed = parseS3Config(env);
  return parsed.ok ? s3StorageCapability() : null;
}
