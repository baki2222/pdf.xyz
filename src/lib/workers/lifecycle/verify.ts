/**
 * Dry-run retention/deletion **verifier** — the honest evidence rung between a
 * *generated* lifecycle policy (`./policy.ts` + `./render.ts`) and an operator-
 * *applied* one.
 *
 * The load-bearing constraint of this whole subsystem is that the app **never calls
 * the cloud**: confirming a live bucket's lifecycle rules would need a provider API
 * call this build deliberately does not make (see `./config.ts`). So verification is
 * done against an *observed document* the operator exports out-of-band with their
 * own credentials — e.g. `aws s3api get-bucket-lifecycle-configuration > observed.json`
 * — and hands to the daemon. That exported document is itself **content-free**: an
 * S3 lifecycle configuration carries only rule ids, structural prefixes, day counts,
 * and `Status`; it never contains a bucket name, endpoint, credential, or object key.
 * This module parses that document and compares it, structurally, to the policy the
 * app *would* generate — turning the bare `PDFXYZ_LIFECYCLE_VALIDATED=true` operator
 * assertion (`./config.ts`) into checkable evidence.
 *
 * Honesty & privacy posture:
 *  - Node-free leaf: pure string/JSON parsing and data comparison, no I/O and no
 *    cloud call, so it composes into the daemon CLI and any status surface without
 *    pulling a Node built-in. The CLI reads the operator's file; this only sees text.
 *  - When there is nothing to verify against (no observed document) the caller
 *    reports an honest `unknown`/not-configured — it never upgrades absence to
 *    success, exactly as `./config.ts` never claims rules are in force from a flag.
 *  - Content-free output by construction: every check and plan item references only
 *    the app's own fixed `pdfxyz-*` rule ids, a status/action enum, fixed prose, and
 *    integer counts. It never echoes an observed rule's id, prefix, or any value from
 *    the operator's document back into the report/log.
 *
 * Matching is by structure, not by id: an observed rule "governs" an expected rule
 * when it targets a prefix that *covers* the expected rule's prefix (a whole-bucket
 * rule covers `inputs/`) and carries the field for that rule's role — so an operator
 * may name their rules anything and still verify clean. When several enabled observed
 * rules cover the same expected prefix, the *shortest* expiration wins (mirroring S3's
 * "earliest expiration applies" semantics), so the verifier judges the effective
 * deletion the bucket will really enforce, not a rule in isolation.
 */

import type {
  LifecyclePolicy,
  LifecycleRule,
  LifecycleRuleRole,
} from "./policy";

/** Caps that keep a hostile/huge observed document from becoming a DoS. */
const MAX_OBSERVED_CHARS = 256 * 1024;
const MAX_OBSERVED_RULES = 1_000;

/**
 * A single lifecycle rule as recovered from an observed provider document,
 * normalized to the same field vocabulary as {@link LifecycleRule}. It is the
 * structural inverse of `./render.ts`'s `toS3Rule`, so a document this app rendered
 * and an operator applied round-trips back to the rules it was built from. Only the
 * fields the verifier compares are kept; anything else in the document is ignored.
 */
export interface ObservedLifecycleRule {
  /** `Status: Enabled`? A disabled rule enforces nothing, so this is load-bearing. */
  readonly enabled: boolean;
  /** The rule's object prefix (`Filter.Prefix`), or `""` for a whole-bucket rule. */
  readonly prefix: string;
  /**
   * True when the rule's filter is NARROWER than its prefix — it carries a tag,
   * object-size, or multi-condition (`Filter.And`) predicate, so it does not delete
   * *every* object under `prefix`. A scoped rule is excluded from coverage (it can
   * never satisfy a prefix backstop) so an unparseable scope fails safe as
   * missing/drift rather than being widened to whole-bucket. Absent ⇒ a pure
   * prefix/whole-bucket rule.
   */
  readonly scoped?: boolean;
  /** Days after creation the rule expires objects (`Expiration.Days`). */
  readonly expireAfterDays?: number;
  /** Days after initiation the rule aborts incomplete multipart uploads. */
  readonly abortIncompleteMultipartAfterDays?: number;
  /** Days after a version becomes noncurrent the rule deletes it. */
  readonly noncurrentVersionExpireAfterDays?: number;
  /** Whether the rule removes expired object delete markers. */
  readonly expiredObjectDeleteMarker?: boolean;
}

