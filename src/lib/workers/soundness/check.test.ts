// @vitest-environment node
/**
 * The pure soundness evaluation + reason taxonomy: every verdict/reason path, the
 * cheapest-first ordering, and the honest per-input PDF-expectation logic that keeps
 * a valid image handed to a multi-format tool (OCR) from being gated as a broken PDF.
 */
import { describe, expect, it } from "vitest";
import type { ProcessorInputFile } from "../processor/types";
import { checkSoundness } from "./check";
import { DEFAULT_SOUNDNESS_POLICY, type SoundnessPolicy } from "./policy";

const enc = (s: string) => new TextEncoder().encode(s);

/** A structurally-sound minimal PDF (header + trailer). */
const VALID_PDF = enc(`%PDF-1.7\n${"0".repeat(64)}\n%%EOF\n`);
/** A PDF header with no `%%EOF` trailer (truncated). */
const HEADER_ONLY_PDF = enc(`%PDF-1.7\n${"0".repeat(64)}\n`);
/** Bytes that are plainly not a PDF. */
const NOT_PDF = enc("this is definitely not a pdf document at all");
/** A PNG magic-number preamble (a real image handed to OCR). */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);

function file(
  bytes: Uint8Array,
  contentType = "application/pdf",
): ProcessorInputFile {
  return { fileId: "file_x", filename: "input", contentType, bytes };
}

const policy = (over: Partial<SoundnessPolicy> = {}): SoundnessPolicy => ({
  ...DEFAULT_SOUNDNESS_POLICY,
  ...over,
});

describe("checkSoundness — gate on/off", () => {
  it("returns skipped (checked:false) when the policy is disabled", () => {
    const result = checkSoundness(policy({ enabled: false }), {
      tool: "compress-pdf",
      inputs: [file(NOT_PDF)],
    });
    expect(result).toMatchObject({
      verdict: "skipped",
      checked: false,
      reason: "not_checked",
    });
  });

  it("passes a valid PDF to a PDF tool (sound / ok / checked)", () => {
    const result = checkSoundness(policy(), {
      tool: "compress-pdf",
      inputs: [file(VALID_PDF)],
    });
    expect(result).toMatchObject({ verdict: "sound", checked: true, reason: "ok" });
  });
});

describe("checkSoundness — reject taxonomy", () => {
  it("missing_input when a FILE-input job carries no inputs", () => {
    const result = checkSoundness(policy(), { tool: "compress-pdf", inputs: [] });
    expect(result).toMatchObject({ verdict: "unsound", reason: "missing_input" });
  });

  it("skips — never rejects — a URL-input tool, which has no files by design", () => {
    // webpage-to-pdf takes `options.url` and an empty `inputs`; treating that as a
    // missing file blocked every one of its jobs before the processor ever ran.
    const result = checkSoundness(policy(), { tool: "webpage-to-pdf", inputs: [] });
    expect(result).toMatchObject({
      verdict: "skipped",
      checked: false,
      reason: "not_checked",
    });
  });

  it("empty when an input has zero bytes (even before any PDF logic)", () => {
    const result = checkSoundness(policy(), {
      tool: "compress-pdf",
      inputs: [file(new Uint8Array())],
    });
    expect(result).toMatchObject({ verdict: "unsound", reason: "empty" });
  });

  it("file_too_large when an input exceeds a configured max-bytes ceiling", () => {
    const result = checkSoundness(policy({ maxBytes: 8 }), {
      tool: "compress-pdf",
      inputs: [file(VALID_PDF)],
    });
    expect(result).toMatchObject({ verdict: "unsound", reason: "file_too_large" });
  });

  it("does not apply the max-bytes check when it is 0 (disabled)", () => {
    const result = checkSoundness(policy({ maxBytes: 0 }), {
      tool: "compress-pdf",
      inputs: [file(VALID_PDF)],
    });
    expect(result.verdict).toBe("sound");
  });

  it("unsupported_family when a declared family the tool rejects is sent", () => {
    // compress-pdf accepts only PDF; a declared image is a positive mismatch.
    const result = checkSoundness(policy(), {
      tool: "compress-pdf",
      inputs: [file(VALID_PDF, "image/png")],
    });
    expect(result).toMatchObject({
      verdict: "unsound",
      reason: "unsupported_family",
    });
  });

  it("malformed_pdf when a PDF-expected input lacks a %PDF- header", () => {
    const result = checkSoundness(policy(), {
      tool: "compress-pdf",
      inputs: [file(NOT_PDF)],
    });
    expect(result).toMatchObject({
      verdict: "unsound",
      reason: "malformed_pdf",
    });
  });

  it("malformed_pdf only when the opt-in EOF check is enabled", () => {
    const withoutEof = checkSoundness(policy(), {
      tool: "compress-pdf",
      inputs: [file(HEADER_ONLY_PDF)],
    });
    expect(withoutEof.verdict).toBe("sound"); // EOF check off by default

    const withEof = checkSoundness(policy({ requireEof: true }), {
      tool: "compress-pdf",
      inputs: [file(HEADER_ONLY_PDF)],
    });
    expect(withEof).toMatchObject({ verdict: "unsound", reason: "malformed_pdf" });
  });
});

