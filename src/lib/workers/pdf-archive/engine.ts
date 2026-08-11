import { looksLikePdf } from "../compression/engine";

export const PDF_TO_PDFA_TOOL = "pdf-to-pdfa";
export const PDF_ARCHIVE_TOOLS = [PDF_TO_PDFA_TOOL] as const;
export type PdfArchiveTool = (typeof PDF_ARCHIVE_TOOLS)[number];

export const PDF_ARCHIVE_ENGINE = "ghostscript" as const;
export const PDF_A_STANDARD = "PDF/A-2b" as const;

/**
 * What a PDF/A conversion produced, and what Ghostscript said about producing it.
 *
 * `notes` is non-empty when gs reported something — most importantly, when it
 * DELETED content PDF/A cannot represent. Measured on the production worker
 * (gs 10.00.0, production argv): a one-page PDF with transparency came back with
 * exit 0, a valid file, and two `discarding DOCINFO` lines nobody read.
 */
export interface PdfAConversion {
  bytes: Uint8Array;
  notes: string[];
}

export interface GhostscriptPdfARunner {
  convertToPdfA(
    input: Uint8Array,
    options: { standard: typeof PDF_A_STANDARD },
  ): Promise<PdfAConversion>;
}

export interface PdfArchiveDeps {
  ghostscript?: GhostscriptPdfARunner;
  validate?: (bytes: Uint8Array) => boolean | Promise<boolean>;
  limits?: { maxInputBytes?: number };
}

export interface PdfArchiveResultMeta {
  engine: typeof PDF_ARCHIVE_ENGINE;
  standard: typeof PDF_A_STANDARD;
  inputBytes: number;
  outputBytes: number;
  /**
   * True when Ghostscript reported anything while converting — most often that
   * it removed content PDF/A cannot represent. A separate flag from
   * `notes.length` so a run whose every line was dropped by sanitizing still
   * reads as "something happened" rather than as a clean conversion.
   */
  hadNotes: boolean;
  /** Sanitized Ghostscript output. Empty on a silent run — never `null`. */
  notes: string[];
}

export type PdfArchiveRun =
  | { ok: true; output: Uint8Array; meta: PdfArchiveResultMeta }
  | { ok: false; kind: "unsupported"; message: string }
  | { ok: false; kind: "invalid_pdf"; message: string }
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  | { ok: false; kind: "failed"; message: string };

const unsupported = (): PdfArchiveRun => ({
  ok: false,
  kind: "unsupported",
  message:
    "PDF/A conversion requires the native Ghostscript engine, which is not installed in this environment.",
});

export async function runPdfToPdfA(
  input: Uint8Array,
  deps: PdfArchiveDeps,
): Promise<PdfArchiveRun> {
  if (!deps.ghostscript) return unsupported();
  const limit = deps.limits?.maxInputBytes;
  if (limit !== undefined && input.byteLength > limit) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: limit,
      message:
        "The input PDF exceeds the worker's size limit for PDF/A conversion.",
    };
  }
  const validate = deps.validate ?? looksLikePdf;
  if (!(await validate(input))) {
    return {
      ok: false,
      kind: "invalid_pdf",
      message: "The input could not be read as a PDF.",
    };
  }

  let conversion: PdfAConversion;
  try {
    conversion = await deps.ghostscript.convertToPdfA(input, {
      standard: PDF_A_STANDARD,
    });
  } catch {
    return {
      ok: false,
      kind: "failed",
      message:
        "The PDF/A engine could not process this file. No output was produced.",
    };
  }
  const output = conversion.bytes;
  if (!(await validate(output))) {
    return {
      ok: false,
      kind: "failed",
      message: "The PDF/A engine produced no usable PDF output.",
    };
  }

  // A conversion that discarded something is NOT a failure. The user asked for
  // PDF/A and PDF/A cannot hold what was removed — the file is correct and the
  // removal is inherent to the format. Ship it; tell them what went. This is the
  // opposite call from compression's page loss, and deliberately so: there the
  // output was wrong, here the output is right and incomplete by definition.
  return {
    ok: true,
    output,
    meta: {
      engine: PDF_ARCHIVE_ENGINE,
      standard: PDF_A_STANDARD,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
      hadNotes: conversion.notes.length > 0,
      notes: conversion.notes,
    },
  };
}