/** The normalized observed lifecycle configuration (a list of rules). */
export interface ObservedLifecycle {
  readonly rules: ObservedLifecycleRule[];
}

/** A content-free reason an observed document could not be parsed. */
export type ObservedIssueCode =
  | "empty-document" // nothing to parse
  | "too-large" // beyond the safety caps (chars or rule count)
  | "malformed-json" // not valid JSON
  | "not-an-object" // valid JSON but not a lifecycle object
  | "no-rules"; // no `Rules`/`rules` array to compare

export interface ObservedIssue {
  readonly code: ObservedIssueCode;
  /** One-line, content-free explanation. Never echoes the document. */
  readonly message: string;
}

/** Outcome of parsing an observed document. */
export type ParseObservedResult =
  | { ok: true; observed: ObservedLifecycle }
  | { ok: false; issues: ObservedIssue[] };

/** A whole number, or `undefined` for anything else (defensive against junk). */
function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** A plain object (not null, not an array). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Resolve a rule's object scope from its S3 filter. A rule only *guarantees* deletion
 * of every object under a prefix when its filter is a **pure prefix** (or whole-bucket).
 * Real `get-bucket-lifecycle-configuration` output expresses a tag/size/multi-condition
 * filter as `Filter.And { Prefix, Tags, ObjectSizeGreaterThan }`, `Filter.Tag`, or
 * `Filter.ObjectSizeGreaterThan` — none of which has a top-level `Filter.Prefix`, and
 * each of which is NARROWER than any prefix (it deletes only the tagged/sized subset).
 * Such a rule cannot be credited toward a prefix backstop, so it is marked `scoped`
 * and excluded from coverage. Failing safe (missing/drift) is mandatory here: widening
 * an un-parseable scope to `""` would make `covers("", anything)` true and falsely
 * report a scoped rule as satisfying the whole-bucket backstop.
 */
function resolveFilterScope(r: Record<string, unknown>): {
  prefix: string;
  scoped: boolean;
} {
  const filter = asRecord(r.Filter);
  if (!("Filter" in r)) {
    // No `Filter` at all: a bare legacy top-level `Prefix`, else whole-bucket. Pure.
    return { prefix: typeof r.Prefix === "string" ? r.Prefix : "", scoped: false };
  }
  if (!filter) {
    // `Filter` present but not an object (malformed) → unknown scope, fail safe.
    return { prefix: "", scoped: true };
  }
  const keys = Object.keys(filter);
  if (keys.length === 0) {
    return { prefix: "", scoped: false }; // `Filter: {}` ⇒ whole bucket, pure.
  }
  if (keys.length === 1 && typeof filter.Prefix === "string") {
    return { prefix: filter.Prefix, scoped: false }; // pure prefix filter.
  }
  // Any additional predicate (And / Tag / Tags / ObjectSize* / unknown) narrows the
  // rule below its prefix — exclude it from coverage rather than over-match.
  return { prefix: "", scoped: true };
}

/** Recover one rule from an S3 `LifecycleConfiguration` rule shape, or `null`. */
function fromS3Rule(raw: unknown): ObservedLifecycleRule | null {
  const r = asRecord(raw);
  if (!r) return null;
  const { prefix, scoped } = resolveFilterScope(r);
  const expiration = asRecord(r.Expiration);
  const abort = asRecord(r.AbortIncompleteMultipartUpload);
  const noncurrent = asRecord(r.NoncurrentVersionExpiration);

  const expireAfterDays = asPositiveInt(expiration?.Days);
  const abortDays = asPositiveInt(abort?.DaysAfterInitiation);
  // `NewerNoncurrentVersions: N (≥1)` RETAINS the N most-recent noncurrent versions,
  // so the rule is not a clean "delete noncurrent versions" backstop — drop the day
  // count so it reads as missing/drift rather than a false `satisfied`.
  const retainsNoncurrent =
    (asPositiveInt(noncurrent?.NewerNoncurrentVersions) ?? 0) > 0;
  const noncurrentDays = retainsNoncurrent
    ? undefined
    : asPositiveInt(noncurrent?.NoncurrentDays);
  return {
    enabled: r.Status === "Enabled",
    prefix,
    ...(scoped ? { scoped: true } : {}),
    ...(expireAfterDays !== undefined ? { expireAfterDays } : {}),
    ...(expiration?.ExpiredObjectDeleteMarker === true
      ? { expiredObjectDeleteMarker: true }
      : {}),
    ...(abortDays !== undefined
      ? { abortIncompleteMultipartAfterDays: abortDays }
      : {}),
    ...(noncurrentDays !== undefined
      ? { noncurrentVersionExpireAfterDays: noncurrentDays }
      : {}),
  };
}

