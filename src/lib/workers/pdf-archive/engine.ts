import { looksLikePdf } from "../compression/engine";
import { PDF_A_STANDARD } from "@/lib/jobs/pdfa-results";
import { inspectPdfAMarkers, type PdfAMarkerReport } from "./pdfa-markers";
import { rethrowIfAttemptAbort, signalOption } from "../attempt-abort";

export const PDF_TO_PDFA_TOOL = "pdf-to-pdfa";
export const PDF_ARCHIVE_TOOLS = [PDF_TO_PDFA_TOOL] as const;
export type PdfArchiveTool = (typeof PDF_ARCHIVE_TOOLS)[number];

export const PDF_ARCHIVE_ENGINE = "ghostscript" as const;
export { PDF_A_STANDARD };

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
    options: {
      standard: typeof PDF_A_STANDARD;
      /** The attempt's abort signal; the runner kills its child on abort. */
      signal?: AbortSignal;
    },
  ): Promise<PdfAConversion>;
}

/**
 * WHY a conversion failed, as the runner knows it. Carried as a type rather
 * than a sentence because the retry decision hangs on it.
 *
 * Every Ghostscript failure used to be one bare `throw`, which the engine
 * mapped to one `failed`, which the processor marked `retryable: true`. So an
 * open-password PDF — which Ghostscript cannot read, every time — ran three
 * times and ended in "could not process this file"; and a file that hit the
 * 120 s engine timeout held the single serial worker for about six minutes
 * (3 × 120 s + back-off), stalling every other worker tool for every user.
 * The same bytes fail the same way. Only the failures that are NOT about the
 * bytes — the temp directory, the spawn — are worth a second attempt.
 */
export type GhostscriptFailureReason =
  /** Ghostscript exited non-zero. Deterministic for the same bytes. */
  | "engine_exit"
  /** Killed at the engine timeout. Deterministic enough: a retry costs another full timeout. */
  | "timeout"
  /** Exit 0 but no usable PDF came back. Deterministic. */
  | "bad_output"
  /** The input needs an OPEN password (qpdf `--requires-password` exit 0). */
  | "password_required"
  /** Temp-dir / file I/O on the worker. Not about the bytes: retryable. */
  | "io"
  /** The process could not be started (ENOENT, EAGAIN, …). Not about the bytes: retryable. */
  | "spawn";

export class GhostscriptRunError extends Error {
  constructor(
    readonly reason: GhostscriptFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "GhostscriptRunError";
  }
}

export interface PdfArchiveDeps {
  ghostscript?: GhostscriptPdfARunner;
  validate?: (bytes: Uint8Array) => boolean | Promise<boolean>;
  /**
   * The PDF/A declaration check run on every output before it ships. Defaults
   * to {@link inspectPdfAMarkers}; injectable only so a test can prove the
   * engine consults it.
   */
  inspectOutput?: (bytes: Uint8Array) => Promise<PdfAMarkerReport>;
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

/**
 * Why a `failed` run failed. `transient` is the ONLY retryable reason — see
 * {@link GhostscriptFailureReason} for what it cost when every reason was.
 * `not_pdfa`: the engine returned a PDF that does not declare PDF/A-2b (no
 * `/GTS_PDFA1` OutputIntent, or no XMP `part 2 / B`), which the same argv will
 * reproduce on every attempt.
 */
export type PdfArchiveFailureReason =
  "engine_exit" | "timeout" | "bad_output" | "not_pdfa" | "transient";

export type PdfArchiveRun =
  | { ok: true; output: Uint8Array; meta: PdfArchiveResultMeta }
  | { ok: false; kind: "unsupported"; message: string }
  | { ok: false; kind: "invalid_pdf"; message: string }
  | { ok: false; kind: "password_required"; message: string }
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  | {
      ok: false;
      kind: "failed";
      reason: PdfArchiveFailureReason;
      message: string;
    };

const unsupported = (): PdfArchiveRun => ({
  ok: false,
  kind: "unsupported",
  message:
    "PDF/A conversion requires the native Ghostscript engine and its sRGB colour profile, which are not installed in this environment.",
});

export const PASSWORD_REQUIRED_MESSAGE =
  "This PDF needs a password to open, so it can't be converted as it is. Unlock it first with Unlock PDF, then convert the unlocked copy to PDF/A.";

const FAILURE_MESSAGES: Record<PdfArchiveFailureReason, string> = {
  engine_exit:
    "The PDF/A engine could not process this file. No output was produced.",
  timeout:
    "The PDF/A engine ran out of time on this file, so no output was produced. Very large or complex files can take longer than the worker allows; splitting the file into smaller parts may help.",
  bad_output: "The PDF/A engine produced no usable PDF output.",
  not_pdfa:
    "The converter's output did not carry the PDF/A-2b identification and colour profile an archive checks for, so it was not returned rather than handed to you as PDF/A. No output was produced.",
  transient:
    "The worker hit a temporary problem before the PDF/A engine could finish. No output was produced.",
};

function failed(reason: PdfArchiveFailureReason): PdfArchiveRun {
  return {
    ok: false,
    kind: "failed",
    reason,
    message: FAILURE_MESSAGES[reason],
  };
}

/** Map what the runner threw to a run. An untyped throw is NOT assumed transient. */
function runFailure(error: unknown): PdfArchiveRun {
  if (!(error instanceof GhostscriptRunError)) return failed("engine_exit");
  switch (error.reason) {
    case "password_required":
      return {
        ok: false,
        kind: "password_required",
        message: PASSWORD_REQUIRED_MESSAGE,
      };
    case "io":
    case "spawn":
      return failed("transient");
    default:
      return failed(error.reason);
  }
}

export async function runPdfToPdfA(
  input: Uint8Array,
  deps: PdfArchiveDeps,
  /** The attempt's abort signal, passed to Ghostscript and the qpdf probe. */
  signal?: AbortSignal,
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
      ...signalOption(signal),
    });
  } catch (error) {
    // Not `engine_exit`: an untyped throw would read as the file's fault.
    rethrowIfAttemptAbort(error);
    return runFailure(error);
  }
  const output = conversion.bytes;
  if (!(await validate(output))) return failed("bad_output");

  // The file is about to be handed over as PDF/A-2b. Before this check the only
  // gate was `looksLikePdf` above — a `%PDF-` header — so an output that claimed
  // part 2 in its XMP but carried no OutputIntent (which is what the argv
  // produced until the Ghostscript PDF/A recipe was followed) shipped as a
  // success. A validator at the user's archive would reject it; nothing here
  // could. Refuse instead: no file is better than a false claim.
  const inspect = deps.inspectOutput ?? inspectPdfAMarkers;
  const markers = await inspect(output);
  if (!markers.ok) return failed("not_pdfa");

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
