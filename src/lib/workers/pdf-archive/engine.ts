import { looksLikePdf } from "../compression/engine";

export const PDF_TO_PDFA_TOOL = "pdf-to-pdfa";
export const PDF_ARCHIVE_TOOLS = [PDF_TO_PDFA_TOOL] as const;
export type PdfArchiveTool = (typeof PDF_ARCHIVE_TOOLS)[number];

export const PDF_ARCHIVE_ENGINE = "ghostscript" as const;
export const PDF_A_STANDARD = "PDF/A-2b" as const;

export interface GhostscriptPdfARunner {
  convertToPdfA(
    input: Uint8Array,
    options: { standard: typeof PDF_A_STANDARD },
  ): Promise<Uint8Array>;
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

  let output: Uint8Array;
  try {
    output = await deps.ghostscript.convertToPdfA(input, {
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
  if (!(await validate(output))) {
    return {
      ok: false,
      kind: "failed",
      message: "The PDF/A engine produced no usable PDF output.",
    };
  }
  return {
    ok: true,
    output,
    meta: {
      engine: PDF_ARCHIVE_ENGINE,
      standard: PDF_A_STANDARD,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
    },
  };
}
