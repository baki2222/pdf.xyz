/**
 * The provider-agnostic **lifecycle policy model** — the safe, content-free
 * intermediate representation the CLI generates from {@link RetentionSettings} and
 * `./render.ts` turns into a provider-specific document (AWS S3, Cloudflare R2,
 * MinIO, or generic JSON).
 *
 * Why an intermediate model at all: an S3-compatible lifecycle configuration is
 * expressed in *days*, but the app's privacy retention is expressed in *minutes*
 * (default 60). A lifecycle rule therefore cannot be the primary sub-hour deletion
 * mechanism — the app's active delete-now already wipes an input the instant a job
 * finishes and expires artifacts on their own clock. This model makes that honest:
 * every object rule is a **backstop** — a coarse, day-granular guarantee that
 * nothing survives beyond the ceiling even if active deletion never runs — and its
 * derivation rounds the minute TTL *up* to at least one day so the backstop can
 * never delete an object the app still considers live.
 *
 * Content-free by construction: a rule carries only a stable id, a role, a
 * *structural* object prefix (`inputs/` / `artifacts/`, the same folders
 * `../storage/s3-keys.ts` derives), and integer day counts. It never contains a
 * bucket name, endpoint, credential, object key, or any environment value — so the
 * generated document is safe to print, log, commit to an ops runbook, or paste into
 * a provider console. Node-free: pure data, no I/O, no cloud calls.
 */

import type { RetentionSettings } from "./retention";

/** Structural object prefixes, matching the folders `s3-keys.ts` writes under. */
export const LIFECYCLE_PREFIXES = {
  input: "inputs/",
  artifact: "artifacts/",
} as const;

/** Hard ceiling (days) any backstop rule may specify — the 7-day privacy max. */
export const MAX_BACKSTOP_DAYS = 7;

/** The distinct kinds of lifecycle rule this model can express. */
export type LifecycleRuleRole =
  | "input-expiration" // delete input objects after the backstop window
  | "artifact-expiration" // delete produced artifacts after the backstop window
  | "abort-multipart-upload" // clean up stalled/incomplete multipart uploads
  | "noncurrent-version-expiration" // versioned buckets: delete old versions
  | "expired-delete-marker"; // versioned buckets: remove orphaned delete markers

/**
 * One provider-agnostic lifecycle rule. Every numeric field is a whole number of
 * days (the granularity S3-compatible providers enforce). Optional fields are
 * present only for the role that uses them, so a renderer can map role → provider
 * shape without guessing.
 */
export interface LifecycleRule {
  /** Stable, content-free identifier (also the provider rule id). */
  readonly id: string;
  readonly role: LifecycleRuleRole;
  /** Structural object prefix this rule targets (e.g. `inputs/`). Empty ⇒ whole bucket. */
  readonly prefix: string;
  /** One-line, content-free explanation of what the rule guarantees. */
  readonly description: string;
  /** Days after object creation to expire it (expiration roles). */
  readonly expireAfterDays?: number;
  /** Days after initiation to abort an incomplete multipart upload. */
  readonly abortIncompleteMultipartAfterDays?: number;
  /** Days after a version becomes noncurrent to delete it (versioned buckets). */
  readonly noncurrentVersionExpireAfterDays?: number;
  /** Remove delete markers with no noncurrent versions left (versioned buckets). */
  readonly expiredObjectDeleteMarker?: boolean;
}

/** The full provider-agnostic policy: a versioned envelope of rules plus notes. */
export interface LifecyclePolicy {
  /** Model version, so a renderer/consumer can detect a shape change. */
  readonly version: 1;
  /** Whether this policy targets a versioning-enabled bucket. */
  readonly versioned: boolean;
  /**
   * A content-free summary of the retention window each backstop was derived from
   * — minute TTLs plus the day-rounded backstop — so an operator can see, in the
   * generated artifact, exactly why each rule's day count is what it is.
   */
  readonly derivedFrom: {
    readonly inputTtlMinutes: number;
    readonly artifactTtlMinutes: number;
    readonly inputBackstopDays: number;
    readonly artifactBackstopDays: number;
    readonly multipartAbortDays: number;
    readonly noncurrentVersionDays: number;
  };
  readonly rules: LifecycleRule[];
  /** Operator-facing honesty notes (backstop-not-primary, day granularity, …). */
  readonly notes: string[];
}

/** A content-free reason a policy failed validation (names no value or secret). */
export interface LifecyclePolicyIssue {
  /** Stable code for the failing invariant. */
  readonly code:
    | "empty-prefix"
    | "unsafe-prefix"
    | "days-out-of-bounds"
    | "backstop-below-retention"
    | "no-rules"
    | "duplicate-rule-id";
  /** The rule id the issue concerns, or `"policy"` for whole-policy issues. */
  readonly ruleId: string;
  /** One-line, content-free explanation. */
  readonly message: string;
}

