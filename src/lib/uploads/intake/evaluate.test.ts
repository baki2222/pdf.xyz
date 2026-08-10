import { describe, expect, it } from "vitest";
import { CONTRACT_DOCS } from "@/lib/jobs";
import { DEFAULT_INTAKE_POLICY, type IntakePolicy } from "./policy";
import {
  evaluateJobInputCount,
  evaluateUploadDescriptors,
  evaluateUploadedBytes,
  intakeErrorResult,
  type IntakeDecision,
} from "./evaluate";

const enc = (s: string) => new TextEncoder().encode(s);
const pdfFile = {
  filename: "scan.pdf",
  contentType: "application/pdf",
  bytes: 1024,
};
const policy = (over: Partial<IntakePolicy> = {}): IntakePolicy => ({
  ...DEFAULT_INTAKE_POLICY,
  ...over,
});

/** Assert a decision is a rejection with the given code and return it. */
function rejectedWith(decision: IntakeDecision, code: string) {
  expect(decision.ok).toBe(false);
  if (decision.ok) throw new Error("expected a rejection");
  expect(decision.rejection.code).toBe(code);
  expect(decision.rejection.telemetry.code).toBe(code);
  return decision.rejection;
}

describe("evaluateUploadDescriptors — happy path & tolerance", () => {
  it("accepts a well-formed single-file session", () => {
    expect(
      evaluateUploadDescriptors({ tool: "ocr-pdf", files: [pdfFile] }),
    ).toEqual({
      ok: true,
    });
  });

  it("defers non-object bodies and non-array files to the validator", () => {
    expect(evaluateUploadDescriptors(null)).toEqual({ ok: true });
    expect(evaluateUploadDescriptors("nope")).toEqual({ ok: true });
    expect(evaluateUploadDescriptors({ files: "not-array" })).toEqual({
      ok: true,
    });
  });

  it("defers a structurally malformed file entry to the validator", () => {
    // Missing bytes, non-record entries: ambiguous → intake passes, validator owns it.
    expect(
      evaluateUploadDescriptors({ files: [{ filename: "a.pdf" }] }),
    ).toEqual({
      ok: true,
    });
    expect(evaluateUploadDescriptors({ files: [null, 42] })).toEqual({
      ok: true,
    });
  });

  it("ignores an unshaped Content-Type (validator names the precise problem)", () => {
    expect(
      evaluateUploadDescriptors({
        files: [{ filename: "a.pdf", contentType: "bogus" }],
      }),
    ).toEqual({ ok: true });
  });
});

describe("evaluateUploadDescriptors — rejections", () => {
  it("rejects too many files (422)", () => {
    const decision = evaluateUploadDescriptors(
      { files: [pdfFile, pdfFile, pdfFile] },
      policy({ maxFiles: 2 }),
    );
    const rejection = rejectedWith(decision, "too_many_files");
    expect(rejection.telemetry.limit).toBe(2);
    expect(intakeErrorResult(rejection).status).toBe(422);
  });

  it("rejects an over-size file (413) with the offending index", () => {
    const decision = evaluateUploadDescriptors(
      {
        files: [
          { ...pdfFile, bytes: 50 },
          { ...pdfFile, bytes: 10_000 },
        ],
      },
      policy({ maxFileBytes: 100 }),
    );
    const rejection = rejectedWith(decision, "file_too_large");
    expect(rejection.telemetry.index).toBe(1);
    expect(rejection.telemetry.limit).toBe(100);
    expect(intakeErrorResult(rejection).status).toBe(413);
  });

  it("rejects an over-size combined request (413)", () => {
    const decision = evaluateUploadDescriptors(
      {
        files: [
          { ...pdfFile, bytes: 8 },
          { ...pdfFile, bytes: 8 },
        ],
      },
      policy({ maxRequestBytes: 10 }),
    );
    rejectedWith(decision, "request_too_large");
    expect(
      intakeErrorResult(rejectedWith(decision, "request_too_large")).status,
    ).toBe(413);
  });

  it("rejects an unrecognized file type (415)", () => {
    const decision = evaluateUploadDescriptors({
      files: [
        {
          filename: "x.exe",
          contentType: "application/x-msdownload",
          bytes: 10,
        },
      ],
    });
    const rejection = rejectedWith(decision, "unsupported_file_type");
    expect(rejection.telemetry.reason).toBe("unrecognized");
    expect(intakeErrorResult(rejection).status).toBe(415);
  });

  it("rejects a MIME/extension family mismatch (415)", () => {
    const decision = evaluateUploadDescriptors({
      files: [{ filename: "invoice.pdf", contentType: "image/png", bytes: 10 }],
    });
    const rejection = rejectedWith(decision, "unsupported_file_type");
    expect(rejection.telemetry.reason).toBe("mismatch");
  });

  it("rejects a hostile filename (400) — traversal and separators", () => {
    for (const filename of ["../secret.pdf", "a/b.pdf", "..", "sub\\c.pdf"]) {
      const decision = evaluateUploadDescriptors({
        files: [{ filename, contentType: "application/pdf", bytes: 10 }],
      });
      const rejection = rejectedWith(decision, "invalid_upload_request");
      expect(intakeErrorResult(rejection).status).toBe(400);
    }
  });

  it("rejects an over-length filename (400)", () => {
    const decision = evaluateUploadDescriptors(
      {
        files: [
          {
            filename: `${"a".repeat(50)}.pdf`,
            contentType: "application/pdf",
            bytes: 10,
          },
        ],
      },
      policy({ maxFilenameLength: 16 }),
    );
    rejectedWith(decision, "invalid_upload_request");
  });

  it("checks the per-file limit before the combined limit", () => {
    // Both limits are blown; the more specific, indexed file_too_large wins.
    const decision = evaluateUploadDescriptors(
      { files: [{ ...pdfFile, bytes: 1000 }] },
      policy({ maxFileBytes: 100, maxRequestBytes: 200 }),
    );
    rejectedWith(decision, "file_too_large");
  });
});