describe("checkSoundness — honest per-input PDF expectation", () => {
  it("does NOT gate a valid image handed to a multi-format tool (OCR) as a PDF", () => {
    const result = checkSoundness(policy(), {
      tool: "ocr-pdf",
      inputs: [file(PNG_BYTES, "image/png")],
    });
    // The image is accepted by OCR and is not a PDF, so no %PDF- is required.
    expect(result.verdict).toBe("sound");
  });

  it("still gates a declared PDF handed to a multi-format tool", () => {
    const result = checkSoundness(policy(), {
      tool: "ocr-pdf",
      inputs: [file(NOT_PDF, "application/pdf")],
    });
    expect(result).toMatchObject({
      verdict: "unsound",
      reason: "malformed_pdf",
    });
  });

  it("assumes PDF for an unknown declared type on a PDF-only tool (mislabel caught)", () => {
    const result = checkSoundness(policy(), {
      tool: "compress-pdf",
      inputs: [file(NOT_PDF, "application/octet-stream")],
    });
    expect(result).toMatchObject({
      verdict: "unsound",
      reason: "malformed_pdf",
    });
  });

  it("defers an unknown declared type on a multi-format tool (cannot disambiguate)", () => {
    const result = checkSoundness(policy(), {
      tool: "ocr-pdf",
      inputs: [file(NOT_PDF, "application/octet-stream")],
    });
    expect(result.verdict).toBe("sound");
  });

  it("only runs universal checks for an unknown tool (non-empty junk passes)", () => {
    expect(
      checkSoundness(policy(), {
        tool: "not-a-real-tool",
        inputs: [file(NOT_PDF, "application/octet-stream")],
      }).verdict,
    ).toBe("sound");
    expect(
      checkSoundness(policy(), {
        tool: "not-a-real-tool",
        inputs: [file(new Uint8Array())],
      }),
    ).toMatchObject({ verdict: "unsound", reason: "empty" });
  });
});

describe("checkSoundness — knob interactions", () => {
  it("requireHeader:false lets a non-PDF pass a PDF tool (deferred to the processor)", () => {
    const result = checkSoundness(policy({ requireHeader: false }), {
      tool: "compress-pdf",
      inputs: [file(NOT_PDF)],
    });
    expect(result.verdict).toBe("sound");
  });

  it("checkContentType:false disables the family-mismatch rejection", () => {
    // With the content-type check off, a declared image is not a mismatch and (being
    // a non-PDF declared family) is not header-checked either → deferred.
    const result = checkSoundness(policy({ checkContentType: false }), {
      tool: "compress-pdf",
      inputs: [file(PNG_BYTES, "image/png")],
    });
    expect(result.verdict).toBe("sound");
  });
});

