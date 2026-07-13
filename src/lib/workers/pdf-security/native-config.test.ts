import { describe, expect, it } from "vitest";
import {
  NATIVE_PDF_SECURITY_ENV,
  PDF_SECURITY_INPUT_BYTES_BOUNDS,
  nativePdfSecurityCapability,
  parseNativePdfSecurityConfig,
  resolveNativePdfSecurityConfig,
} from "./native-config";

describe("parseNativePdfSecurityConfig", () => {
  it("defaults to enabled + qpdf auto-detect with no env", () => {
    const parsed = parseNativePdfSecurityConfig({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.enabled).toBe(true);
    expect(parsed.config.binary).toBe("qpdf");
    expect(parsed.config.overridden).toBe(false);
    expect(parsed.config.maxInputBytes).toBe(PDF_SECURITY_INPUT_BYTES_BOUNDS.default);
  });

  it("honors the kill switch", () => {
    const parsed = parseNativePdfSecurityConfig({
      [NATIVE_PDF_SECURITY_ENV.enable]: "off",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config.enabled).toBe(false);
  });

  it("accepts a safe absolute binary override", () => {
    const parsed = parseNativePdfSecurityConfig({
      [NATIVE_PDF_SECURITY_ENV.qpdfBin]: "/usr/local/bin/qpdf",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.binary).toBe("/usr/local/bin/qpdf");
    expect(parsed.config.overridden).toBe(true);
  });

  it("rejects an unsafe binary override by NAME only (never the value)", () => {
    const parsed = parseNativePdfSecurityConfig({
      [NATIVE_PDF_SECURITY_ENV.qpdfBin]: "qpdf; rm -rf /",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0]?.field).toBe(NATIVE_PDF_SECURITY_ENV.qpdfBin);
    expect(JSON.stringify(parsed.issues)).not.toContain("rm -rf");
  });

  it("rejects an out-of-range timeout", () => {
    const parsed = parseNativePdfSecurityConfig({
      [NATIVE_PDF_SECURITY_ENV.timeoutMs]: "0",
    });
    expect(parsed.ok).toBe(false);
  });

  it("degrades to a safe disabled config on a malformed variable", () => {
    const config = resolveNativePdfSecurityConfig({
      [NATIVE_PDF_SECURITY_ENV.enable]: "maybe",
    });
    expect(config.enabled).toBe(false);
  });
});

describe("nativePdfSecurityCapability", () => {
  it("reports enabled with a client-safe detail (no path)", () => {
    const cap = nativePdfSecurityCapability({});
    expect(cap.enabled).toBe(true);
    expect(cap.detail).toMatch(/qpdf/i);
  });

  it("reports disabled when the kill switch is set", () => {
    const cap = nativePdfSecurityCapability({
      [NATIVE_PDF_SECURITY_ENV.enable]: "off",
    });
    expect(cap.enabled).toBe(false);
  });

  it("never leaks an override path", () => {
    const cap = nativePdfSecurityCapability({
      [NATIVE_PDF_SECURITY_ENV.qpdfBin]: "/opt/secret/qpdf",
    });
    expect(JSON.stringify(cap)).not.toContain("/opt/secret/qpdf");
  });
});
