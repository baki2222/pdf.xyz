// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_SETTINGS, type RetentionSettings } from "./retention";
import {
  LIFECYCLE_PREFIXES,
  MAX_BACKSTOP_DAYS,
  buildLifecyclePolicy,
  minutesToBackstopDays,
  validateLifecyclePolicy,
  type LifecyclePolicy,
} from "./policy";

describe("minutesToBackstopDays", () => {
  it("rounds a sub-day window up to a 1-day backstop", () => {
    expect(minutesToBackstopDays(60)).toBe(1); // 60-min default retention
    expect(minutesToBackstopDays(1)).toBe(1);
    expect(minutesToBackstopDays(1440)).toBe(1); // exactly one day
  });

  it("rounds up partial days and clamps to the privacy ceiling", () => {
    expect(minutesToBackstopDays(1441)).toBe(2);
    expect(minutesToBackstopDays(10_080)).toBe(MAX_BACKSTOP_DAYS); // 7 days
    expect(minutesToBackstopDays(999_999)).toBe(MAX_BACKSTOP_DAYS);
  });

  it("never returns below 1 day even for a zero window", () => {
    expect(minutesToBackstopDays(0)).toBe(1);
  });
});

describe("buildLifecyclePolicy — default (non-versioned)", () => {
  const policy = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS);

  it("emits the three backstop rules with day-granular expiration", () => {
    expect(policy.versioned).toBe(false);
    expect(policy.rules.map((r) => r.role)).toEqual([
      "input-expiration",
      "artifact-expiration",
      "abort-multipart-upload",
    ]);
    const input = policy.rules.find((r) => r.role === "input-expiration")!;
    expect(input.prefix).toBe(LIFECYCLE_PREFIXES.input);
    expect(input.expireAfterDays).toBe(1); // 60 min ⇒ 1-day backstop
    const abort = policy.rules.find((r) => r.role === "abort-multipart-upload")!;
    expect(abort.abortIncompleteMultipartAfterDays).toBe(1); // 24h ⇒ 1 day
  });

  it("records the retention window each backstop was derived from", () => {
    expect(policy.derivedFrom).toMatchObject({
      inputTtlMinutes: 60,
      artifactTtlMinutes: 60,
      inputBackstopDays: 1,
      artifactBackstopDays: 1,
    });
  });

  it("explains the backstop-not-primary honesty in its notes", () => {
    expect(policy.notes.join(" ")).toMatch(/backstop, not the primary/i);
    expect(policy.notes.join(" ")).toMatch(/non-versioned/i);
  });

  it("validates cleanly", () => {
    expect(validateLifecyclePolicy(policy)).toEqual({ ok: true });
  });
});

describe("buildLifecyclePolicy — versioned + key prefix", () => {
  it("adds the noncurrent-version and delete-marker rules under the prefix", () => {
    const policy = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS, {
      versioned: true,
      keyPrefix: "team/pdfxyz",
    });
    expect(policy.rules.map((r) => r.role)).toContain("noncurrent-version-expiration");
    expect(policy.rules.map((r) => r.role)).toContain("expired-delete-marker");
    const input = policy.rules.find((r) => r.role === "input-expiration")!;
    expect(input.prefix).toBe(`team/pdfxyz/${LIFECYCLE_PREFIXES.input}`);
    expect(validateLifecyclePolicy(policy)).toEqual({ ok: true });
  });
});

describe("buildLifecyclePolicy — longer retention", () => {
  it("derives a larger backstop from a multi-day window", () => {
    const retention: RetentionSettings = {
      inputTtlMinutes: 2_880, // 2 days
      artifactTtlMinutes: 4_320, // 3 days
      multipartAbortHours: 48,
      noncurrentVersionDays: 3,
    };
    const policy = buildLifecyclePolicy(retention);
    expect(policy.derivedFrom.inputBackstopDays).toBe(2);
    expect(policy.derivedFrom.artifactBackstopDays).toBe(3);
    expect(policy.derivedFrom.multipartAbortDays).toBe(2);
    expect(validateLifecyclePolicy(policy)).toEqual({ ok: true });
  });
});

describe("validateLifecyclePolicy — rejects broken policies", () => {
  const base = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS);

  it("flags an empty policy", () => {
    const result = validateLifecyclePolicy({ ...base, rules: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("no-rules");
  });

  it("flags an object-expiration rule with an empty prefix", () => {
    const broken: LifecyclePolicy = {
      ...base,
      rules: base.rules.map((r) =>
        r.role === "input-expiration" ? { ...r, prefix: "" } : r,
      ),
    };
    const result = validateLifecyclePolicy(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("empty-prefix");
  });

  it("flags an unsafe (traversal) prefix", () => {
    const broken: LifecyclePolicy = {
      ...base,
      rules: base.rules.map((r) =>
        r.role === "artifact-expiration" ? { ...r, prefix: "../evil/" } : r,
      ),
    };
    const result = validateLifecyclePolicy(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("unsafe-prefix");
  });

  it("flags an out-of-bounds day count", () => {
    const broken: LifecyclePolicy = {
      ...base,
      rules: base.rules.map((r) =>
        r.role === "input-expiration" ? { ...r, expireAfterDays: 99 } : r,
      ),
    };
    const result = validateLifecyclePolicy(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("days-out-of-bounds");
  });

  it("flags a backstop shorter than the retention window it must outlast", () => {
    // Derived-from says a 3-day window but the rule expires after 1 day.
    const broken: LifecyclePolicy = {
      ...base,
      derivedFrom: { ...base.derivedFrom, inputTtlMinutes: 4_320 },
    };
    const result = validateLifecyclePolicy(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("backstop-below-retention");
  });

  it("flags duplicate rule ids", () => {
    const dup = base.rules[0]!;
    const result = validateLifecyclePolicy({ ...base, rules: [...base.rules, dup] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("duplicate-rule-id");
  });
});

describe("buildLifecyclePolicy — content-free", () => {
  it("never contains a bucket, endpoint, credential, or opaque id", () => {
    const policy = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS, {
      versioned: true,
      keyPrefix: "team",
    });
    const serialized = JSON.stringify(policy);
    // Only structural prefixes, day counts, ids, and prose — no infra identifiers.
    for (const leak of ["amazonaws", "http", "AKIA", "secret", "token", "bucket-"]) {
      expect(serialized.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});