/** Outcome of validating a policy. */
export type ValidateLifecycleResult =
  | { ok: true }
  | { ok: false; issues: LifecyclePolicyIssue[] };

/**
 * Convert a minute-granularity retention TTL into a day-granularity backstop: round
 * *up* so the backstop is always ≥ the app's own retention (it must never delete an
 * object the app still considers live), and clamp to the {@link MAX_BACKSTOP_DAYS}
 * privacy ceiling. A 60-minute TTL therefore yields a 1-day backstop.
 */
export function minutesToBackstopDays(minutes: number): number {
  const days = Math.ceil(minutes / (60 * 24));
  return Math.min(MAX_BACKSTOP_DAYS, Math.max(1, days));
}

/** Convert an hours value to whole days, rounding up, floored at 1 day. */
function hoursToDays(hours: number): number {
  return Math.max(1, Math.ceil(hours / 24));
}

/** A structural prefix is safe: relative, no traversal, no leading slash or spaces. */
const SAFE_PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]*\/$/;

/**
 * Normalize an optional operator key prefix into a leading path segment. A custom
 * key prefix is *operator config*, never user input; we still sanitize it (strip
 * surrounding slashes, reject traversal) so a typo can't produce a bucket-wide or
 * malformed rule. Returns `""` when unset, or `"<prefix>/"` when valid; a malformed
 * prefix is dropped to `""` and surfaces as a validation issue on the built rules.
 */
function normalizeKeyPrefix(keyPrefix: string | undefined): string {
  if (keyPrefix === undefined) return "";
  const trimmed = keyPrefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "") return "";
  if (trimmed.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(trimmed)) {
    // Unsafe: keep it in the rule so validation flags it rather than silently
    // widening the rule to the whole bucket.
    return `${trimmed}/`;
  }
  return `${trimmed}/`;
}

/** Options controlling policy generation. */
export interface BuildLifecycleOptions {
  /**
   * Optional structural key prefix every rule nests under (mirrors
   * `PDFXYZ_S3_KEY_PREFIX`). Defaults to none, targeting the bare `inputs/` /
   * `artifacts/` folders. Operator config, not a secret.
   */
  readonly keyPrefix?: string;
  /** Emit the versioned-bucket rules (noncurrent-version + delete-marker cleanup). */
  readonly versioned?: boolean;
}

/**
 * Build the provider-agnostic {@link LifecyclePolicy} from resolved
 * {@link RetentionSettings}. Deterministic and content-free. The object rules are
 * backstops (see the module header); the multipart rule bounds stalled uploads; the
 * versioned rules are emitted only when `versioned` is requested.
 */
export function buildLifecyclePolicy(
  retention: RetentionSettings,
  options: BuildLifecycleOptions = {},
): LifecyclePolicy {
  const prefix = normalizeKeyPrefix(options.keyPrefix);
  const versioned = options.versioned ?? false;

  const inputBackstopDays = minutesToBackstopDays(retention.inputTtlMinutes);
  const artifactBackstopDays = minutesToBackstopDays(retention.artifactTtlMinutes);
  const multipartAbortDays = hoursToDays(retention.multipartAbortHours);

  const inputPrefix = `${prefix}${LIFECYCLE_PREFIXES.input}`;
  const artifactPrefix = `${prefix}${LIFECYCLE_PREFIXES.artifact}`;

  const rules: LifecycleRule[] = [
    {
      id: "pdfxyz-input-expiration",
      role: "input-expiration",
      prefix: inputPrefix,
      description:
        "Backstop: delete any input object still present after the retention window. The app deletes inputs the instant a job finishes; this guarantees deletion even if that never runs.",
      expireAfterDays: inputBackstopDays,
    },
    {
      id: "pdfxyz-artifact-expiration",
      role: "artifact-expiration",
      prefix: artifactPrefix,
      description:
        "Backstop: delete any produced artifact still present after the retention window, guaranteeing no output outlives its privacy ceiling.",
      expireAfterDays: artifactBackstopDays,
    },
    {
      id: "pdfxyz-abort-multipart",
      role: "abort-multipart-upload",
      prefix,
      description:
        "Abort stalled/incomplete multipart uploads so failed large-file transfers cannot accumulate as billable, unreferenced parts.",
      abortIncompleteMultipartAfterDays: multipartAbortDays,
    },
  ];

  if (versioned) {
    rules.push(
      {
        id: "pdfxyz-noncurrent-version-expiration",
        role: "noncurrent-version-expiration",
        prefix,
        description:
          "Versioned bucket: delete noncurrent object versions so an overwritten or deleted object's prior bytes are not retained beyond the window.",
        noncurrentVersionExpireAfterDays: retention.noncurrentVersionDays,
      },
      {
        id: "pdfxyz-expired-delete-marker",
        role: "expired-delete-marker",
        prefix,
        description:
          "Versioned bucket: remove delete markers left with no noncurrent versions, so a fully-deleted object leaves nothing behind.",
        expiredObjectDeleteMarker: true,
      },
    );
  }

  const notes = [
    "These rules are a safety backstop, not the primary deletion path: the app actively deletes inputs when a job completes and expires artifacts on their own clock. Lifecycle rules guarantee an upper bound even if active deletion fails.",
    "S3-compatible lifecycle expiration is day-granular, so a sub-day retention window (e.g. 60 minutes) is rounded up to a 1-day backstop. Do not widen these day counts.",
    "Rules target structural object prefixes only; no bucket name, endpoint, or credential appears in this policy. Apply it to the bucket named in your provider console/CLI.",
  ];
  if (!versioned) {
    notes.push(
      "This policy assumes a non-versioned bucket. If versioning is enabled, regenerate with the versioned option so noncurrent versions and delete markers are also cleaned up.",
    );
  }

  return {
    version: 1,
    versioned,
    derivedFrom: {
      inputTtlMinutes: retention.inputTtlMinutes,
      artifactTtlMinutes: retention.artifactTtlMinutes,
      inputBackstopDays,
      artifactBackstopDays,
      multipartAbortDays,
      noncurrentVersionDays: retention.noncurrentVersionDays,
    },
    rules,
    notes,
  };
}

