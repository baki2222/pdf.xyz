// @vitest-environment node
/**
 * Policy resolution + tool-family derivation for the worker file-soundness gate:
 * the shipped defaults, strict/fail-safe env parsing, and that the accepted-family
 * derivation tracks the real tool/job contracts (so a PDF-only tool and a
 * multi-format tool are distinguished honestly).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOUNDNESS_POLICY,
  SOUNDNESS_BOUNDS,
  SOUNDNESS_ENV,
  acceptedFamiliesForTool,
  inputExpectedAsPdf,
  resolveSoundnessPolicy,
} from "./policy";

describe("DEFAULT_SOUNDNESS_POLICY", () => {
  it("ships enabled with the header check on and the risky checks opt-in", () => {
    expect(DEFAULT_SOUNDNESS_POLICY).toEqual({
      enabled: true,
      maxBytes: 0,
      maxInputs: 20,
      requireHeader: true,
      requireEof: false,
      checkContentType: true,
      checkSize: true,
      headerScanBytes: 1024,
      trailerScanBytes: 1024,
    });
  });

  it("is frozen so a caller cannot mutate the shared default", () => {
    expect(Object.isFrozen(DEFAULT_SOUNDNESS_POLICY)).toBe(true);
  });
});

describe("resolveSoundnessPolicy — defaults", () => {
  it("with an empty environment resolves exactly the frozen default", () => {
    expect(resolveSoundnessPolicy({})).toEqual(DEFAULT_SOUNDNESS_POLICY);
  });
});

describe("resolveSoundnessPolicy — overrides", () => {
  it("disables the whole gate on a recognized OFF token", () => {
    for (const off of ["off", "false", "0", "disabled", "no", "none"]) {
      expect(
        resolveSoundnessPolicy({ [SOUNDNESS_ENV.enabled]: off }).enabled,
      ).toBe(false);
    }
  });

  it("keeps the gate enabled on a recognized ON token", () => {
    for (const on of ["on", "true", "1", "yes", "enabled"]) {
      expect(
        resolveSoundnessPolicy({ [SOUNDNESS_ENV.enabled]: on }).enabled,
      ).toBe(true);
    }
  });

  it("reads a bounded max-bytes ceiling and the boolean knobs", () => {
    const policy = resolveSoundnessPolicy({
      [SOUNDNESS_ENV.maxBytes]: "5000000",
      [SOUNDNESS_ENV.requireEof]: "true",
      [SOUNDNESS_ENV.requireHeader]: "false",
      [SOUNDNESS_ENV.checkContentType]: "off",
      [SOUNDNESS_ENV.headerScanBytes]: "2048",
      [SOUNDNESS_ENV.trailerScanBytes]: "4096",
    });
    expect(policy).toEqual({
      enabled: true,
      maxBytes: 5_000_000,
      maxInputs: 20,
      requireHeader: false,
      requireEof: true,
      checkContentType: false,
      checkSize: true,
      headerScanBytes: 2048,
      trailerScanBytes: 4096,
    });
  });
});

describe("resolveSoundnessPolicy — strict, fail-safe parsing", () => {
  it("falls back to the default on a non-integer or out-of-range knob", () => {
    const bad = resolveSoundnessPolicy({
      [SOUNDNESS_ENV.maxBytes]: "5e6", // scientific notation → rejected
      [SOUNDNESS_ENV.headerScanBytes]: "1", // below the 8-byte floor → default
      [SOUNDNESS_ENV.trailerScanBytes]: `${SOUNDNESS_BOUNDS.trailerScanBytes.max + 1}`,
    });
    expect(bad.maxBytes).toBe(DEFAULT_SOUNDNESS_POLICY.maxBytes);
    expect(bad.headerScanBytes).toBe(DEFAULT_SOUNDNESS_POLICY.headerScanBytes);
    expect(bad.trailerScanBytes).toBe(
      DEFAULT_SOUNDNESS_POLICY.trailerScanBytes,
    );
  });

  it("keeps an unrecognized boolean token at its per-flag default (no silent flip)", () => {
    const policy = resolveSoundnessPolicy({
      [SOUNDNESS_ENV.enabled]: "maybe",
      [SOUNDNESS_ENV.requireEof]: "sometimes",
    });
    expect(policy.enabled).toBe(true); // default-on stays on
    expect(policy.requireEof).toBe(false); // default-off stays off
  });

  it("isolates a bad knob so the others still resolve", () => {
    const policy = resolveSoundnessPolicy({
      [SOUNDNESS_ENV.maxBytes]: "not-a-number",
      [SOUNDNESS_ENV.headerScanBytes]: "512",
    });
    expect(policy.maxBytes).toBe(0);
    expect(policy.headerScanBytes).toBe(512);
  });

  it("accepts a zero max-bytes (the disabled sentinel)", () => {
    expect(
      resolveSoundnessPolicy({ [SOUNDNESS_ENV.maxBytes]: "0" }).maxBytes,
    ).toBe(0);
  });
});

describe("acceptedFamiliesForTool — derived from the tool/job contracts", () => {
  it("maps a PDF-only tool to the pdf family alone", () => {
    const families = acceptedFamiliesForTool("compress-pdf");
    expect([...families]).toEqual(["pdf"]);
  });

  it("maps a multi-format tool to every family it accepts", () => {
    // ocr-pdf accepts PDF + JPG + PNG, so both pdf and image are honest inputs.
    const families = acceptedFamiliesForTool("ocr-pdf");
    expect(families.has("pdf")).toBe(true);
    expect(families.has("image")).toBe(true);
  });

  it("returns an empty set for an unknown tool (no guessing)", () => {
    expect(acceptedFamiliesForTool("definitely-not-a-tool").size).toBe(0);
  });
});

describe("inputExpectedAsPdf", () => {
  const pdfOnly = new Set(["pdf" as const]);
  const pdfOrImage = new Set(["pdf" as const, "image" as const]);

  it("treats a declared PDF as a PDF for any PDF-accepting tool", () => {
    expect(inputExpectedAsPdf(pdfOnly, "pdf")).toBe(true);
    expect(inputExpectedAsPdf(pdfOrImage, "pdf")).toBe(true);
  });

  it("assumes PDF for an unknown declared type ONLY on a PDF-only tool", () => {
    expect(inputExpectedAsPdf(pdfOnly, null)).toBe(true);
    // A multi-format tool with an unrecognized type could be an image → do not guess.
    expect(inputExpectedAsPdf(pdfOrImage, null)).toBe(false);
  });

  it("never treats a declared non-PDF family as a PDF (image → OCR stays an image)", () => {
    expect(inputExpectedAsPdf(pdfOrImage, "image")).toBe(false);
  });

  it("is false when the tool does not accept PDF at all", () => {
    expect(inputExpectedAsPdf(new Set(["image" as const]), "pdf")).toBe(false);
    expect(inputExpectedAsPdf(new Set(), null)).toBe(false);
  });
});
