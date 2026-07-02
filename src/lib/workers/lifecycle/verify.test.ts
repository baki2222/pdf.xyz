// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_SETTINGS, type RetentionSettings } from "./retention";
import { buildLifecyclePolicy } from "./policy";
import { renderLifecyclePolicy } from "./render";
import {
  parseObservedLifecycle,
  verifyLifecyclePolicy,
  type ObservedLifecycle,
} from "./verify";

/** The default non-versioned expected policy most tests verify against. */
const expected = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS);
/** A versioned expected policy, to exercise the noncurrent/delete-marker rules. */
const expectedVersioned = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS, {
  versioned: true,
});

/** Parse an observed document, asserting success, and return it. */
function observe(text: string): ObservedLifecycle {
  const parsed = parseObservedLifecycle(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("expected a parseable observed document");
  return parsed.observed;
}

// ─────────────────────────── parseObservedLifecycle ───────────────────────────

describe("parseObservedLifecycle — shapes", () => {
  it("parses the S3 `Rules` shape, recovering prefix/days/status", () => {
    const observed = observe(
      JSON.stringify({
        Rules: [
          {
            ID: "anything-the-operator-named-it",
            Filter: { Prefix: "inputs/" },
            Status: "Enabled",
            Expiration: { Days: 1 },
          },
          {
            ID: "abort",
            Filter: { Prefix: "" },
            Status: "Enabled",
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      }),
    );
    expect(observed.rules).toEqual([
      { enabled: true, prefix: "inputs/", expireAfterDays: 1 },
      { enabled: true, prefix: "", abortIncompleteMultipartAfterDays: 1 },
    ]);
  });

  it("recovers a legacy top-level Prefix and a disabled status", () => {
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "x", Prefix: "artifacts/", Status: "Disabled", Expiration: { Days: 2 } },
        ],
      }),
    );
    expect(observed.rules[0]).toEqual({
      enabled: false,
      prefix: "artifacts/",
      expireAfterDays: 2,
    });
  });

  it("parses the provider-agnostic `rules` shape (implicitly enabled)", () => {
    const generic = renderLifecyclePolicy(expectedVersioned, "generic");
    const observed = observe(generic.document);
    // The agnostic model has no status; every recovered rule is treated as enabled.
    expect(observed.rules.every((r) => r.enabled)).toBe(true);
    expect(observed.rules.find((r) => r.prefix === "inputs/")?.expireAfterDays).toBe(1);
    expect(
      observed.rules.some((r) => r.expiredObjectDeleteMarker === true),
    ).toBe(true);
  });

  it("recovers the delete-marker and noncurrent rules from an S3 document", () => {
    const observed = observe(renderLifecyclePolicy(expectedVersioned, "aws-s3").document);
    expect(
      observed.rules.some((r) => r.noncurrentVersionExpireAfterDays === 1),
    ).toBe(true);
    expect(
      observed.rules.some((r) => r.expiredObjectDeleteMarker === true),
    ).toBe(true);
  });

  it("ignores unknown fields and non-integer day values defensively", () => {
    const observed = observe(
      JSON.stringify({
        Rules: [
          {
            ID: "junk",
            Filter: { Prefix: "inputs/" },
            Status: "Enabled",
            Expiration: { Days: "soon" }, // not a number → dropped
            SomethingElse: { nested: true },
          },
        ],
      }),
    );
    expect(observed.rules[0]).toEqual({ enabled: true, prefix: "inputs/" });
  });
});

describe("parseObservedLifecycle — rejects bad documents", () => {
  it("rejects empty, malformed, non-object, and rule-less documents", () => {
    for (const [text, code] of [
      ["", "empty-document"],
      ["   ", "empty-document"],
      ["{not json", "malformed-json"],
      ["[1,2,3]", "not-an-object"],
      ['"a string"', "not-an-object"],
      ["{}", "no-rules"],
      ['{"Rules": {}}', "no-rules"],
    ] as const) {
      const parsed = parseObservedLifecycle(text);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.map((i) => i.code)).toContain(code);
    }
  });

  it("rejects an oversized document and an oversized rule count", () => {
    // Over the char cap: size is checked before JSON.parse, so this short-circuits.
    const huge = parseObservedLifecycle("x".repeat(300_000));
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.issues[0]?.code).toBe("too-large");

    const tooMany = parseObservedLifecycle(
      JSON.stringify({ Rules: new Array(1_001).fill({ ID: "x", Status: "Enabled" }) }),
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.issues[0]?.code).toBe("too-large");
  });
});

// ─────────────────────────── verifyLifecyclePolicy ───────────────────────────