/** Recover one rule from the provider-agnostic {@link LifecycleRule} shape. */
function fromAgnosticRule(raw: unknown): ObservedLifecycleRule | null {
  const r = asRecord(raw);
  if (!r) return null;
  const expireAfterDays = asPositiveInt(r.expireAfterDays);
  const abortDays = asPositiveInt(r.abortIncompleteMultipartAfterDays);
  const noncurrentDays = asPositiveInt(r.noncurrentVersionExpireAfterDays);
  return {
    // The agnostic model has no status field; a rendered rule is implicitly active.
    enabled: true,
    prefix: typeof r.prefix === "string" ? r.prefix : "",
    ...(expireAfterDays !== undefined ? { expireAfterDays } : {}),
    ...(r.expiredObjectDeleteMarker === true
      ? { expiredObjectDeleteMarker: true }
      : {}),
    ...(abortDays !== undefined
      ? { abortIncompleteMultipartAfterDays: abortDays }
      : {}),
    ...(noncurrentDays !== undefined
      ? { noncurrentVersionExpireAfterDays: noncurrentDays }
      : {}),
  };
}

/**
 * Parse an observed lifecycle document (the JSON an operator exports from their
 * bucket, or the app's own rendered policy) into a normalized {@link ObservedLifecycle}.
 * Accepts both the S3 `{ Rules: [...] }` shape (AWS S3 / MinIO / Cloudflare R2, and
 * what `./render.ts` emits for them) and the provider-agnostic `{ rules: [...] }`
 * model (the `generic` render). Defensive: bounded, tolerant of unknown fields, and
 * every failure is a content-free {@link ObservedIssue} that never echoes the input.
 */
