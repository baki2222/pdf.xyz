// @vitest-environment node
/**
 * The shipped-default no-op scanner is the load-bearing honesty boundary: it never
 * scans and must never report a file as scanned. It is wired whenever a REAL scanner
 * is not running here — nothing declared, explicitly disabled, or selected-but-
 * misconfigured — so these tests pin `skipped` + `active: false` across all three,
 * and prove it leaks neither a declared value nor the input's filename.
 */
import { describe, expect, it } from "vitest";
import { notConfiguredScanner } from "./not-configured";
import { MALWARE_SCANNER_ENV } from "./config";
import type { MalwareScanInput } from "./types";

const input: MalwareScanInput = {
  tool: "compress-pdf",
  inputs: [
    {
      fileId: "f_secret00000",
      filename: "confidential-report.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    },
  ],
};

describe("notConfiguredScanner", () => {
  it("skips (never claims scanned) and is inactive/not-configured on a bare env", async () => {
    const scanner = notConfiguredScanner({});
    const result = await scanner.scan(input);
    expect(result.verdict).toBe("skipped");
    expect(result.scanned).toBe(false);
    expect(result.verdict).not.toBe("clean"); // never implies a scan happened
    const cap = scanner.capability();
    expect(cap.active).toBe(false);
    expect(cap.provider).toBe("not-configured");
  });

  it("reports `disabled` when scanning is explicitly turned off, still skipping", async () => {
    const scanner = notConfiguredScanner({ [MALWARE_SCANNER_ENV]: "disabled" });
    expect((await scanner.scan(input)).verdict).toBe("skipped");
    expect(scanner.capability().provider).toBe("disabled");
    expect(scanner.capability().active).toBe(false);
  });

  it("reports `unavailable` for a selected-but-misconfigured scanner, still skipping", async () => {
    const scanner = notConfiguredScanner({
      [MALWARE_SCANNER_ENV]: "clamav://",
    });
    const result = await scanner.scan(input);
    expect(result.verdict).toBe("skipped");
    expect(result.scanned).toBe(false);
    const cap = scanner.capability();
    expect(cap.active).toBe(false);
    expect(cap.provider).toBe("unavailable");
  });

  it("never leaks the declared value, a variable name, or an input filename", async () => {
    const scanner = notConfiguredScanner({
      [MALWARE_SCANNER_ENV]: "clamav://scanner.internal:3310",
    });
    const serialized = JSON.stringify({
      result: await scanner.scan(input),
      capability: scanner.capability(),
    });
    expect(serialized).not.toContain("scanner.internal");
    expect(serialized).not.toContain("PDFXYZ_");
    expect(serialized).not.toContain("confidential-report");
  });
});