describe("evaluateJobInputCount", () => {
  it("passes an in-range input list and defers non-arrays", () => {
    expect(evaluateJobInputCount({ inputs: ["f_1", "f_2"] })).toEqual({
      ok: true,
    });
    expect(evaluateJobInputCount({ inputs: "nope" })).toEqual({ ok: true });
    expect(evaluateJobInputCount({})).toEqual({ ok: true });
  });

  it("rejects too many inputs with the same cap as uploads", () => {
    const decision = evaluateJobInputCount(
      { inputs: ["a", "b", "c"] },
      policy({ maxFiles: 2 }),
    );
    const rejection = rejectedWith(decision, "too_many_files");
    expect(rejection.field).toBe("inputs");
  });
});

describe("evaluateUploadedBytes — opt-in structural sniff", () => {
  const junk = enc("not a pdf at all");
  const validPdf = enc("%PDF-1.7\nbody\n%%EOF\n");

  it("is a no-op by default (both knobs off), even for junk bytes", () => {
    expect(
      evaluateUploadedBytes(junk, { contentType: "application/pdf" }),
    ).toEqual({
      ok: true,
    });
  });

  it("rejects a headerless PDF when the magic knob is on", () => {
    const decision = evaluateUploadedBytes(
      junk,
      { contentType: "application/pdf" },
      policy({ requirePdfMagic: true }),
    );
    const rejection = rejectedWith(decision, "malformed_pdf");
    expect(rejection.telemetry.pdf).toBe("missing_header");
    expect(intakeErrorResult(rejection).status).toBe(422);
  });

  it("accepts a well-formed PDF when both knobs are on", () => {
    expect(
      evaluateUploadedBytes(
        validPdf,
        { contentType: "application/pdf" },
        policy({ requirePdfMagic: true, requirePdfEof: true }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a PDF missing its %%EOF when the eof knob is on", () => {
    const decision = evaluateUploadedBytes(
      enc("%PDF-1.7\nbody with no marker"),
      { contentType: "application/pdf" },
      policy({ requirePdfEof: true }),
    );
    expect(rejectedWith(decision, "malformed_pdf").telemetry.pdf).toBe(
      "missing_eof",
    );
  });

  it("flags an empty PDF when a structural knob is on", () => {
    const decision = evaluateUploadedBytes(
      new Uint8Array(0),
      { contentType: "application/pdf" },
      policy({ requirePdfMagic: true }),
    );
    expect(rejectedWith(decision, "malformed_pdf").telemetry.pdf).toBe("empty");
  });

  it("never gates non-PDF families, even with the knobs on", () => {
    expect(
      evaluateUploadedBytes(
        junk,
        { contentType: "image/png" },
        policy({ requirePdfMagic: true, requirePdfEof: true }),
      ),
    ).toEqual({ ok: true });
  });
});

describe("intakeErrorResult", () => {
  it("carries the standard error envelope with a positional field detail", () => {
    const decision = evaluateUploadDescriptors(
      { files: [{ ...pdfFile, bytes: 10_000 }] },
      policy({ maxFileBytes: 100 }),
    );
    if (decision.ok) throw new Error("expected a rejection");
    const result = intakeErrorResult(decision.rejection);
    expect(result.status).toBe(413);
    expect(result.body.error.code).toBe("file_too_large");
    expect(result.body.error.docs).toBe(CONTRACT_DOCS);
    expect(result.body.error.details).toEqual([
      { field: "files[0].bytes", message: expect.any(String) },
    ]);
  });
});
