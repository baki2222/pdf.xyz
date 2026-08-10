// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  NATIVE_OCR_ENV,
  OCR_INPUT_BYTES_BOUNDS,
  OCR_OUTPUT_BYTES_BOUNDS,
  OCR_TIMEOUT_MS_BOUNDS,
  disabledNativeOcrConfig,
  nativeOcrCapability,
  parseNativeOcrConfig,
  resolveNativeOcrConfig,
} from "./ocr-native-config";

describe("parseNativeOcrConfig — opt-in enable flag", () => {
  it("defaults to DISABLED when nothing is declared (OCR is opt-in)", () => {
    const parsed = parseNativeOcrConfig({});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config.enabled).toBe(false);
  });

  it("enables on an explicit on/true/auto token", () => {
    for (const value of ["on", "true", "1", "auto", "enabled"]) {
      const parsed = parseNativeOcrConfig({ [NATIVE_OCR_ENV.enable]: value });
      expect(parsed.ok && parsed.config.enabled).toBe(true);
    }
  });

  it("stays disabled on an explicit off token", () => {
    for (const value of ["off", "false", "0", "no", "disabled"]) {
      const parsed = parseNativeOcrConfig({ [NATIVE_OCR_ENV.enable]: value });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.config.enabled).toBe(false);
    }
  });

  it("rejects an unrecognized enable token by NAME, never echoing the value", () => {
    const parsed = parseNativeOcrConfig({
      [NATIVE_OCR_ENV.enable]: "maybe-later",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues[0]?.field).toBe(NATIVE_OCR_ENV.enable);
      expect(JSON.stringify(parsed.issues)).not.toContain("maybe-later");
    }
  });
});

describe("parseNativeOcrConfig — engine pin + binary overrides", () => {
  it("accepts a valid engine pin", () => {
    const parsed = parseNativeOcrConfig({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.engine]: "OCRmyPDF",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.config.engine).toBe("ocrmypdf");
  });

  it("rejects an unknown engine pin (name only)", () => {
    const parsed = parseNativeOcrConfig({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.engine]: "abbyy",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues[0]?.field).toBe(NATIVE_OCR_ENV.engine);
      expect(JSON.stringify(parsed.issues)).not.toContain("abbyy");
    }
  });

  it("accepts a safe absolute binary override and marks it overridden", () => {
    const parsed = parseNativeOcrConfig({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.ocrmypdfBin]: "/opt/ocr/bin/ocrmypdf",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.binaries.ocrmypdf).toBe("/opt/ocr/bin/ocrmypdf");
      expect(parsed.config.overridden.ocrmypdf).toBe(true);
      expect(parsed.config.overridden.tesseract).toBe(false);
    }
  });

  it("rejects an unsafe binary override (traversal / relative), never echoing it", () => {
    for (const bad of ["../evil", "ocrmypdf; rm -rf /", "relative/path"]) {
      const parsed = parseNativeOcrConfig({
        [NATIVE_OCR_ENV.enable]: "on",
        [NATIVE_OCR_ENV.tesseractBin]: bad,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.issues[0]?.field).toBe(NATIVE_OCR_ENV.tesseractBin);
        expect(JSON.stringify(parsed.issues)).not.toContain("rm -rf");
        expect(JSON.stringify(parsed.issues)).not.toContain("evil");
      }
    }
  });
});

describe("parseNativeOcrConfig — bounded numeric knobs", () => {
  it("defaults timeout/input/output when unset", () => {
    const parsed = parseNativeOcrConfig({ [NATIVE_OCR_ENV.enable]: "on" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.timeoutMs).toBe(OCR_TIMEOUT_MS_BOUNDS.default);
      expect(parsed.config.maxInputBytes).toBe(OCR_INPUT_BYTES_BOUNDS.default);
      expect(parsed.config.maxOutputBytes).toBe(
        OCR_OUTPUT_BYTES_BOUNDS.default,
      );
    }
  });

  it("accepts in-range values", () => {
    const parsed = parseNativeOcrConfig({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.timeoutMs]: "60000",
      [NATIVE_OCR_ENV.maxInputBytes]: "1048576",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.timeoutMs).toBe(60000);
      expect(parsed.config.maxInputBytes).toBe(1048576);
    }
  });

  it("rejects an out-of-range or non-numeric value by NAME", () => {
    const tooBig = String(OCR_TIMEOUT_MS_BOUNDS.max + 1);
    const parsed = parseNativeOcrConfig({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.timeoutMs]: tooBig,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.issues[0]?.field).toBe(NATIVE_OCR_ENV.timeoutMs);

    const nan = parseNativeOcrConfig({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.maxOutputBytes]: "lots",
    });
    expect(nan.ok).toBe(false);
    if (!nan.ok)
      expect(nan.issues[0]?.field).toBe(NATIVE_OCR_ENV.maxOutputBytes);
  });
});

describe("resolveNativeOcrConfig / disabledNativeOcrConfig", () => {
  it("degrades a malformed config to the safe disabled config", () => {
    const config = resolveNativeOcrConfig({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.engine]: "not-a-real-engine",
    });
    // A parse failure never half-configures the engine — it is fully off.
    expect(config.enabled).toBe(false);
  });

  it("returns a fully-off, defaulted config", () => {
    const config = disabledNativeOcrConfig();
    expect(config).toMatchObject({
      enabled: false,
      overridden: { ocrmypdf: false, tesseract: false },
      timeoutMs: OCR_TIMEOUT_MS_BOUNDS.default,
    });
  });
});

describe("nativeOcrCapability — presence-only, content-free", () => {
  it("reports disabled when OCR is not opted into", () => {
    const cap = nativeOcrCapability({});
    expect(cap.enabled).toBe(false);
    expect(cap.engine).toBeNull();
    expect(cap.detail.length).toBeGreaterThan(0);
  });

  it("reports enabled + the pinned engine family (name only)", () => {
    const cap = nativeOcrCapability({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.engine]: "tesseract",
    });
    expect(cap.enabled).toBe(true);
    expect(cap.engine).toBe("tesseract");
    expect(cap.detail).toContain("tesseract");
  });

  it("reports enabled with auto-detection when no engine is pinned", () => {
    const cap = nativeOcrCapability({ [NATIVE_OCR_ENV.enable]: "on" });
    expect(cap.enabled).toBe(true);
    expect(cap.engine).toBeNull();
  });

  it("never leaks a binary path or the enable value into the detail", () => {
    const cap = nativeOcrCapability({
      [NATIVE_OCR_ENV.enable]: "on",
      [NATIVE_OCR_ENV.ocrmypdfBin]: "/opt/secret/ocrmypdf",
    });
    expect(JSON.stringify(cap)).not.toContain("/opt/secret");
  });
});
