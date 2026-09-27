import { looksLikePdf } from "../compression/engine";
import { isEncryptedOoxml, LibreOfficeRunError } from "./errors";

export const WORD_TO_PDF_TOOL = "word-to-pdf";
export const EXCEL_TO_PDF_TOOL = "excel-to-pdf";
export const POWERPOINT_TO_PDF_TOOL = "powerpoint-to-pdf";
export const OFFICE_TO_PDF_TOOLS = [
  WORD_TO_PDF_TOOL,
  EXCEL_TO_PDF_TOOL,
  POWERPOINT_TO_PDF_TOOL,
] as const;
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
  /** Needs a password to open: an encrypted OOXML package. Final. */
  | { ok: false; kind: "password_protected"; message: string }
  /** LibreOffice could not load it, or wrote no usable PDF. Final. */
  | { ok: false; kind: "unreadable"; message: string }
  /** Hit the conversion timeout. Final: the same bytes time out again. */
  | { ok: false; kind: "timeout"; message: string }
  /** A run that did not finish for reasons outside the document. Retryable. */
  | { ok: false; kind: "failed"; message: string };

/** What each tool's users call the file and the program that saves it. */
const DOCUMENT_WORDS: Record<
  OfficeToPdfTool,
  { noun: string; app: string; ext: string; protect: string }
> = {
  [WORD_TO_PDF_TOOL]: {
    noun: "document",
    app: "Word",
    ext: ".docx",
    protect: "File > Info > Protect Document",
  },
  [EXCEL_TO_PDF_TOOL]: {
    noun: "workbook",
    app: "Excel",
    ext: ".xlsx",
    protect: "File > Info > Protect Workbook",
  },
  [POWERPOINT_TO_PDF_TOOL]: {
    noun: "presentation",
    app: "PowerPoint",
    ext: ".pptx",
    protect: "File > Info > Protect Presentation",
  },
};

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
      message: "The Office input exceeds the worker's size limit.",
    };
  }
  const words = DOCUMENT_WORDS[tool];
  // Checked before LibreOffice runs: a locked package cannot convert, and
  // soffice's answer to one is an empty exit that says nothing about why.
  if (isEncryptedOoxml(input)) {
    return {
      ok: false,
      kind: "password_protected",
      message: `This ${words.noun} is password-protected. Remove the password in ${words.app} (${words.protect}), save it, and try again.`,
    };
  }
  const unreadable: OfficeConversionRun = {
    ok: false,
    kind: "unreadable",
    message: `This ${words.noun} could not be converted. If it is password-protected, remove the password in ${words.app} and try again; otherwise open it in ${words.app}, save it again as ${words.ext}, and retry.`,
  };
  let output: Uint8Array;
  try {
    output = await deps.libreoffice.convertToPdf(input, filename);
  } catch (error) {
    if (!(error instanceof LibreOfficeRunError))
      return {
        ok: false,
        kind: "failed",
        message: "LibreOffice could not convert this document to PDF.",
      };
    switch (error.reason) {
      case "timeout":
        return {
          ok: false,
          kind: "timeout",
          message: `This ${words.noun} took too long to convert. Try splitting it into smaller files or reducing large embedded images and media, then try again.`,
        };
      case "too_large":
        return {
          ok: false,
          kind: "too_large",
          limitBytes: deps.limits?.maxOutputBytes ?? 0,
          message: "The converted PDF exceeds the worker size limit.",
        };
      default:
        return unreadable;
    }
  }
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxOutput,
      message: "The converted PDF exceeds the worker size limit.",
    };
  }
  const validate = deps.validate ?? looksLikePdf;
  if (!(await validate(output))) return unreadable;
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
