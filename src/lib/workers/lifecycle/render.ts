/**
 * Provider-specific **rendering** of the provider-agnostic {@link LifecyclePolicy}
 * into a document an operator can apply to their bucket — for AWS S3, Cloudflare R2,
 * MinIO, or as generic JSON.
 *
 * Everything here is pure string building over the content-free policy model: a
 * rendered document contains only rule ids, structural prefixes (`inputs/` /
 * `artifacts/`), day counts, and `Status: Enabled`. It NEVER contains a bucket name,
 * endpoint, region, credential, object key, or any environment value. The bucket a
 * policy is applied to is supplied by the operator on the provider CLI (a `<bucket>`
 * placeholder in the apply hint), never baked into the document — mirroring how a
 * real S3 `put-bucket-lifecycle-configuration` takes the bucket as a separate
 * argument from the lifecycle body.
 */

import type { LifecyclePolicy, LifecycleRule } from "./policy";

/** The providers this module can render a policy for. */
export const LIFECYCLE_PROVIDERS = [
  "aws-s3",
  "cloudflare-r2",
  "minio",
  "generic",
] as const;

export type LifecycleProvider = (typeof LIFECYCLE_PROVIDERS)[number];

/** Narrow an arbitrary string to a known {@link LifecycleProvider}. */
export function isLifecycleProvider(value: string): value is LifecycleProvider {
  return (LIFECYCLE_PROVIDERS as readonly string[]).includes(value);
}

/** A rendered, ready-to-apply lifecycle document plus content-free apply guidance. */
export interface RenderedLifecyclePolicy {
  readonly provider: LifecycleProvider;
  readonly format: "json";
  /** Suggested filename for the document. */
  readonly filename: string;
  /**
   * A content-free command template for applying the document. Uses a literal
   * `<bucket>` placeholder — never a real bucket name — so it is safe to print/log.
   */
  readonly applyHint: string;
  /** The rendered document text (pretty JSON). */
  readonly document: string;
  /** Provider-specific caveats plus the policy's own honesty notes. */
  readonly notes: string[];
}

/** Whether a rule only makes sense on a versioning-enabled bucket. */
function isVersionedRule(rule: LifecycleRule): boolean {
  return (
    rule.role === "noncurrent-version-expiration" ||
    rule.role === "expired-delete-marker"
  );
}

/**
 * Map one agnostic rule to the S3 lifecycle-configuration shape shared by AWS S3,
 * MinIO, and (for the supported subset) Cloudflare R2. Deterministic key order for
 * a stable, reviewable diff.
 */
function toS3Rule(rule: LifecycleRule): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ID: rule.id,
    Filter: { Prefix: rule.prefix },
    Status: "Enabled",
  };
  if (rule.expiredObjectDeleteMarker) {
    out.Expiration = { ExpiredObjectDeleteMarker: true };
  } else if (rule.expireAfterDays !== undefined) {
    out.Expiration = { Days: rule.expireAfterDays };
  }
  if (rule.abortIncompleteMultipartAfterDays !== undefined) {
    out.AbortIncompleteMultipartUpload = {
      DaysAfterInitiation: rule.abortIncompleteMultipartAfterDays,
    };
  }
  if (rule.noncurrentVersionExpireAfterDays !== undefined) {
    out.NoncurrentVersionExpiration = {
      NoncurrentDays: rule.noncurrentVersionExpireAfterDays,
    };
  }
  return out;
}

/** Serialize an object as stable, pretty JSON (2-space indent, trailing newline). */
function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** AWS S3 `LifecycleConfiguration` document — applied via `s3api`. */
function renderAwsS3(policy: LifecyclePolicy): RenderedLifecyclePolicy {
  return {
    provider: "aws-s3",
    format: "json",
    filename: "pdfxyz-lifecycle.aws-s3.json",
    applyHint:
      "aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration file://pdfxyz-lifecycle.aws-s3.json",
    document: toJson({ Rules: policy.rules.map(toS3Rule) }),
    notes: [...policy.notes],
  };
}

/**
 * Cloudflare R2 lifecycle document. R2 speaks the S3 lifecycle API but supports
 * only the object-expiration and multipart-abort subset (it has no object
 * versioning), so versioned rules are dropped and called out.
 */
function renderCloudflareR2(policy: LifecyclePolicy): RenderedLifecyclePolicy {
  const supported = policy.rules.filter((r) => !isVersionedRule(r));
  const dropped = policy.rules.length - supported.length;
  const notes = [...policy.notes];
  if (dropped > 0) {
    notes.push(
      "Cloudflare R2 has no object versioning, so noncurrent-version and delete-marker rules were omitted. Do not enable versioning-dependent rules on R2.",
    );
  }
  notes.push(
    "Apply with the S3-compatible API against your R2 endpoint, or manage rules in the Cloudflare dashboard. The document names no bucket or endpoint.",
  );
  return {
    provider: "cloudflare-r2",
    format: "json",
    filename: "pdfxyz-lifecycle.r2.json",
    applyHint:
      "aws s3api put-bucket-lifecycle-configuration --endpoint-url <r2-endpoint> --bucket <bucket> --lifecycle-configuration file://pdfxyz-lifecycle.r2.json",
    document: toJson({ Rules: supported.map(toS3Rule) }),
    notes,
  };
}

/** MinIO document — S3-compatible, imported via `mc ilm import`. */
function renderMinio(policy: LifecyclePolicy): RenderedLifecyclePolicy {
  return {
    provider: "minio",
    format: "json",
    filename: "pdfxyz-lifecycle.minio.json",
    applyHint:
      "mc ilm import <alias>/<bucket> < pdfxyz-lifecycle.minio.json",
    document: toJson({ Rules: policy.rules.map(toS3Rule) }),
    notes: [
      ...policy.notes,
      "MinIO imports the same S3 lifecycle shape. `<alias>` is your configured `mc` server alias; the document itself names no server or bucket.",
    ],
  };
}

/** Generic document — the provider-agnostic model, pretty-printed verbatim. */
function renderGeneric(policy: LifecyclePolicy): RenderedLifecyclePolicy {
  return {
    provider: "generic",
    format: "json",
    filename: "pdfxyz-lifecycle.generic.json",
    applyHint:
      "Translate these rules into your provider's lifecycle format and apply them to <bucket>.",
    document: toJson(policy),
    notes: [
      ...policy.notes,
      "This is the provider-agnostic model. Map each rule's role, prefix, and day counts onto your provider's lifecycle configuration.",
    ],
  };
}

/**
 * Render a {@link LifecyclePolicy} for a specific provider. Pure and deterministic;
 * the output is content-free and safe to print, log, or commit to an ops runbook.
 */
export function renderLifecyclePolicy(
  policy: LifecyclePolicy,
  provider: LifecycleProvider,
): RenderedLifecyclePolicy {
  switch (provider) {
    case "aws-s3":
      return renderAwsS3(policy);
    case "cloudflare-r2":
      return renderCloudflareR2(policy);
    case "minio":
      return renderMinio(policy);
    case "generic":
      return renderGeneric(policy);
  }
}
