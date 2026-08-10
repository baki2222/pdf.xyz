import { describe, expect, it } from "vitest";
import {
  buildLifecyclePolicy,
  LIFECYCLE_ENV,
  minutesToBackstopDays,
  parseLifecycleConfig,
  parseRetentionSettings,
  renderLifecyclePolicy,
  resolveLifecycleReadiness,
  RETENTION_ENV,
  validateLifecyclePolicy,
} from "./index";

describe("worker lifecycle policy", () => {
  it("rounds minute retention up to a day-granular backstop", () => {
    expect(minutesToBackstopDays(1)).toBe(1);
    expect(minutesToBackstopDays(60)).toBe(1);
    expect(minutesToBackstopDays(60 * 24 + 1)).toBe(2);
  });

  it("builds a safe non-versioned policy under structural prefixes only", () => {
    const retention = parseRetentionSettings({});
    expect(retention.ok).toBe(true);
    if (!retention.ok) return;

    const policy = buildLifecyclePolicy(retention.config, {
      keyPrefix: "pdfxyz",
    });
    expect(validateLifecyclePolicy(policy)).toEqual({ ok: true });
    expect(policy.rules.map((rule) => rule.prefix)).toEqual([
      "pdfxyz/inputs/",
      "pdfxyz/artifacts/",
      "pdfxyz/",
    ]);
    expect(JSON.stringify(policy.rules)).not.toMatch(
      /AKIA|secret-value|redis-rest-token|https?:\/\//i,
    );
  });

  it("renders an AWS S3 lifecycle document without bucket or credential values", () => {
    const retention = parseRetentionSettings({});
    expect(retention.ok).toBe(true);
    if (!retention.ok) return;

    const policy = buildLifecyclePolicy(retention.config, {
      keyPrefix: "pdfxyz",
      versioned: true,
    });
    const rendered = renderLifecyclePolicy(policy, "aws-s3");
    expect(rendered.provider).toBe("aws-s3");
    expect(rendered.applyHint).toContain("<bucket>");
    expect(rendered.document).toContain('"Prefix": "pdfxyz/inputs/"');
    expect(rendered.document).toContain("NoncurrentVersionExpiration");
    expect(`${rendered.applyHint}\n${rendered.document}`).not.toMatch(
      /AKIA|secret|token|pdfxyz-store|https?:\/\//i,
    );
  });

  it("parses lifecycle declarations as operator assertions only", () => {
    expect(resolveLifecycleReadiness({}).state).toBe("unknown");
    expect(
      resolveLifecycleReadiness({
        [LIFECYCLE_ENV.provider]: "aws-s3",
        [LIFECYCLE_ENV.validated]: "true",
        [LIFECYCLE_ENV.versioned]: "true",
      }),
    ).toMatchObject({
      state: "validated",
      provider: "aws-s3",
      versioned: true,
    });
  });

  it("rejects malformed provider flags and unsafe retention overrides", () => {
    const lifecycle = parseLifecycleConfig({ [LIFECYCLE_ENV.provider]: "ftp" });
    expect(lifecycle.ok).toBe(false);
    if (!lifecycle.ok) {
      expect(lifecycle.selected).toBe(true);
      expect(lifecycle.issues.map((issue) => issue.field)).toEqual([
        LIFECYCLE_ENV.provider,
      ]);
    }

    const retention = parseRetentionSettings({
      [RETENTION_ENV.artifactTtlMinutes]: "99999999",
    });
    expect(retention.ok).toBe(false);
    if (!retention.ok) {
      expect(retention.issues.map((issue) => issue.field)).toContain(
        RETENTION_ENV.artifactTtlMinutes,
      );
    }
  });
});
