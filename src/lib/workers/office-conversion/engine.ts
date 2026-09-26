import { looksLikePdf } from "../compression/engine";

import {
  EXCEL_TO_PDF_TOOL,
  OFFICE_TO_PDF_TOOLS,
  POWERPOINT_TO_PDF_TOOL,
  WORD_TO_PDF_TOOL,
} from "./native-config";

export {
  WORD_TO_PDF_TOOL,
  EXCEL_TO_PDF_TOOL,
  POWERPOINT_TO_PDF_TOOL,
  OFFICE_TO_PDF_TOOLS,
} from "./native-config";
export type OfficeToPdfTool = (typeof OFFICE_TO_PDF_TOOLS)[number];
export const OFFICE_TO_PDF_ENGINE = "libreoffice" as const;

export interface LibreOfficePdfRunner {
  convertToPdf(input: Uint8Array, filename: string): Promise<Uint8Array>;
}

export interface OfficeConversionDeps {
  libreoffice?: LibreOfficePdfRunner;
  validate?: (bytes: Uint8Array) => boolean | Promise<boolean>;
  limits?: { maxInputBytes?: number; maxOutputBytes?: number };
}

export interface OfficeConversionResultMeta {
  engine: typeof OFFICE_TO_PDF_ENGINE;
  tool: OfficeToPdfTool;
  inputBytes: number;
  outputBytes: number;
}

export type OfficeConversionRun =
  | { ok: true; output: Uint8Array; meta: OfficeConversionResultMeta }
  | { ok: false; kind: "unsupported"; message: string }
  | { ok: false; kind: "invalid_input"; message: string }
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  | { ok: false; kind: "failed"; message: string };

const EXTENSIONS: Record<OfficeToPdfTool, readonly string[]> = {
  [WORD_TO_PDF_TOOL]: ["docx", "doc"],
  [EXCEL_TO_PDF_TOOL]: ["xlsx", "xls", "csv"],
  [POWERPOINT_TO_PDF_TOOL]: ["pptx", "ppt"],
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function supportsOfficeInput(
  tool: OfficeToPdfTool,
  filename: string,
): boolean {
  return EXTENSIONS[tool].includes(extensionOf(filename));
}

export async function runOfficeToPdf(
  tool: OfficeToPdfTool,
  input: Uint8Array,
  filename: string,
  deps: OfficeConversionDeps,
): Promise<OfficeConversionRun> {
  if (!supportsOfficeInput(tool, filename)) {
    return {
      ok: false,
      kind: "invalid_input",
      message:
        "The uploaded file type does not match this Office conversion tool.",
    };
  }
  if (!deps.libreoffice) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "Office to PDF conversion requires the native LibreOffice engine, which is not installed in this environment.",
    };
  }
  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      // Whole megabytes rounded DOWN, so the figure never overstates the cap.
      message: `This document is larger than ${Math.floor(maxInput / (1024 * 1024))} MB, the most the Office converter accepts.`,
    };
  }
  let output: Uint8Array;
  try {
    output = await deps.libreoffice.convertToPdf(input, filename);
  } catch {
    return {
      ok: false,
      kind: "failed",
      message: "LibreOffice could not convert this document to PDF.",
    };
  }
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return {
      ok: false,
      kind: "failed",
      message: "The converted PDF exceeds the worker size limit.",
    };
  }
  const validate = deps.validate ?? looksLikePdf;
  if (!(await validate(output))) {
    return {
      ok: false,
      kind: "failed",
      message: "LibreOffice produced no usable PDF output.",
    };
  }
  return {
    ok: true,
    output,
    meta: {
      engine: OFFICE_TO_PDF_ENGINE,
      tool,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
    },
  };
}
