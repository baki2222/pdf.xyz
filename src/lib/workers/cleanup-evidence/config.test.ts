// @vitest-environment node
/**
 * Config-resolution proofs for cleanup evidence monitoring (Phase 44): disabled by default, the
 * enable signal is a configured report path, and the freshness threshold is bounded to a sane
 * range. Pure env resolution — no file read, no secret value, no throw.
 */
import { describe, expect, it } from "vitest";
import {
  CLEANUP_EVIDENCE_ENV,
  DEFAULT_MAX_AGE_HOURS,
  MAX_MAX_AGE_HOURS,
  MIN_MAX_AGE_HOURS,
  resolveCleanupEvidenceConfig,
} from "./config";

const HOUR = 60 * 60 * 1000;

describe("resolveCleanupEvidenceConfig", () => {
  it("is disabled by default (no report paths configured)", () => {
    const c = resolveCleanupEvidenceConfig({});
    expect(c.enabled).toBe(false);
    expect(c.checkReportPath).toBeNull();
    expect(c.sweepReportPath).toBeNull();
    expect(c.maxAgeMs).toBe(DEFAULT_MAX_AGE_HOURS * HOUR);
  });

  it("is enabled when either report path is configured", () => {
    expect(resolveCleanupEvidenceConfig({ [CLEANUP_EVIDENCE_ENV.checkReport]: "/x/check.json" }).enabled).toBe(true);
    expect(resolveCleanupEvidenceConfig({ [CLEANUP_EVIDENCE_ENV.sweepReport]: "/x/sweep.json" }).enabled).toBe(true);
  });

  it("carries both paths when both are configured", () => {
    const c = resolveCleanupEvidenceConfig({
      [CLEANUP_EVIDENCE_ENV.checkReport]: "/x/check.json",
      [CLEANUP_EVIDENCE_ENV.sweepReport]: "/x/sweep.json",
    });
    expect(c.checkReportPath).toBe("/x/check.json");
    expect(c.sweepReportPath).toBe("/x/sweep.json");
  });

  it("treats a blank/whitespace path as unset", () => {
    const c = resolveCleanupEvidenceConfig({ [CLEANUP_EVIDENCE_ENV.checkReport]: "   " });
    expect(c.enabled).toBe(false);
    expect(c.checkReportPath).toBeNull();
  });

  it("parses and clamps the freshness threshold, defaulting on garbage", () => {
    expect(resolveCleanupEvidenceConfig({ [CLEANUP_EVIDENCE_ENV.maxAgeHours]: "12" }).maxAgeMs).toBe(12 * HOUR);
    // Out of range → clamped to the bounds.
    expect(resolveCleanupEvidenceConfig({ [CLEANUP_EVIDENCE_ENV.maxAgeHours]: "100000" }).maxAgeMs).toBe(MAX_MAX_AGE_HOURS * HOUR);
    expect(resolveCleanupEvidenceConfig({ [CLEANUP_EVIDENCE_ENV.maxAgeHours]: "0.1" }).maxAgeMs).toBe(MIN_MAX_AGE_HOURS * HOUR);
    // Non-numeric / negative / empty → the documented default.
    for (const bad of ["abc", "-5", "", "NaN"]) {
      expect(resolveCleanupEvidenceConfig({ [CLEANUP_EVIDENCE_ENV.maxAgeHours]: bad }).maxAgeMs).toBe(DEFAULT_MAX_AGE_HOURS * HOUR);
    }
  });
});