/**
 * Validate a built (or hand-authored) {@link LifecyclePolicy} for the invariants a
 * safe backstop must hold: at least one rule, unique ids, safe non-empty prefixes on
 * object-expiration rules, every day count within `[1, MAX_BACKSTOP_DAYS]`, and each
 * object backstop ≥ the retention window it must outlast. Content-free issues only.
 */
export function validateLifecyclePolicy(
  policy: LifecyclePolicy,
): ValidateLifecycleResult {
  const issues: LifecyclePolicyIssue[] = [];

  if (policy.rules.length === 0) {
    issues.push({
      code: "no-rules",
      ruleId: "policy",
      message: "A lifecycle policy must contain at least one rule.",
    });
  }

  const seen = new Set<string>();
  for (const rule of policy.rules) {
    if (seen.has(rule.id)) {
      issues.push({
        code: "duplicate-rule-id",
        ruleId: rule.id,
        message: "Rule ids must be unique within a policy.",
      });
    }
    seen.add(rule.id);

    // Object-expiration rules must target a specific, safe folder — never the bare
    // bucket (which would delete unrelated objects).
    const isObjectExpiration =
      rule.role === "input-expiration" || rule.role === "artifact-expiration";
    if (isObjectExpiration) {
      if (rule.prefix.length === 0) {
        issues.push({
          code: "empty-prefix",
          ruleId: rule.id,
          message: "An object-expiration rule must target a non-empty prefix.",
        });
      } else if (!SAFE_PREFIX_RE.test(rule.prefix)) {
        issues.push({
          code: "unsafe-prefix",
          ruleId: rule.id,
          message:
            "Prefix must be a safe, slash-terminated path with no traversal or illegal characters.",
        });
      }
    }

    for (const days of [
      rule.expireAfterDays,
      rule.abortIncompleteMultipartAfterDays,
      rule.noncurrentVersionExpireAfterDays,
    ]) {
      if (days === undefined) continue;
      if (!Number.isInteger(days) || days < 1 || days > MAX_BACKSTOP_DAYS) {
        issues.push({
          code: "days-out-of-bounds",
          ruleId: rule.id,
          message: `Day counts must be integers in [1, ${MAX_BACKSTOP_DAYS}].`,
        });
      }
    }
  }

  // Each object backstop must be ≥ its retention window (rounded up), else it could
  // delete an object the app still treats as live.
  const checkBackstop = (
    role: LifecycleRuleRole,
    ttlMinutes: number,
    ruleId: string,
  ) => {
    const rule = policy.rules.find((r) => r.role === role);
    if (!rule || rule.expireAfterDays === undefined) return;
    if (rule.expireAfterDays < minutesToBackstopDays(ttlMinutes)) {
      issues.push({
        code: "backstop-below-retention",
        ruleId,
        message:
          "Backstop expiration is shorter than the retention window it must outlast.",
      });
    }
  };
  checkBackstop(
    "input-expiration",
    policy.derivedFrom.inputTtlMinutes,
    "pdfxyz-input-expiration",
  );
  checkBackstop(
    "artifact-expiration",
    policy.derivedFrom.artifactTtlMinutes,
    "pdfxyz-artifact-expiration",
  );

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
