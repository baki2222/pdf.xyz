// @vitest-environment node
/**
 * Config parsing + provider selection + presence-only readiness. The invariants:
 * an optional ClamAV backend is recognized and bounded when configured; a
 * misconfigured or unrecognized selection is honestly `unavailable` (never silently
 * "ready"); nothing an operator sets ever leaks the endpoint value or a variable
 * name into the readiness; and the shipped no-op never claims a scan happened.
 */
import { describe, expect, it } from "vitest";
import { JOB_LIMITS } from "@/lib/jobs";
import {
  CLAMAV_ENV,
  CLAMAV_MAX_BYTES_DEFAULT,
  CLAMAV_TIMEOUT_MS_DEFAULT,
  MALWARE_SCANNER_ENV,
  MALWARE_SCAN_REQUIRED_ENV,
  parseClamavConfig,
  resolveScannerReadiness,
  scannerProviderToken,
} from "./config";
import { createMalwareScanner } from "./index";
import { fakeScanner } from "./fake";
import { scanInfected, type MalwareScanInput } from "./types";

const empty: MalwareScanInput = { tool: "t", inputs: [] };

describe("scannerProviderToken", () => {
  it("classifies the declared value", () => {
    expect(scannerProviderToken({})).toBe("unset");
    expect(scannerProviderToken({ [MALWARE_SCANNER_ENV]: "  " })).toBe("unset");
    expect(scannerProviderToken({ [MALWARE_SCANNER_ENV]: "disabled" })).toBe("disabled");
    expect(scannerProviderToken({ [MALWARE_SCANNER_ENV]: "OFF" })).toBe("disabled");
    expect(scannerProviderToken({ [MALWARE_SCANNER_ENV]: "clamav://h:3310" })).toBe("clamav");
    expect(scannerProviderToken({ [MALWARE_SCANNER_ENV]: "clamav+unix:///s.ctl" })).toBe("clamav");
    expect(scannerProviderToken({ [MALWARE_SCANNER_ENV]: "http://x" })).toBe("unrecognized");
    expect(scannerProviderToken({ [MALWARE_SCANNER_ENV]: "yes-please" })).toBe("unrecognized");
  });
});

describe("parseClamavConfig", () => {
  it("parses a TCP endpoint with an explicit port and default knobs", () => {
    const r = parseClamavConfig({ [MALWARE_SCANNER_ENV]: "clamav://clamd.host:3311" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.endpoint).toEqual({ host: "clamd.host", port: 3311 });
      expect(r.config.timeoutMs).toBe(CLAMAV_TIMEOUT_MS_DEFAULT);
      expect(r.config.maxBytes).toBe(CLAMAV_MAX_BYTES_DEFAULT);
      // The scanned ceiling and the accepted ceiling are the same number from
      // one constant (owner ruling, 2026-08-10): a band between them is where
      // files were processed unscanned under copy that said otherwise.
      expect(CLAMAV_MAX_BYTES_DEFAULT).toBe(JOB_LIMITS.maxFileBytes);
    }
  });

  it("defaults the port to 3310 and parses a unix socket + bracketed IPv6", () => {
    const tcp = parseClamavConfig({ [MALWARE_SCANNER_ENV]: "clamav://clamd" });
    expect(tcp.ok && tcp.config.endpoint).toEqual({ host: "clamd", port: 3310 });
    const sock = parseClamavConfig({ [MALWARE_SCANNER_ENV]: "clamav+unix:///run/clamd.sock" });
    expect(sock.ok && sock.config.endpoint).toEqual({ socketPath: "/run/clamd.sock" });
    const v6 = parseClamavConfig({ [MALWARE_SCANNER_ENV]: "clamav://[::1]:3310" });
    expect(v6.ok && v6.config.endpoint).toEqual({ host: "::1", port: 3310 });
  });

  it("bounds the timeout and max-bytes knobs, reporting field names only", () => {
    const r = parseClamavConfig({
      [MALWARE_SCANNER_ENV]: "clamav://h",
      [CLAMAV_ENV.timeoutMs]: "50", // below the 1000ms floor
      [CLAMAV_ENV.maxBytes]: "999999999999", // above the 1GiB ceiling
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.field).sort()).toEqual(
        [CLAMAV_ENV.maxBytes, CLAMAV_ENV.timeoutMs].sort(),
      );
      // Content-free: the offending values never appear in the messages.
      for (const issue of r.issues) expect(issue.message).not.toMatch(/999999999999|\b50\b/);
    }
  });

  it("rejects a malformed endpoint by field name, never echoing the operator's value", () => {
    const r = parseClamavConfig({
      [MALWARE_SCANNER_ENV]: "clamav://leaky-secret-host:notaport",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]!.field).toBe(MALWARE_SCANNER_ENV);
      // The message is a static format hint; it never echoes the operator's value.
      expect(JSON.stringify(r.issues)).not.toContain("leaky-secret-host");
      expect(JSON.stringify(r.issues)).not.toContain("notaport");
    }
  });

  it("accepts bounded overrides", () => {
    const r = parseClamavConfig({
      [MALWARE_SCANNER_ENV]: "clamav://h",
      [CLAMAV_ENV.timeoutMs]: "12000",
      [CLAMAV_ENV.maxBytes]: "1048576",
    });
    expect(r.ok && r.config.timeoutMs).toBe(12000);
    expect(r.ok && r.config.maxBytes).toBe(1048576);
  });
});

