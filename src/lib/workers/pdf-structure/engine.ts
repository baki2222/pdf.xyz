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

import { looksLikePdf } from "../compression/engine";

export const REPAIR_TOOL = "repair-pdf";
export const OPTIMIZE_WEB_TOOL = "optimize-web";
export const PDF_STRUCTURE_TOOLS = [REPAIR_TOOL, OPTIMIZE_WEB_TOOL] as const;
export type PdfStructureTool = (typeof PDF_STRUCTURE_TOOLS)[number];

export const PDF_STRUCTURE_ENGINE = "qpdf" as const;
export type PdfStructureEngine = typeof PDF_STRUCTURE_ENGINE;

export interface QpdfStructureRunner {
  /** Rewrite/recover the input PDF and return the repaired bytes. */
  repair(input: Uint8Array): Promise<Uint8Array>;
  /** Linearize the input PDF for fast web viewing and return the output bytes. */
  linearize(input: Uint8Array): Promise<Uint8Array>;
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

async function preflight(
  input: Uint8Array,
  deps: PdfStructureDeps,
): Promise<{ ok: true } | { ok: false; run: PdfStructureRun }> {
  if (!deps.qpdf) return { ok: false, run: unsupported() };

  const limit = deps.limits?.maxInputBytes;
  if (limit !== undefined && input.byteLength > limit) {
    return {
      ok: false,
      run: { ok: false, kind: "too_large", limitBytes: limit, message: TOO_LARGE_MESSAGE },
    };
  }

  const validate = deps.validate ?? looksLikePdf;
  if (!(await validate(input))) {
    return { ok: false, run: { ok: false, kind: "invalid_pdf", message: INVALID_PDF_MESSAGE } };
  }

  return { ok: true };
}

async function runStructure(
  input: Uint8Array,
  deps: PdfStructureDeps,
  operation: "repair" | "linearize",
): Promise<PdfStructureRun> {
  const pre = await preflight(input, deps);
  if (!pre.ok) return pre.run;

  const qpdf = deps.qpdf!;
  const validate = deps.validate ?? looksLikePdf;
  let output: Uint8Array;
  try {
    output = operation === "repair" ? await qpdf.repair(input) : await qpdf.linearize(input);
  } catch {
    return failed();
  }

  if (!(await validate(output))) return failed();

  return {
    ok: true,
    output,
    meta: {
      engine: PDF_STRUCTURE_ENGINE,
      operation,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
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
