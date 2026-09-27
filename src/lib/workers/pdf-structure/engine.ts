/**
 * PDF structure engine — qpdf-backed repair and web-optimization operations.
 *
 * This powers two secure-worker tools:
 *  - `repair-pdf`: rewrite/recover a PDF through qpdf's structural parser/writer;
 *  - `optimize-web`: linearize a PDF for fast web viewing/progressive loading.
 *
 * Honesty rules mirror the other worker engines: qpdf is injected, absent qpdf is
 * an explicit `unsupported` result, outputs are structurally validated before
 * success, and failures are fixed/content-free (no filenames, paths, or qpdf text).
 */

import { looksLikePdf, looksRepairable } from "../compression/engine";
import { isLinearized } from "@/lib/pdf/linearization";
import { QpdfRefusedError } from "./errors";

export const REPAIR_TOOL = "repair-pdf";
export const OPTIMIZE_WEB_TOOL = "optimize-web";
export const PDF_STRUCTURE_TOOLS = [REPAIR_TOOL, OPTIMIZE_WEB_TOOL] as const;
export type PdfStructureTool = (typeof PDF_STRUCTURE_TOOLS)[number];

export const PDF_STRUCTURE_ENGINE = "qpdf" as const;
export type PdfStructureEngine = typeof PDF_STRUCTURE_ENGINE;

/**
 * What a qpdf run produced: the bytes, and what qpdf said about getting there.
 *
 * `warnings` is non-empty when qpdf exited 3 — its documented "warnings issued,
 * output produced" status, which for a damaged file IS a successful recovery.
 * The lines are sanitized in `native.ts` before they reach here; nothing that
 * arrives is a path, a filename, or document content.
 */
export interface QpdfStructureOutput {
  bytes: Uint8Array;
  warnings: string[];
}

export interface QpdfStructureRunner {
  /** Rewrite/recover the input PDF and return the repaired bytes. */
  repair(input: Uint8Array): Promise<QpdfStructureOutput>;
  /** Linearize the input PDF for fast web viewing and return the output bytes. */
  linearize(input: Uint8Array): Promise<QpdfStructureOutput>;
}

export interface PdfStructureLimits {
  maxInputBytes?: number;
}

export interface PdfStructureDeps {
  qpdf?: QpdfStructureRunner;
  validate?: (bytes: Uint8Array) => boolean | Promise<boolean>;
  limits?: PdfStructureLimits;
}

export interface PdfStructureResultMeta {
  engine: PdfStructureEngine;
  operation: "repair" | "linearize";
  inputBytes: number;
  outputBytes: number;
  /**
   * True when qpdf recovered the document but had something to say about it.
   * A separate boolean from `warnings.length > 0` so a UI can distinguish
   * "clean" from "recovered with warnings" without inspecting the list.
   */
  recoveredWithWarnings: boolean;
  /** Sanitized qpdf warning lines. Empty on a clean run — never `null`. */
  warnings: string[];
}

export type PdfStructureRun =
  | { ok: true; output: Uint8Array; meta: PdfStructureResultMeta }
  | { ok: false; kind: "unsupported"; message: string }
  | { ok: false; kind: "invalid_pdf"; message: string }
  /**
   * optimize-web only: a PDF header, but no `%%EOF` trailer — a file cut off
   * in transit. Final, and named apart from `invalid_pdf` because Repair PDF
   * takes exactly this file, while bytes with no header go nowhere.
   */
  | { ok: false; kind: "damaged"; message: string }
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  /** qpdf needs a password to open it. Final: a retry gets the same answer. */
  | { ok: false; kind: "password_protected"; message: string }
  /** qpdf refused the document for any other reason. Final, likewise. */
  | { ok: false; kind: "unreadable"; message: string }
  /** The run did not finish (timeout, spawn/IO error, unusable output). */
  | { ok: false; kind: "failed"; message: string };

const UNSUPPORTED_MESSAGE =
  "PDF repair and web optimization require the native qpdf engine, which is not installed in this environment.";
const TOO_LARGE_MESSAGE =
  "The input PDF exceeds the worker's size limit for this operation.";
const INVALID_PDF_MESSAGE = "The input could not be read as a PDF.";
const DAMAGED_MESSAGE =
  "This PDF looks damaged or incomplete: its end is missing, so it may have been cut off. Repair PDF can often rebuild it; then optimize the repaired file.";
const FAILED_MESSAGE =
  "The PDF structure engine could not process this file. No output was produced.";

/**
 * What a user reads when qpdf refuses the document, by operation. Fixed and
 * content-free like every message here — no filename, no qpdf text. Repair
 * does not point at itself: the file has just been through the repair.
 */
const REFUSAL_MESSAGES: Record<
  "repair" | "linearize",
  Record<"password_protected" | "unreadable", string>
> = {
  repair: {
    password_protected:
      "This PDF is password-protected. Remove the password with Unlock PDF, then repair it.",
    unreadable:
      "This file could not be rebuilt into a PDF. It may be too badly damaged to recover, or not be a PDF at all.",
  },
  linearize: {
    password_protected:
      "This PDF is password-protected. Remove the password with Unlock PDF, then optimize it.",
    unreadable:
      "This PDF could not be opened. It may be damaged; Repair PDF can often fix that.",
  },
};