describe("resolveScannerReadiness", () => {
  it("is not-configured/inactive on a bare environment", () => {
    const r = resolveScannerReadiness({});
    expect(r.state).toBe("not-configured");
    expect(r.active).toBe(false);
    expect(r.required).toBe(false);
    expect(r.detail).toMatch(/not scanned|not configured/i);
  });

  it("is disabled/inactive when explicitly turned off", () => {
    const r = resolveScannerReadiness({ [MALWARE_SCANNER_ENV]: "off" });
    expect(r.state).toBe("disabled");
    expect(r.active).toBe(false);
  });

  it("is ready/active when a usable clamd endpoint is configured", () => {
    const r = resolveScannerReadiness({ [MALWARE_SCANNER_ENV]: "clamav://clamd:3310" });
    expect(r.state).toBe("ready");
    expect(r.active).toBe(true);
  });

  it("is unavailable/inactive when selected but misconfigured or unrecognized", () => {
    expect(resolveScannerReadiness({ [MALWARE_SCANNER_ENV]: "clamav://" }).state).toBe(
      "unavailable",
    );
    expect(resolveScannerReadiness({ [MALWARE_SCANNER_ENV]: "http://x" }).state).toBe(
      "unavailable",
    );
    expect(resolveScannerReadiness({ [MALWARE_SCANNER_ENV]: "clamav://" }).active).toBe(false);
  });

  it("reflects the required flag", () => {
    const r = resolveScannerReadiness({
      [MALWARE_SCANNER_ENV]: "clamav://clamd:3310",
      [MALWARE_SCAN_REQUIRED_ENV]: "1",
    });
    expect(r.required).toBe(true);
  });

  it("never leaks the declared endpoint value or a variable name", () => {
    const serialized = JSON.stringify(
      resolveScannerReadiness({ [MALWARE_SCANNER_ENV]: "clamav://secret.host:3310" }),
    );
    expect(serialized).not.toContain("secret.host");
    expect(serialized).not.toContain("PDFXYZ_");
  });
});

describe("createMalwareScanner", () => {
  it("wires the honest no-op by default (never claims scanned)", async () => {
    const scanner = createMalwareScanner({ env: {} });
    expect(scanner.capability().active).toBe(false);
    expect(scanner.capability().provider).toBe("not-configured");
    expect((await scanner.scan(empty)).verdict).toBe("skipped");
  });

  it("uses an injected provider verbatim (the test/runtime seam)", async () => {
    const scanner = createMalwareScanner({ scanner: fakeScanner(scanInfected()) });
    expect((await scanner.scan(empty)).verdict).toBe("infected");
    expect(scanner.capability().active).toBe(true);
  });
});
