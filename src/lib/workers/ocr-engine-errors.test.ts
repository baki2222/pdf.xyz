// @vitest-environment node
/**
 * Which OCRmyPDF failures belong to the DOCUMENT (the same answer on every
 * retry, and the user can act on it) and which belong to the RUN.
 *
 * Until 2026-09-27 the processor mapped every engine failure to one retryable
 * "The OCR engine could not process this file" — a password-protected PDF was
 * retried three times and then blamed on nothing in particular. The cases below
 * are shaped like what `execFile` actually rejects with: a numeric `code` for a
 * non-zero exit, `killed`/`signal` with `code: null` for a timeout, and the
 * engine's stderr alongside.
 */
import { describe, expect, it } from "vitest";
import {
  OCR_REFUSAL_KINDS,
  OCR_REFUSAL_MESSAGES,
  OCRMYPDF_EXIT_CODES,
  OcrEngineRefusal,
  classifyOcrmypdfFailure,
  type OcrRefusalKind,
} from "./ocr-engine-errors";

/** An error shaped like a `promisify(execFile)` rejection. */
function execError(detail: {
  code: number | string | null;
  killed?: boolean;
  signal?: string | null;
  stderr?: string;
}) {
  return Object.assign(new Error("Command failed: ocrmypdf …"), {
    killed: false,
    signal: null,
    stderr: "",
    ...detail,
  });
}

/** Every case this suite claims, and what it must classify as. */
const CASES: {
  name: string;
  error: unknown;
  kind: OcrRefusalKind | null;
}[] = [
  {
    name: "exit 8 — EncryptedPdfError",
    error: execError({
      code: OCRMYPDF_EXIT_CODES.encryptedPdf,
      stderr: "EncryptedPdfError: Input PDF is encrypted.",
    }),
    kind: "encrypted",
  },
  {
    name: "exit 8 with no stderr at all (the code alone is stable)",
    error: execError({ code: 8 }),
    kind: "encrypted",
  },
  {
    name: "exit 6 — PriorOcrFoundError",
    error: execError({
      code: OCRMYPDF_EXIT_CODES.alreadyDoneOcr,
      stderr: "PriorOcrFoundError: page already has text!",
    }),
    kind: "prior-text",
  },
  {
    name: "exit 2 — a digitally signed input",
    error: execError({
      code: OCRMYPDF_EXIT_CODES.inputFile,
      stderr:
        "DigitalSignatureError: Input PDF has a digital signature. OCR would alter the document,\ninvalidating the signature.",
    }),
    kind: "signed",
  },
  {
    name: "exit 2 — a tagged PDF (versions that refuse it without an override)",
    error: execError({
      code: 2,
      stderr:
        "TaggedPDFError: This PDF is marked as a Tagged PDF. This often indicates that the PDF was generated from an office document and does not need OCR.",
    }),
    kind: "prior-text",
  },
  {
    name: "exit 2 — an input that is not a readable PDF",
    error: execError({
      code: 2,
      stderr: "InputFileError: File is not a valid PDF",
    }),
    kind: "unreadable",
  },
  // ── the RUN, not the document: every one stays on the retryable path ──
  {
    name: "exit 2 from argparse — our argv, never the user's file",
    error: execError({
      code: 2,
      stderr:
        "usage: ocrmypdf [-h] [-l LANGUAGE] ...\nocrmypdf: error: unrecognized arguments: --bogus",
    }),
    kind: null,
  },
  {
    name: "a timeout — killed, no exit code",
    error: execError({ code: null, killed: true, signal: "SIGTERM" }),
    kind: null,
  },
  {
    name: "a signal kill (e.g. the OOM killer) even with a code",
    error: execError({ code: 8, signal: "SIGKILL" }),
    kind: null,
  },
  {
    name: "exit 7 — a child process (Tesseract/Ghostscript) crashed",
    error: execError({ code: 7 }),
    kind: null,
  },
  {
    name: "exit 15 — other error",
    error: execError({ code: 15 }),
    kind: null,
  },
  {
    name: "a spawn failure (string code)",
    error: execError({ code: "ENOENT" }),
    kind: null,
  },
  { name: "a bare Error", error: new Error("boom"), kind: null },
  { name: "a non-object throw", error: "boom", kind: null },
];

describe("classifyOcrmypdfFailure", () => {
  for (const c of CASES) {
    it(`${c.name} → ${c.kind ?? "the run (retryable)"}`, () => {
      expect(classifyOcrmypdfFailure(c.error)).toBe(c.kind);
    });
  }

  it("the corpus exercises every refusal kind and the retryable path (both directions)", () => {
    // Rule 1: a kind nothing produces is decoration. Derived from the declared
    // kinds, so a kind added without a case fails here.
    const produced = new Set(CASES.map((c) => c.kind));
    for (const kind of OCR_REFUSAL_KINDS) expect(produced).toContain(kind);
    expect(produced).toContain(null);
    // Health check on the corpus itself.
    expect(CASES.length).toBeGreaterThanOrEqual(OCR_REFUSAL_KINDS.length + 3);
  });
});

describe("OcrEngineRefusal — actionable, fixed, content-free copy", () => {
  it("carries a message for every kind, and the encrypted one names the fix", () => {
    for (const kind of OCR_REFUSAL_KINDS) {
      const refusal = new OcrEngineRefusal(kind);
      expect(refusal.kind).toBe(kind);
      expect(refusal.message).toBe(OCR_REFUSAL_MESSAGES[kind]);
      // Every refusal says nothing was produced, so no user hunts for a file.
      expect(refusal.message).toMatch(/nothing was processed/i);
    }
    expect(OCR_REFUSAL_MESSAGES.encrypted).toMatch(/Unlock PDF/);
    expect(OCR_REFUSAL_MESSAGES.unreadable).toMatch(/Repair PDF/);
  });
});
