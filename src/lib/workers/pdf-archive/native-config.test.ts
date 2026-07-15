import { describe, expect, it } from "vitest";
import { resolveNativePdfArchiveConfig } from "./native-config";

describe("resolveNativePdfArchiveConfig", () => {
  it("defaults to enabled Ghostscript on PATH with bounded limits", () => {
    expect(resolveNativePdfArchiveConfig({})).toMatchObject({
      enabled: true,
      binary: "gs",
      overridden: false,
      timeoutMs: 120_000,
      maxInputBytes: 200 * 1024 * 1024,
      maxOutputBytes: 300 * 1024 * 1024,
    });
  });

  it("supports disable, absolute binary override, timeout/input/output, and tmpdir", () => {
    expect(
      resolveNativePdfArchiveConfig({
        PDFXYZ_PDF_ARCHIVE: "off",
        PDFXYZ_GHOSTSCRIPT_BIN: "/usr/bin/gs",
        PDFXYZ_PDF_ARCHIVE_TIMEOUT_MS: "45000",
        PDFXYZ_PDF_ARCHIVE_MAX_INPUT_BYTES: "12345",
        PDFXYZ_PDF_ARCHIVE_MAX_OUTPUT_BYTES: "67890",
        PDFXYZ_PDF_ARCHIVE_TMPDIR: "/tmp/pdfxyz",
      }),
    ).toMatchObject({
      enabled: false,
      binary: "/usr/bin/gs",
      overridden: true,
      timeoutMs: 45_000,
      maxInputBytes: 12_345,
      maxOutputBytes: 67_890,
      tmpDir: "/tmp/pdfxyz",
    });
  });
});