describe("checkSoundness — multi-file", () => {
  it("rejects on the first failing input and reports its reason", () => {
    const result = checkSoundness(policy(), {
      tool: "compress-pdf",
      inputs: [file(VALID_PDF), file(new Uint8Array()), file(NOT_PDF)],
    });
    // The empty second file fails before the headerless third is even considered.
    expect(result).toMatchObject({ verdict: "unsound", reason: "empty" });
  });

  it("passes when every input is sound", () => {
    const result = checkSoundness(policy(), {
      tool: "compress-pdf",
      inputs: [file(VALID_PDF), file(VALID_PDF)],
    });
    expect(result.verdict).toBe("sound");
  });
});

// ── Additional coverage: declared-size consistency, metadata coherence, the
//    per-job count ceiling, and the fail-closed policy guard. ──────────────────

/** A named file with an optional declared byte count, for the size/metadata checks. */
function named(
  bytes: Uint8Array,
  filename: string,
  contentType = "application/pdf",
  declaredBytes?: number,
): ProcessorInputFile {
  return {
    fileId: "file_named",
    filename,
    contentType,
    bytes,
    ...(declaredBytes !== undefined ? { declaredBytes } : {}),
  };
}

describe("checkSoundness — declared-size consistency", () => {
  it("size_mismatch when the fetched count differs from the declared size", () => {
    const f = named(VALID_PDF, "report.pdf", "application/pdf", VALID_PDF.byteLength + 1);
    expect(checkSoundness(policy(), { tool: "compress-pdf", inputs: [f] })).toMatchObject({
      verdict: "unsound",
      reason: "size_mismatch",
    });
  });

  it("sound when the declared size matches the fetched size", () => {
    const f = named(VALID_PDF, "report.pdf", "application/pdf", VALID_PDF.byteLength);
    expect(checkSoundness(policy(), { tool: "compress-pdf", inputs: [f] }).verdict).toBe(
      "sound",
    );
  });

  it("skips the size check when no declared size / a non-positive one was recorded", () => {
    for (const declared of [undefined, 0, -3]) {
      const f = named(VALID_PDF, "report.pdf", "application/pdf", declared);
      expect(
        checkSoundness(policy(), { tool: "compress-pdf", inputs: [f] }).verdict,
      ).toBe("sound");
    }
  });

  it("honors checkSize:false (a mismatch is not rejected)", () => {
    const f = named(VALID_PDF, "report.pdf", "application/pdf", VALID_PDF.byteLength + 999);
    expect(
      checkSoundness(policy({ checkSize: false }), {
        tool: "compress-pdf",
        inputs: [f],
      }).verdict,
    ).toBe("sound");
  });
});

describe("checkSoundness — metadata coherence", () => {
  it("metadata_mismatch when the content-type family disagrees with the extension", () => {
    // Declared PDF (accepted by the tool) but named `.png` — internally inconsistent.
    const f = named(VALID_PDF, "invoice.png", "application/pdf");
    expect(checkSoundness(policy(), { tool: "compress-pdf", inputs: [f] })).toMatchObject({
      verdict: "unsound",
      reason: "metadata_mismatch",
    });
  });

  it("does not flag a mismatch when the filename extension is unknown/absent", () => {
    for (const filename of ["document", "weird.xyz"]) {
      const f = named(VALID_PDF, filename, "application/pdf");
      expect(
        checkSoundness(policy(), { tool: "compress-pdf", inputs: [f] }).verdict,
      ).toBe("sound");
    }
  });
});

describe("checkSoundness — count + policy guard", () => {
  it("too_many_inputs when the job exceeds the input ceiling", () => {
    const result = checkSoundness(policy({ maxInputs: 1 }), {
      tool: "compress-pdf",
      inputs: [file(VALID_PDF), file(VALID_PDF)],
    });
    expect(result).toMatchObject({ verdict: "unsound", reason: "too_many_inputs" });
  });

  it("policy_unavailable (fail closed) when handed a nullish/malformed policy", () => {
    const result = checkSoundness(null as unknown as SoundnessPolicy, {
      tool: "compress-pdf",
      inputs: [file(VALID_PDF)],
    });
    expect(result).toMatchObject({ verdict: "unsound", reason: "policy_unavailable" });
  });
});

