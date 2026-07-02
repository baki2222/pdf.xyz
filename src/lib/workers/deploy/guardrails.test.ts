import { describe, expect, it } from "vitest";
import { evaluateGuardrails, GUARDRAIL_ENV } from "./guardrails";
import { LIFECYCLE_ENV, RETENTION_ENV } from "../lifecycle";
import { NATIVE_COMPRESSION_ENV } from "../compression/native-config";
import { REDIS_QUEUE_ENV } from "../queue/redis-config";
import { S3_ENV } from "../storage/s3-config";

const noDeepEngine = { lossless: true, deep: false, engines: [] };

describe("worker deployment guardrails", () => {
  it("keeps a bare development environment clean by default", () => {
    expect(evaluateGuardrails({}, { engine: noDeepEngine })).toEqual({
      ok: true,
      strict: false,
      violations: [],
    });
  });

  it("surfaces selected-but-incomplete providers as errors", () => {
    const report = evaluateGuardrails(
      {
        [S3_ENV.provider]: "s3",
        [REDIS_QUEUE_ENV.provider]: "redis",
      },
      { engine: noDeepEngine },
    );
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.code)).toEqual([
      "storage_selected_but_invalid",
      "queue_selected_but_invalid",
    ]);
    for (const violation of report.violations) {
      expect(violation.message).not.toMatch(/PDFXYZ_|secret|token|https?:\/\//i);
    }
  });

  it("escalates strict production requirements without leaking values", () => {
    const report = evaluateGuardrails(
      {
        [GUARDRAIL_ENV.strict]: "true",
        [NATIVE_COMPRESSION_ENV.enable]: "true",
      },
      { engine: noDeepEngine },
    );
    expect(report.ok).toBe(false);
    expect(report.strict).toBe(true);
    expect(report.violations.map((v) => v.code)).toEqual([
      "deep_compression_without_engine",
      "require_drainable_unmet",
      "require_lifecycle_unmet",
    ]);
    for (const violation of report.violations) {
      expect(violation.message).not.toMatch(/PDFXYZ_|secret|token|https?:\/\//i);
    }
  });

  it("accepts a drainable config with a validated lifecycle declaration", () => {
    const report = evaluateGuardrails(
      {
        [GUARDRAIL_ENV.strict]: "true",
        [S3_ENV.provider]: "s3",
        [S3_ENV.endpoint]: "https://s3.example.test",
        [S3_ENV.region]: "auto",
        [S3_ENV.bucket]: "pdfxyz-store",
        [S3_ENV.accessKeyId]: "AKIAEXAMPLE123",
        [S3_ENV.secretAccessKey]: "s3-secret-value-1234567890",
        [REDIS_QUEUE_ENV.provider]: "redis",
        [REDIS_QUEUE_ENV.restUrl]: "https://redis.example.test",
        [REDIS_QUEUE_ENV.restToken]: "redis-rest-token",
        [LIFECYCLE_ENV.provider]: "aws-s3",
        [LIFECYCLE_ENV.validated]: "true",
      },
      { engine: { lossless: true, deep: true, engines: ["ghostscript"] } },
    );
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("rejects malformed lifecycle and retention settings by field names only", () => {
    const report = evaluateGuardrails(
      {
        [LIFECYCLE_ENV.provider]: "ftp",
        [RETENTION_ENV.inputTtlMinutes]: "0",
      },
      { engine: noDeepEngine },
    );
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.code)).toEqual([
      "lifecycle_config_invalid",
      "retention_out_of_bounds",
    ]);
    expect(report.violations.flatMap((v) => v.fields ?? [])).toEqual([
      LIFECYCLE_ENV.provider,
      RETENTION_ENV.inputTtlMinutes,
    ]);
  });
});