function refused(
  error: QpdfRefusedError,
  operation: "repair" | "linearize",
): PdfStructureRun {
  const kind =
    error.reason === "password_protected" ? "password_protected" : "unreadable";
  return { ok: false, kind, message: REFUSAL_MESSAGES[operation][kind] };
}

const unsupported = (): PdfStructureRun => ({
  ok: false,
  kind: "unsupported",
  message: UNSUPPORTED_MESSAGE,
});

const failed = (): PdfStructureRun => ({
  ok: false,
  kind: "failed",
  message: FAILED_MESSAGE,
});

/**
 * The INPUT floors, by operation. What each one actually does:
 *
 *  - Every operation needs a `%PDF-` header ({@link looksRepairable}). Without
 *    one there is no document, and the answer is `invalid_pdf` — which names no
 *    other tool, because Repair PDF refuses the same bytes.
 *  - repair-pdf needs nothing more: it exists to accept damage.
 *  - optimize-web also needs the `%%EOF` trailer ({@link looksLikePdf}). A file
 *    with a header and no trailer was cut off; it is refused as `damaged`, and
 *    that message and its error code send the user to Repair PDF.
 *
 * What this floor does NOT do is catch damage behind an intact trailer (a
 * broken xref, bad offsets). Those files reach qpdf, which rebuilds them and
 * says so with exit 3; the warnings travel on the result for BOTH operations,
 * and the optimize panel shows them. Until 2026-09-27 this docblock said a
 * damaged file on optimize-web "is honestly refused and the user is pointed at
 * repair": the pointer did not exist, and a file qpdf reconstructed was
 * delivered with its warnings dropped.
 *
 * Deliberately NOT `deps.validate`: that seam is the OUTPUT validator, and a
 * deployment tightening its output check must not thereby re-close the door on
 * the files repair exists for.
 */
async function preflight(
  input: Uint8Array,
  deps: PdfStructureDeps,
  operation: "repair" | "linearize",
): Promise<{ ok: true } | { ok: false; run: PdfStructureRun }> {
  if (!deps.qpdf) return { ok: false, run: unsupported() };

  const limit = deps.limits?.maxInputBytes;
  if (limit !== undefined && input.byteLength > limit) {
    return {
      ok: false,
      run: {
        ok: false,
        kind: "too_large",
        limitBytes: limit,
        message: TOO_LARGE_MESSAGE,
      },
    };
  }

  if (!looksRepairable(input)) {
    return {
      ok: false,
      run: { ok: false, kind: "invalid_pdf", message: INVALID_PDF_MESSAGE },
    };
  }
  if (operation === "linearize" && !looksLikePdf(input)) {
    return {
      ok: false,
      run: { ok: false, kind: "damaged", message: DAMAGED_MESSAGE },
    };
  }

  return { ok: true };
}

async function runStructure(
  input: Uint8Array,
  deps: PdfStructureDeps,
  operation: "repair" | "linearize",
): Promise<PdfStructureRun> {
  const pre = await preflight(input, deps, operation);
  if (!pre.ok) return pre.run;

  const qpdf = deps.qpdf!;
  // The OUTPUT is still held to the strict check. Accepting a damaged input is
  // not the same as accepting a damaged result, and conflating the two is how
  // "we repaired it" becomes a claim about rubble.
  const validate = deps.validate ?? looksLikePdf;
  let result: QpdfStructureOutput;
  try {
    result =
      operation === "repair"
        ? await qpdf.repair(input)
        : await qpdf.linearize(input);
  } catch (error) {
    // A classified refusal is a property of the document and must stay one.
    // This was a bare `catch {}` mapping every throw to `failed` — the kind the
    // processor retries — so a locked PDF was run three times.
    if (error instanceof QpdfRefusedError) return refused(error, operation);
    return failed();
  }

  if (!(await validate(result.bytes))) return failed();
  // Optimize for Web promises one property. A well-formed file without it is
  // not a web-optimized PDF, whatever produced it, so it is not delivered —
  // the check stands where the user's job is, not only in the operator's proof.
  if (operation === "linearize" && !isLinearized(result.bytes)) return failed();

  return {
    ok: true,
    output: result.bytes,
    meta: {
      engine: PDF_STRUCTURE_ENGINE,
      operation,
      inputBytes: input.byteLength,
      outputBytes: result.bytes.byteLength,
      recoveredWithWarnings: result.warnings.length > 0,
      warnings: result.warnings,
    },
  };
}

export function runRepair(
  input: Uint8Array,
  deps: PdfStructureDeps,
): Promise<PdfStructureRun> {
  return runStructure(input, deps, "repair");
}

export function runOptimizeWeb(
  input: Uint8Array,
  deps: PdfStructureDeps,
): Promise<PdfStructureRun> {
  return runStructure(input, deps, "linearize");
}
