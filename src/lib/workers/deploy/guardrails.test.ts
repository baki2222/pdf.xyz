import { describe, expect, it } from "vitest";
import { evaluateGuardrails, GUARDRAIL_ENV } from "./guardrails";
import { MALWARE_SCANNER_ENV } from "./scanner";
import { LIFECYCLE_ENV, RETENTION_ENV } from "../lifecycle";
import { NATIVE_COMPRESSION_ENV } from "../compression/native-config";
import { NATIVE_OCR_ENV } from "../ocr-native-config";
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
      expect(violation.message).not.toMatch(
        /PDFXYZ_|secret|token|https?:\/\//i,
      );
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
      "queue_atomic_unsupported",
    ]);
    for (const violation of report.violations) {
      expect(violation.message).not.toMatch(
        /PDFXYZ_|secret|token|https?:\/\//i,
      );
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

  it("fails fast when atomic queue transitions are required but unavailable", () => {
    // Opt-in on its own (no strict), with no atomic-capable queue configured.
    const report = evaluateGuardrails(
      { [GUARDRAIL_ENV.requireAtomicQueue]: "true" },
      { engine: noDeepEngine },
    );
    expect(report.ok).toBe(false);
    expect(report.strict).toBe(true); // any require flag arms the report
    expect(report.violations.map((v) => v.code)).toEqual([
      "queue_atomic_unsupported",
    ]);
    expect(report.violations[0]!.fields).toEqual([REDIS_QUEUE_ENV.provider]);
    expect(report.violations[0]!.message).not.toMatch(
      /PDFXYZ_|secret|token|https?:\/\//i,
    );
  });

  it("passes the atomic requirement when a valid Redis queue is configured", () => {
    const report = evaluateGuardrails(
      {
        [GUARDRAIL_ENV.requireAtomicQueue]: "true",
        [REDIS_QUEUE_ENV.provider]: "redis",
        [REDIS_QUEUE_ENV.restUrl]: "https://redis.example.test",
        [REDIS_QUEUE_ENV.restToken]: "redis-rest-token",
      },
      { engine: noDeepEngine },
    );
    expect(report.violations.map((v) => v.code)).not.toContain(
      "queue_atomic_unsupported",
    );
  });

  it("fails fast when active malware scanning is required but not configured", () => {
    // Opt-in on its own (no strict): no scanner is configured, so the requirement is
    // unmet. Content-free message; the variable name is in `fields`.
    const report = evaluateGuardrails(
      { [GUARDRAIL_ENV.requireScan]: "true" },
      { engine: noDeepEngine },
    );
    expect(report.ok).toBe(false);
    expect(report.strict).toBe(true); // any require flag arms the report
    expect(report.violations.map((v) => v.code)).toEqual([
      "require_scan_unmet",
    ]);
    expect(report.violations[0]!.fields).toEqual([MALWARE_SCANNER_ENV]);
    expect(report.violations[0]!.message).not.toMatch(
      /PDFXYZ_|secret|token|https?:\/\//i,
    );
  });

  it("PASSES require-scan when a scanner is configured with a usable endpoint", () => {
    // Phase 22 ships an optional ClamAV backend: a configured endpoint IS active,
    // so the requirement is met (readiness is presence-only, like storage/queue).
    const report = evaluateGuardrails(
      {
        [GUARDRAIL_ENV.requireScan]: "true",
        [MALWARE_SCANNER_ENV]: "clamav://clamd.internal:3310",
      },
      { engine: noDeepEngine },
    );
    expect(report.violations.map((v) => v.code)).not.toContain(
      "require_scan_unmet",
    );
  });

  it("flags a selected-but-misconfigured scanner as an error (even without require)", () => {
    const report = evaluateGuardrails(
      { [MALWARE_SCANNER_ENV]: "clamav://" }, // no host → cannot connect
      { engine: noDeepEngine },
    );
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.code)).toContain(
      "scan_selected_but_invalid",
    );
    expect(report.violations[0]!.message).not.toMatch(/PDFXYZ_|clamav:\/\//i);
  });

  it("flags an unrecognized scanner value as an error", () => {
    const report = evaluateGuardrails(
      { [MALWARE_SCANNER_ENV]: "ftp://scanner" },
      { engine: noDeepEngine },
    );
    expect(report.violations.map((v) => v.code)).toEqual([
      "scan_provider_unrecognized",
    ]);
    expect(report.violations[0]!.fields).toEqual([MALWARE_SCANNER_ENV]);
  });

  it("does NOT arm require-scan under strict alone (scanning stays opt-in)", () => {
    // Strict enforces drainable/lifecycle/atomic, but must NOT demand scanning: a
    // lossless-only worker with no scanner is a legitimate production choice.
    const report = evaluateGuardrails(
      { [GUARDRAIL_ENV.strict]: "true" },
      { engine: noDeepEngine },
    );
    expect(report.violations.map((v) => v.code)).not.toContain(
      "require_scan_unmet",
    );
  });

  it("flags a malformed OCR configuration as an error, by field name only", () => {
    // An unknown enable token silently disables OCR; surface it (like compression).
    const report = evaluateGuardrails(
      { [NATIVE_OCR_ENV.enable]: "maybe-later" },
      { engine: noDeepEngine },
    );
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.code)).toContain(
      "ocr_config_invalid",
    );
    const violation = report.violations.find(
      (v) => v.code === "ocr_config_invalid",
    )!;
    expect(violation.fields).toEqual([NATIVE_OCR_ENV.enable]);
    expect(violation.message).not.toMatch(/PDFXYZ_|maybe-later/i);
  });

  it("keeps OCR clean and does NOT arm require-ocr under strict alone", () => {
    // OCR is optional: strict enforces drainable/lifecycle/atomic but must never
    // demand OCR, so a strict run with no OCR still passes the OCR requirement.
    const report = evaluateGuardrails(
      { [GUARDRAIL_ENV.strict]: "true" },
      { engine: noDeepEngine },
    );
    expect(report.violations.map((v) => v.code)).not.toContain(
      "require_ocr_unmet",
    );
    expect(report.violations.map((v) => v.code)).not.toContain(
      "ocr_config_invalid",
    );
  });

  it("fails fast when a ready OCR backend is required but the engine is not wired", () => {
    // Opt-in on its own. The runtime injects the wired processor's readiness; here it
    // is not ready, so the requirement is unmet. Content-free; variable in `fields`.
    const report = evaluateGuardrails(
      { [GUARDRAIL_ENV.requireOcr]: "true" },
      { engine: noDeepEngine, ocr: { ready: false } },
    );
    expect(report.ok).toBe(false);
    expect(report.strict).toBe(true); // any require flag arms the report
    expect(report.violations.map((v) => v.code)).toEqual(["require_ocr_unmet"]);
    expect(report.violations[0]!.fields).toEqual([NATIVE_OCR_ENV.enable]);
    expect(report.violations[0]!.message).not.toMatch(
      /PDFXYZ_|secret|token|https?:\/\//i,
    );
  });

  it("PASSES require-ocr when a real OCR engine + runner are wired (ready)", () => {
    const report = evaluateGuardrails(
      { [GUARDRAIL_ENV.requireOcr]: "true" },
      { engine: noDeepEngine, ocr: { ready: true } },
    );
    expect(report.violations.map((v) => v.code)).not.toContain(
      "require_ocr_unmet",
    );
  });

  it("falls back to config-enabled for require-ocr when the host can't be probed", () => {
    // With no injected OCR health, `PDFXYZ_OCR` enabled is the strongest signal —
    // enough to satisfy the requirement in a non-runtime evaluation context.
    const enabled = evaluateGuardrails(
      { [GUARDRAIL_ENV.requireOcr]: "true", [NATIVE_OCR_ENV.enable]: "on" },
      { engine: noDeepEngine },
    );
    expect(enabled.violations.map((v) => v.code)).not.toContain(
      "require_ocr_unmet",
    );

    const disabled = evaluateGuardrails(
      { [GUARDRAIL_ENV.requireOcr]: "true" },
      { engine: noDeepEngine },
    );
    expect(disabled.violations.map((v) => v.code)).toEqual([
      "require_ocr_unmet",
    ]);
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
