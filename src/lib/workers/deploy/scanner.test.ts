// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MALWARE_SCANNER_ENV, resolveMalwareScanReadiness } from "./scanner";

describe("resolveMalwareScanReadiness", () => {
  it("is not-configured and never active on an empty environment", () => {
    const r = resolveMalwareScanReadiness({});
    expect(r.active).toBe(false);
    expect(r.state).toBe("not-configured");
    expect(r.detail).toMatch(/not scanned/i);
  });

  it("is declared-not-implemented — and STILL not active — when a scanner is set", () => {
    const r = resolveMalwareScanReadiness({
      [MALWARE_SCANNER_ENV]: "clamav://scanner.internal",
    });
    // The critical honesty invariant: declaring a scanner does not make one exist.
    expect(r.active).toBe(false);
    expect(r.state).toBe("declared-not-implemented");
    expect(r.detail).toMatch(/not scanned|no scanner runner/i);
  });

  it("never leaks the declared value or a variable name", () => {
    const r = resolveMalwareScanReadiness({
      [MALWARE_SCANNER_ENV]: "clamav://scanner.internal",
    });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("scanner.internal");
    expect(serialized).not.toContain("PDFXYZ_");
    // Every mention of scanning is an explicit negative — active is false.
    expect(r.active).toBe(false);
    expect(r.detail).toMatch(/\bnot\b/i);
  });
});
