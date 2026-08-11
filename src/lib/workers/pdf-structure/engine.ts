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
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  | { ok: false; kind: "failed"; message: string };

const UNSUPPORTED_MESSAGE =
  "PDF repair and web optimization require the native qpdf engine, which is not installed in this environment.";
const TOO_LARGE_MESSAGE =
  "The input PDF exceeds the worker's size limit for this operation.";
const INVALID_PDF_MESSAGE = "The input could not be read as a PDF.";
const FAILED_MESSAGE =
  "The PDF structure engine could not process this file. No output was produced.";

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
 * The INPUT floor, chosen by operation.
 *
 * repair-pdf exists to accept damage, so it requires only a header
 * ({@link looksRepairable}). optimize-web promises fast web viewing, not
 * recovery — a damaged file there is honestly refused and the user is pointed at
 * repair, rather than silently handed a repair they did not ask for.
 *
 * Deliberately NOT `deps.validate`: that seam is the OUTPUT validator, and a
 * deployment tightening its output check must not thereby re-close the door on
 * the files repair exists for.
 */
function inputFloor(operation: "repair" | "linearize") {
  return operation === "repair" ? looksRepairable : looksLikePdf;
}

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

  if (!inputFloor(operation)(input)) {
    return {
      ok: false,
      run: { ok: false, kind: "invalid_pdf", message: INVALID_PDF_MESSAGE },
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
  } catch {
    return failed();
  }

  if (!(await validate(result.bytes))) return failed();

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
