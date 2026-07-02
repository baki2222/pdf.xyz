// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MALWARE_SCANNER_ENV,
  MALWARE_SCAN_REQUIRED_ENV,
  resolveMalwareScanReadiness,
} from "./scanner";

describe("resolveMalwareScanReadiness", () => {
  it("is not-configured and inactive on an empty environment", () => {
    const r = resolveMalwareScanReadiness({});
    expect(r.active).toBe(false);
    expect(r.state).toBe("not-configured");
    expect(r.detail).toMatch(/not scanned|not configured/i);
  });

  it("is disabled and inactive when explicitly turned off", () => {
    const r = resolveMalwareScanReadiness({ [MALWARE_SCANNER_ENV]: "disabled" });
    expect(r.active).toBe(false);
    expect(r.state).toBe("disabled");
  });

  it("is ready and ACTIVE when a usable clamd endpoint is configured", () => {
    const r = resolveMalwareScanReadiness({
      [MALWARE_SCANNER_ENV]: "clamav://clamd.internal:3310",
    });
    expect(r.active).toBe(true);
    expect(r.state).toBe("ready");
  });

  it("is unavailable and inactive when selected but misconfigured", () => {
    const r = resolveMalwareScanReadiness({ [MALWARE_SCANNER_ENV]: "clamav://" });
    expect(r.active).toBe(false);
    expect(r.state).toBe("unavailable");
  });

  it("reflects whether scanning is required", () => {
    const r = resolveMalwareScanReadiness({
      [MALWARE_SCANNER_ENV]: "clamav://clamd.internal:3310",
      [MALWARE_SCAN_REQUIRED_ENV]: "true",
    });
    expect(r.required).toBe(true);
  });

  it("never leaks the declared value or a variable name", () => {
    const r = resolveMalwareScanReadiness({
      [MALWARE_SCANNER_ENV]: "clamav://scanner.internal:3310",
    });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("scanner.internal");
    expect(serialized).not.toContain("PDFXYZ_");
  });
});