export function parseObservedLifecycle(text: string): ParseObservedResult {
  if (typeof text !== "string" || text.trim() === "") {
    return {
      ok: false,
      issues: [
        { code: "empty-document", message: "The observed document is empty." },
      ],
    };
  }
  if (text.length > MAX_OBSERVED_CHARS) {
    return {
      ok: false,
      issues: [
        {
          code: "too-large",
          message: "The observed document exceeds the size a lifecycle configuration can be.",
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      issues: [
        { code: "malformed-json", message: "The observed document is not valid JSON." },
      ],
    };
  }

  const obj = asRecord(parsed);
  if (!obj) {
    return {
      ok: false,
      issues: [
        {
          code: "not-an-object",
          message: "The observed document is not a lifecycle configuration object.",
        },
      ],
    };
  }

  // Prefer the S3 `Rules` array; fall back to the agnostic `rules` array.
  const s3Rules = Array.isArray(obj.Rules) ? obj.Rules : null;
  const agnosticRules = Array.isArray(obj.rules) ? obj.rules : null;
  const rawRules = s3Rules ?? agnosticRules;
  if (rawRules === null) {
    return {
      ok: false,
      issues: [
        {
          code: "no-rules",
          message: "The observed document contains no lifecycle rules to compare.",
        },
      ],
    };
  }
  if (rawRules.length > MAX_OBSERVED_RULES) {
    return {
      ok: false,
      issues: [
        {
          code: "too-large",
          message: "The observed document has more lifecycle rules than a bucket can hold.",
        },
      ],
    };
  }

  const recover = s3Rules ? fromS3Rule : fromAgnosticRule;
  const rules = rawRules
    .map(recover)
    .filter((r): r is ObservedLifecycleRule => r !== null);
  return { ok: true, observed: { rules } };
}

/**
 * The outcome of checking one expected backstop rule against the observed config:
 *  - `satisfied` — an enabled observed rule enforces exactly the expected day count;
 *  - `stricter`  — enforced, but *sooner* than expected: privacy is satisfied, though
 *    it may delete objects the app still treats as live (a caveat, not a failure);
 *  - `weaker`    — enforced *later* than expected: objects can outlive the privacy
 *    ceiling — the backstop does not actually hold;
 *  - `disabled`  — a matching rule exists but is `Status: Disabled`, so it enforces
 *    nothing;
 *  - `missing`   — no observed rule enforces this backstop at all.
 */
export type LifecycleCheckStatus =
  | "satisfied"
  | "stricter"
  | "weaker"
  | "disabled"
  | "missing";

/** One expected rule's verification result. References the app's own rule id only. */
export interface LifecycleRuleCheck {
  /** The app's fixed `pdfxyz-*` rule id (content-free). */
  readonly ruleId: string;
  readonly role: LifecycleRuleRole;
  readonly status: LifecycleCheckStatus;
  /** One-line, content-free explanation. Never echoes an observed value. */
  readonly message: string;
}

/** The reconciling action an operator would take for one rule. */
export type LifecyclePlanActionKind =
  | "none" // already enforced as generated
  | "create" // the rule is missing; apply it
  | "update" // a rule exists but is weaker/disabled; tighten/enable it
  | "review"; // enforced sooner than generated; confirm it is intended

export interface LifecyclePlanItem {
  readonly ruleId: string;
  readonly action: LifecyclePlanActionKind;
  readonly message: string;
}

/** The overall verification verdict. */
export type LifecycleVerdict =
  | "verified" // every generated backstop is enforced at least as strongly as generated
  | "drift"; // at least one backstop is missing, weaker, or disabled

/** The full, content-free verification of an expected policy vs an observed config. */
export interface LifecycleVerification {
  readonly verdict: LifecycleVerdict;
  readonly checks: LifecycleRuleCheck[];
  /** The reconciliation plan — one action per expected rule that needs attention. */
  readonly plan: LifecyclePlanItem[];
  /**
   * Count of enabled observed rules that governed no expected rule. Informational
   * only (an unrelated rule cannot weaken our backstop); reported as a COUNT so no
   * operator-authored rule id or prefix is ever echoed.
   */
  readonly unmatchedObservedRules: number;
  /** One-line, content-free summary of the verdict. */
  readonly summary: string;
}

/** True when `observedPrefix` covers `expectedPrefix` (a whole-bucket rule covers all). */
function covers(observedPrefix: string, expectedPrefix: string): boolean {
  return expectedPrefix.startsWith(observedPrefix);
}

/** The observed field a given expected role compares against, or `undefined`. */
function observedDaysForRole(
  rule: ObservedLifecycleRule,
  role: LifecycleRuleRole,
): number | undefined {
  switch (role) {
    case "input-expiration":
    case "artifact-expiration":
      return rule.expireAfterDays;
    case "abort-multipart-upload":
      return rule.abortIncompleteMultipartAfterDays;
    case "noncurrent-version-expiration":
      return rule.noncurrentVersionExpireAfterDays;
    case "expired-delete-marker":
      // A boolean rule: model "present" as 1 so the same coverage logic applies.
      return rule.expiredObjectDeleteMarker === true ? 1 : undefined;
  }
}

/**
 * Whether an observed rule governs an expected rule: it is a pure prefix/whole-bucket
 * rule (not `scoped` — a tag/size/multi-condition filter can never guarantee a prefix
 * backstop), its prefix covers the expected prefix, and it carries the field for the
 * expected role.
 */
function governs(
  observed: ObservedLifecycleRule,
  expected: LifecycleRule,
): boolean {
  return (
    observed.scoped !== true &&
    covers(observed.prefix, expected.prefix) &&
    observedDaysForRole(observed, expected.role) !== undefined
  );
}

/** The expected day count for a rule (whichever field its role uses), or 1 for markers. */
function expectedDaysForRule(rule: LifecycleRule): number {
  return (
    rule.expireAfterDays ??
    rule.abortIncompleteMultipartAfterDays ??
    rule.noncurrentVersionExpireAfterDays ??
    1 // expired-delete-marker: a boolean, modeled as "1" like the observed side
  );
}

/** Check one expected rule against every observed rule. */
function checkRule(
  expected: LifecycleRule,
  observed: ObservedLifecycle,
): LifecycleRuleCheck {
  const governing = observed.rules.filter((o) => governs(o, expected));
  const base = { ruleId: expected.id, role: expected.role };

  if (governing.length === 0) {
    return {
      ...base,
      status: "missing",
      message:
        "No observed rule enforces this backstop; the bucket does not guarantee deletion here.",
    };
  }

  const enabled = governing.filter((o) => o.enabled);
  if (enabled.length === 0) {
    return {
      ...base,
      status: "disabled",
      message:
        "A matching rule exists but is disabled, so it enforces nothing on the bucket.",
    };
  }

  // Several enabled rules can cover one prefix; S3 applies the earliest expiration,
  // so the effective deletion is the SHORTEST day count among them.
  const expectedDays = expectedDaysForRule(expected);
  const effectiveDays = Math.min(
    ...enabled.map((o) => observedDaysForRole(o, expected.role) ?? expectedDays),
  );

  if (effectiveDays === expectedDays) {
    return {
      ...base,
      status: "satisfied",
      message: "Enforced on the bucket exactly as generated.",
    };
  }
  if (effectiveDays < expectedDays) {
    return {
      ...base,
      status: "stricter",
      message:
        "Enforced sooner than the generated backstop — privacy is satisfied, but confirm it does not delete objects the app still treats as live.",
    };
  }
  return {
    ...base,
    status: "weaker",
    message:
      "Enforced later than the generated backstop — objects can outlive the privacy ceiling.",
  };
}

/** The reconciling plan item for one completed check. */
function planFor(check: LifecycleRuleCheck): LifecyclePlanItem {
  const base = { ruleId: check.ruleId };
  switch (check.status) {
    case "satisfied":
      return { ...base, action: "none", message: "In force; no change needed." };
    case "stricter":
      return {
        ...base,
        action: "review",
        message:
          "Deletes sooner than generated; confirm it does not remove objects still in use.",
      };
    case "missing":
      return {
        ...base,
        action: "create",
        message: "Apply the generated rule so this backstop exists on the bucket.",
      };
    case "weaker":
      return {
        ...base,
        action: "update",
        message: "Tighten the bucket rule to the generated day count so nothing outlives the ceiling.",
      };
    case "disabled":
      return {
        ...base,
        action: "update",
        message: "Enable the rule (and match the generated day count) so the backstop is in force.",
      };
  }
}

/** Verdict statuses that mean the backstop does not actually hold. */
const FAILING: ReadonlySet<LifecycleCheckStatus> = new Set([
  "missing",
  "weaker",
  "disabled",
]);

/**
 * Verify a generated {@link LifecyclePolicy} against an {@link ObservedLifecycle}.
 * Deterministic, pure, and content-free: the result references only the app's own
 * rule ids, a status/action enum, fixed prose, and a count of unrelated observed
 * rules. `verdict` is `drift` if any expected backstop is missing, weaker, or
 * disabled; `stricter` (deletes sooner) still verifies but is surfaced for review.
 */
export function verifyLifecyclePolicy(
  expected: LifecyclePolicy,
  observed: ObservedLifecycle,
): LifecycleVerification {
  const checks = expected.rules.map((rule) => checkRule(rule, observed));
  const plan = checks.map(planFor);
  const drifted = checks.filter((c) => FAILING.has(c.status)).length;

  // An observed rule is "unmatched" when, enabled, it governs no expected rule.
  const unmatchedObservedRules = observed.rules.filter(
    (o) => o.enabled && !expected.rules.some((rule) => governs(o, rule)),
  ).length;

  const verdict: LifecycleVerdict = drifted === 0 ? "verified" : "drift";
  const summary =
    verdict === "verified"
      ? "Verified: every generated backstop rule is enforced on the observed bucket configuration."
      : `Drift: ${drifted} generated backstop rule(s) are not enforced as generated; see the reconciliation plan.`;

  return { verdict, checks, plan, unmatchedObservedRules, summary };
}