describe("verifyLifecyclePolicy — round-trip is verified", () => {
  it("verifies the app's own rendered policy against itself for every S3 provider", () => {
    for (const provider of ["aws-s3", "minio", "cloudflare-r2"] as const) {
      const rendered = renderLifecyclePolicy(expected, provider);
      const result = verifyLifecyclePolicy(expected, observe(rendered.document));
      expect(result.verdict).toBe("verified");
      expect(result.checks.every((c) => c.status === "satisfied")).toBe(true);
      expect(result.plan.every((p) => p.action === "none")).toBe(true);
    }
  });

  it("verifies a versioned policy against its own rendered document", () => {
    const rendered = renderLifecyclePolicy(expectedVersioned, "aws-s3");
    const result = verifyLifecyclePolicy(expectedVersioned, observe(rendered.document));
    expect(result.verdict).toBe("verified");
    expect(result.checks).toHaveLength(expectedVersioned.rules.length);
  });

  it("verifies against operator-named rules and a whole-bucket expiration", () => {
    // Different rule ids, and one whole-bucket rule covering both object prefixes.
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "expire-everything", Filter: { Prefix: "" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "kill-stalled-parts", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(expected, observed);
    expect(result.verdict).toBe("verified");
  });

  it("counts an unrelated enabled rule as unmatched without failing", () => {
    const observed = observe(
      JSON.stringify({
        Rules: [
          ...JSON.parse(renderLifecyclePolicy(expected, "aws-s3").document).Rules,
          { ID: "app-logs", Filter: { Prefix: "logs/" }, Status: "Enabled", Expiration: { Days: 30 } },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(expected, observed);
    expect(result.verdict).toBe("verified");
    expect(result.unmatchedObservedRules).toBe(1);
  });
});

describe("verifyLifecyclePolicy — detects drift", () => {
  it("flags a missing backstop rule as drift with a create action", () => {
    // Only the input rule is present; artifact + multipart backstops are absent.
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "in", Filter: { Prefix: "inputs/" }, Status: "Enabled", Expiration: { Days: 1 } },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(expected, observed);
    expect(result.verdict).toBe("drift");
    const artifact = result.checks.find((c) => c.role === "artifact-expiration");
    expect(artifact?.status).toBe("missing");
    expect(result.plan.find((p) => p.ruleId === artifact?.ruleId)?.action).toBe("create");
  });

  it("flags a weaker (longer) expiration as drift — objects outlive the ceiling", () => {
    const longRetention: RetentionSettings = {
      ...DEFAULT_RETENTION_SETTINGS,
      inputTtlMinutes: 60,
    };
    const exp = buildLifecyclePolicy(longRetention); // 1-day input backstop
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "in", Filter: { Prefix: "inputs/" }, Status: "Enabled", Expiration: { Days: 30 } },
          { ID: "art", Filter: { Prefix: "artifacts/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "mp", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(exp, observed);
    expect(result.verdict).toBe("drift");
    const input = result.checks.find((c) => c.role === "input-expiration");
    expect(input?.status).toBe("weaker");
    expect(result.plan.find((p) => p.ruleId === input?.ruleId)?.action).toBe("update");
  });

  it("flags a disabled matching rule as drift with an update action", () => {
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "in", Filter: { Prefix: "inputs/" }, Status: "Disabled", Expiration: { Days: 1 } },
          { ID: "art", Filter: { Prefix: "artifacts/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "mp", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(expected, observed);
    expect(result.verdict).toBe("drift");
    expect(
      result.checks.find((c) => c.role === "input-expiration")?.status,
    ).toBe("disabled");
  });

  it("treats a stricter (sooner) expiration as verified but flags it for review", () => {
    // A 2-day generated backstop, but the bucket deletes inputs after 1 day.
    const twoDay = buildLifecyclePolicy({
      ...DEFAULT_RETENTION_SETTINGS,
      inputTtlMinutes: 2_880, // 2 days
    });
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "in", Filter: { Prefix: "inputs/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "art", Filter: { Prefix: "artifacts/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "mp", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(twoDay, observed);
    expect(result.verdict).toBe("verified"); // privacy ceiling still honored
    const input = result.checks.find((c) => c.role === "input-expiration");
    expect(input?.status).toBe("stricter");
    expect(result.plan.find((p) => p.ruleId === input?.ruleId)?.action).toBe("review");
  });

  it("applies the shortest of several covering rules (earliest expiration wins)", () => {
    // A whole-bucket 30-day rule AND a specific 1-day inputs rule: the bucket deletes
    // inputs after 1 day, so the effective enforcement satisfies the 1-day backstop.
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "wide", Filter: { Prefix: "" }, Status: "Enabled", Expiration: { Days: 30 } },
          { ID: "in", Filter: { Prefix: "inputs/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "art", Filter: { Prefix: "artifacts/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "mp", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(expected, observed);
    expect(result.checks.find((c) => c.role === "input-expiration")?.status).toBe(
      "satisfied",
    );
  });
});

describe("verifyLifecyclePolicy — scoped filters fail safe (no false pass)", () => {
  it("does NOT let a tag/size-scoped rule satisfy a prefix backstop", () => {
    // A tag-scoped rule under inputs/ (Filter.And) only deletes the TAGGED subset, so
    // it must not be credited toward the input backstop. It also carries no top-level
    // Filter.Prefix — the exact shape that a naive parser widens to whole-bucket.
    const observed = observe(
      JSON.stringify({
        Rules: [
          {
            ID: "expire-tagged-inputs",
            Filter: { And: { Prefix: "inputs/", Tags: [{ Key: "tmp", Value: "1" }] } },
            Status: "Enabled",
            Expiration: { Days: 1 },
          },
          {
            ID: "abort",
            Filter: { Prefix: "" },
            Status: "Enabled",
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      }),
    );
    // The scoped rule is recovered but flagged, so it governs nothing.
    expect(observed.rules[0]).toMatchObject({ scoped: true });
    const result = verifyLifecyclePolicy(expected, observed);
    expect(result.verdict).toBe("drift");
    expect(
      result.checks.find((c) => c.role === "input-expiration")?.status,
    ).toBe("missing");
    // A scoped rule that governs nothing is still surfaced as unmatched, not hidden.
    expect(result.unmatchedObservedRules).toBe(1);
  });

  it("does NOT let a whole-bucket rule masked behind a tag rule hide a weakness", () => {
    // A genuine whole-bucket 30-day rule + a tag-scoped 1-day rule: the tag rule must
    // NOT pull the effective expiration down to 1 day, so the 30-day exposure shows.
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "wide", Filter: { Prefix: "" }, Status: "Enabled", Expiration: { Days: 30 } },
          {
            ID: "tagged-fast",
            Filter: { And: { Prefix: "inputs/", Tags: [{ Key: "x", Value: "y" }] } },
            Status: "Enabled",
            Expiration: { Days: 1 },
          },
          { ID: "art", Filter: { Prefix: "artifacts/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "mp", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(expected, observed);
    expect(result.verdict).toBe("drift");
    // Inputs are only covered by the 30-day whole-bucket rule ⇒ weaker, not satisfied.
    expect(
      result.checks.find((c) => c.role === "input-expiration")?.status,
    ).toBe("weaker");
  });

  it("treats a malformed (non-object) filter as scoped, not whole-bucket", () => {
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "weird", Filter: "inputs/", Status: "Enabled", Expiration: { Days: 1 } },
        ],
      }),
    );
    expect(observed.rules[0]).toMatchObject({ scoped: true });
    // It governs nothing, so the object backstops are missing → drift (never a pass).
    expect(verifyLifecyclePolicy(expected, observed).verdict).toBe("drift");
  });

  it("still credits a genuine whole-bucket (empty-filter) rule", () => {
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "everything", Filter: {}, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "mp", Filter: {}, Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
        ],
      }),
    );
    expect(observed.rules.every((r) => r.scoped !== true)).toBe(true);
    const result = verifyLifecyclePolicy(expected, observed);
    expect(result.verdict).toBe("verified");
  });

  it("does NOT let a version-RETAINING noncurrent rule satisfy the versioned backstop", () => {
    // NewerNoncurrentVersions ≥ 1 keeps the N newest noncurrent versions, so it is not
    // a clean noncurrent-expiration backstop and must read as drift.
    const observed = observe(
      JSON.stringify({
        Rules: [
          { ID: "in", Filter: { Prefix: "inputs/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "art", Filter: { Prefix: "artifacts/" }, Status: "Enabled", Expiration: { Days: 1 } },
          { ID: "mp", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
          { ID: "dm", Status: "Enabled", Expiration: { ExpiredObjectDeleteMarker: true } },
          {
            ID: "keep-5-versions",
            Status: "Enabled",
            NoncurrentVersionExpiration: { NoncurrentDays: 1, NewerNoncurrentVersions: 5 },
          },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(expectedVersioned, observed);
    expect(result.verdict).toBe("drift");
    expect(
      result.checks.find((c) => c.role === "noncurrent-version-expiration")?.status,
    ).toBe("missing");
  });
});

describe("verifyLifecyclePolicy — content-free", () => {
  it("never echoes an observed rule id, prefix, or value into the report", () => {
    const observed = observe(
      JSON.stringify({
        Rules: [
          {
            ID: "secret-bucket-prod-rule",
            Filter: { Prefix: "customer-data/" },
            Status: "Enabled",
            Expiration: { Days: 42 },
          },
        ],
      }),
    );
    const result = verifyLifecyclePolicy(expected, observed);
    const serialized = JSON.stringify(result);
    for (const leak of ["secret-bucket-prod-rule", "customer-data", "42"]) {
      expect(serialized).not.toContain(leak);
    }
    // Only the app's own fixed rule ids appear.
    for (const check of result.checks) {
      expect(check.ruleId).toMatch(/^pdfxyz-/);
    }
  });
});
