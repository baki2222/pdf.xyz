import { describe, expect, it } from "vitest";
import { JOB_LIMITS } from "@/lib/jobs";
import {
  DEFAULT_INTAKE_POLICY,
  INTAKE_BOUNDS,
  UPLOAD_INTAKE_ENV,
  resolveIntakePolicy,
} from "./policy";

describe("DEFAULT_INTAKE_POLICY", () => {
  it("mirrors the contract limits so the two can never drift", () => {
    expect(DEFAULT_INTAKE_POLICY.maxFileBytes).toBe(JOB_LIMITS.maxFileBytes);
    expect(DEFAULT_INTAKE_POLICY.maxRequestBytes).toBe(JOB_LIMITS.maxTotalBytes);
    expect(DEFAULT_INTAKE_POLICY.maxFiles).toBe(JOB_LIMITS.maxInputFiles);
    expect(DEFAULT_INTAKE_POLICY.maxFilenameLength).toBe(
      JOB_LIMITS.maxFilenameLength,
    );
  });

  it("keeps structural byte checks off by default", () => {
    expect(DEFAULT_INTAKE_POLICY.requirePdfMagic).toBe(false);
    expect(DEFAULT_INTAKE_POLICY.requirePdfEof).toBe(false);
  });

  it("is frozen so a caller cannot mutate the shared default", () => {
    expect(Object.isFrozen(DEFAULT_INTAKE_POLICY)).toBe(true);
  });
});

describe("resolveIntakePolicy — defaults", () => {
  it("an empty environment resolves to the default policy", () => {
    expect(resolveIntakePolicy({})).toEqual(DEFAULT_INTAKE_POLICY);
  });
});

describe("resolveIntakePolicy — overrides", () => {
  it("accepts in-range integer overrides", () => {
    const policy = resolveIntakePolicy({
      [UPLOAD_INTAKE_ENV.maxFileBytes]: "1048576",
      [UPLOAD_INTAKE_ENV.maxRequestBytes]: "2097152",
      [UPLOAD_INTAKE_ENV.maxFiles]: "5",
      [UPLOAD_INTAKE_ENV.maxFilenameLength]: "80",
    });
    expect(policy.maxFileBytes).toBe(1_048_576);
    expect(policy.maxRequestBytes).toBe(2_097_152);
    expect(policy.maxFiles).toBe(5);
    expect(policy.maxFilenameLength).toBe(80);
  });

  it("treats the opt-in PDF knobs as booleans", () => {
    const on = resolveIntakePolicy({
      [UPLOAD_INTAKE_ENV.requirePdfMagic]: "1",
      [UPLOAD_INTAKE_ENV.requirePdfEof]: "true",
    });
    expect(on.requirePdfMagic).toBe(true);
    expect(on.requirePdfEof).toBe(true);

    const off = resolveIntakePolicy({
      [UPLOAD_INTAKE_ENV.requirePdfMagic]: "0",
      [UPLOAD_INTAKE_ENV.requirePdfEof]: "no",
    });
    expect(off.requirePdfMagic).toBe(false);
    expect(off.requirePdfEof).toBe(false);
  });

  it("accepts custom scan windows within bounds", () => {
    const policy = resolveIntakePolicy({
      [UPLOAD_INTAKE_ENV.pdfHeaderScanBytes]: "2048",
      [UPLOAD_INTAKE_ENV.pdfTrailerScanBytes]: "4096",
    });
    expect(policy.pdfHeaderScanBytes).toBe(2048);
    expect(policy.pdfTrailerScanBytes).toBe(4096);
  });
});

describe("resolveIntakePolicy — strict, fail-safe parsing", () => {
  it.each([
    ["not-a-number", "abc"],
    ["float", "12.5"],
    ["scientific", "1e9"],
    ["hex", "0x10"],
    ["negative", "-5"],
    ["zero (below min)", "0"],
    ["trailing unit", "100mb"],
    ["blank", "   "],
    ["over the ceiling", String(INTAKE_BOUNDS.maxFileBytes.max + 1)],
  ])("falls back to the default for %s", (_label, value) => {
    const policy = resolveIntakePolicy({
      [UPLOAD_INTAKE_ENV.maxFileBytes]: value,
    });
    expect(policy.maxFileBytes).toBe(DEFAULT_INTAKE_POLICY.maxFileBytes);
  });

  it("one bad knob never disturbs the others", () => {
    const policy = resolveIntakePolicy({
      [UPLOAD_INTAKE_ENV.maxFileBytes]: "garbage",
      [UPLOAD_INTAKE_ENV.maxFiles]: "3",
    });
    expect(policy.maxFileBytes).toBe(DEFAULT_INTAKE_POLICY.maxFileBytes);
    expect(policy.maxFiles).toBe(3);
  });

  it("clamps an out-of-range file count to the default, not the ceiling", () => {
    const policy = resolveIntakePolicy({
      [UPLOAD_INTAKE_ENV.maxFiles]: String(INTAKE_BOUNDS.maxFiles.max + 1),
    });
    expect(policy.maxFiles).toBe(DEFAULT_INTAKE_POLICY.maxFiles);
  });

  it("rejects a scan window below the signature length", () => {
    const policy = resolveIntakePolicy({
      [UPLOAD_INTAKE_ENV.pdfHeaderScanBytes]: "4",
    });
    expect(policy.pdfHeaderScanBytes).toBe(
      DEFAULT_INTAKE_POLICY.pdfHeaderScanBytes,
    );
  });
});
