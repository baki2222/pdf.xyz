import { describe, expect, it } from "vitest";
import {
  INPUT_BYTES_BOUNDS,
  NATIVE_COMPRESSION_ENV,
  OUTPUT_BYTES_BOUNDS,
  TIMEOUT_MS_BOUNDS,
  disabledNativeCompressionConfig,
  isSafeConfiguredPath,
  nativeCompressionCapability,
  parseNativeCompressionConfig,
  resolveNativeCompressionConfig,
} from "./native-config";

const E = NATIVE_COMPRESSION_ENV;

describe("parseNativeCompressionConfig — defaults", () => {
  it("is enabled by default (auto), with command-name binaries and default bounds", () => {
    const parsed = parseNativeCompressionConfig({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const c = parsed.config;
    expect(c.enabled).toBe(true);
    expect(c.engine).toBeUndefined();
    expect(c.binaries).toEqual({
      ghostscript: "gs",
      qpdf: "qpdf",
      mutool: "mutool",
    });
    expect(c.overridden).toEqual({
      ghostscript: false,
      qpdf: false,
      mutool: false,
    });
    expect(c.timeoutMs).toBe(TIMEOUT_MS_BOUNDS.default);
    expect(c.maxInputBytes).toBe(INPUT_BYTES_BOUNDS.default);
    expect(c.maxOutputBytes).toBe(OUTPUT_BYTES_BOUNDS.default);
    expect(c.tmpDir).toBeUndefined();
  });
});

describe("parseNativeCompressionConfig — enable flag", () => {
  it.each(["off", "false", "0", "no", "disabled", "none", "OFF"])(
    "treats %s as disabled (kill switch)",
    (value) => {
      const parsed = parseNativeCompressionConfig({ [E.enable]: value });
      expect(parsed.ok && parsed.config.enabled).toBe(false);
    },
  );

  it.each(["on", "true", "1", "auto", "AUTO"])(
    "treats %s as enabled",
    (value) => {
      const parsed = parseNativeCompressionConfig({ [E.enable]: value });
      expect(parsed.ok && parsed.config.enabled).toBe(true);
    },
  );

  it("rejects an unrecognized enable value, naming the variable only", () => {
    const parsed = parseNativeCompressionConfig({ [E.enable]: "maybe" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.some((i) => i.field === E.enable)).toBe(true);
    // The offending value is never echoed back.
    expect(JSON.stringify(parsed.issues)).not.toContain("maybe");
  });
});

describe("parseNativeCompressionConfig — engine pin", () => {
  it("accepts an allowlisted engine (case-insensitive)", () => {
    const parsed = parseNativeCompressionConfig({ [E.engine]: "QPDF" });
    expect(parsed.ok && parsed.config.engine).toBe("qpdf");
  });

  it("rejects an unknown engine", () => {
    const parsed = parseNativeCompressionConfig({ [E.engine]: "acrobat" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]?.field).toBe(E.engine);
  });
});

describe("parseNativeCompressionConfig — binary overrides", () => {
  it("accepts a safe absolute override path and marks it overridden", () => {
    const parsed = parseNativeCompressionConfig({
      [E.ghostscriptBin]: "/usr/local/bin/gs",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.binaries.ghostscript).toBe("/usr/local/bin/gs");
    expect(parsed.config.overridden.ghostscript).toBe(true);
    // Others keep their command-name defaults.
    expect(parsed.config.binaries.qpdf).toBe("qpdf");
    expect(parsed.config.overridden.qpdf).toBe(false);
  });

  it.each([
    ["relative", "usr/bin/gs"],
    ["bare command", "gs"],
    ["traversal", "/usr/../bin/gs"],
    ["shell metacharacter", "/usr/bin/gs; rm -rf /"],
    ["command substitution", "/usr/bin/$(whoami)"],
  ])(
    "rejects an unsafe override path (%s), naming the variable only",
    (_label, value) => {
      const parsed = parseNativeCompressionConfig({ [E.qpdfBin]: value });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.issues.some((i) => i.field === E.qpdfBin)).toBe(true);
      // The offending path value is never echoed into the diagnostics.
      expect(JSON.stringify(parsed.issues)).not.toContain(value);
    },
  );
});

describe("parseNativeCompressionConfig — bounds", () => {
  it("accepts in-range numeric overrides", () => {
    const parsed = parseNativeCompressionConfig({
      [E.timeoutMs]: "5000",
      [E.maxInputBytes]: "1048576",
      [E.maxOutputBytes]: "2097152",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.timeoutMs).toBe(5000);
    expect(parsed.config.maxInputBytes).toBe(1048576);
    expect(parsed.config.maxOutputBytes).toBe(2097152);
  });

  it.each([
    [E.timeoutMs, "100"], // below min
    [E.timeoutMs, "9999999"], // above max
    [E.timeoutMs, "abc"],
    [E.maxInputBytes, "1"], // below min
    [E.maxOutputBytes, "-5"],
  ])("rejects an out-of-range or malformed %s", (name, value) => {
    const parsed = parseNativeCompressionConfig({ [name]: value });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.issues.some((i) => i.field === name)).toBe(true);
  });
});

describe("parseNativeCompressionConfig — temp dir", () => {
  it("accepts a safe absolute temp dir", () => {
    const parsed = parseNativeCompressionConfig({
      [E.tmpDir]: "/var/tmp/pdfxyz",
    });
    expect(parsed.ok && parsed.config.tmpDir).toBe("/var/tmp/pdfxyz");
  });

  it("rejects a traversal temp dir", () => {
    const parsed = parseNativeCompressionConfig({ [E.tmpDir]: "/var/../etc" });
    expect(parsed.ok).toBe(false);
  });
});

describe("isSafeConfiguredPath", () => {
  it("accepts absolute posix and windows paths, with spaces/parens", () => {
    expect(isSafeConfiguredPath("/usr/bin/gs")).toBe(true);
    expect(
      isSafeConfiguredPath("C:\\Program Files (x86)\\gs\\bin\\gswin64c.exe"),
    ).toBe(true);
    expect(isSafeConfiguredPath("C:/tools/qpdf.exe")).toBe(true);
  });

  it("rejects relative paths, traversal, control/shell characters, and overlong input", () => {
    expect(isSafeConfiguredPath("bin/gs")).toBe(false);
    expect(isSafeConfiguredPath("/a/../b")).toBe(false);
    expect(isSafeConfiguredPath("/usr/bin/gs\n")).toBe(false);
    expect(isSafeConfiguredPath("/usr/bin/gs|cat")).toBe(false);
    expect(isSafeConfiguredPath("")).toBe(false);
    expect(isSafeConfiguredPath(`/${"a".repeat(5000)}`)).toBe(false);
  });
});

describe("resolveNativeCompressionConfig", () => {
  it("degrades a malformed environment to the safe disabled config", () => {
    const config = resolveNativeCompressionConfig({ [E.enable]: "bogus" });
    expect(config).toEqual(disabledNativeCompressionConfig());
    expect(config.enabled).toBe(false);
  });
});

describe("nativeCompressionCapability — presence-only, no leakage", () => {
  it("reports enabled auto-detect by default and names no path", () => {
    const cap = nativeCompressionCapability({});
    expect(cap.enabled).toBe(true);
    expect(cap.engine).toBeNull();
    expect(cap.detail).toMatch(/auto-detection/i);
  });

  it("reports disabled when the kill switch is set", () => {
    const cap = nativeCompressionCapability({ [E.enable]: "off" });
    expect(cap.enabled).toBe(false);
    expect(cap.engine).toBeNull();
  });

  it("names the pinned engine family but never a binary path or variable", () => {
    const env = {
      [E.engine]: "ghostscript",
      [E.ghostscriptBin]: "/opt/secret-place/gs-9.99",
      [E.tmpDir]: "/opt/secret-tmp",
    };
    const cap = nativeCompressionCapability(env);
    expect(cap.enabled).toBe(true);
    expect(cap.engine).toBe("ghostscript");
    const serialized = JSON.stringify(cap);
    // The engine *family* is fine to expose; a configured path or variable is not.
    expect(serialized).toContain("ghostscript");
    for (const leak of ["secret-place", "gs-9.99", "secret-tmp", "PDFXYZ_"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("degrades to disabled (no leak) when a value is malformed", () => {
    const cap = nativeCompressionCapability({ [E.timeoutMs]: "not-a-number" });
    expect(cap.enabled).toBe(false);
  });
});
