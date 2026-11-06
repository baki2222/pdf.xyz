import { looksLikePdf } from "../compression/engine";
import { describeByteCeiling } from "../engine-file-ceilings";
import {
  isEncryptedOdf,
  isEncryptedOoxml,
  LibreOfficeRunError,
} from "./errors";
import { officeContentRefusal, SIGNED_OFFICE_INPUTS } from "./input-content";
import {
  rethrowIfAttemptAbort,
  signalOption,
  type RunControl,
} from "../attempt-abort";
import {
  EXCEL_TO_PDF_TOOL,
  POWERPOINT_TO_PDF_TOOL,
  WORD_TO_PDF_TOOL,
  type OfficeToPdfTool,
} from "./tools";

export {
  EXCEL_TO_PDF_TOOL,
  OFFICE_TO_PDF_TOOLS,
  POWERPOINT_TO_PDF_TOOL,
  WORD_TO_PDF_TOOL,
  type OfficeToPdfTool,
} from "./tools";
export const OFFICE_TO_PDF_ENGINE = "libreoffice" as const;

export interface LibreOfficePdfRunner {
  convertToPdf(
    input: Uint8Array,
    filename: string,
    run?: RunControl,
  ): Promise<Uint8Array>;
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
  /** Needs a password to open: an encrypted OOXML or OpenDocument package. Final. */
  | { ok: false; kind: "password_protected"; message: string }
  /** LibreOffice could not load it, or wrote no usable PDF. Final. */
  | { ok: false; kind: "unreadable"; message: string }
  /** Hit the conversion timeout. Final: the same bytes time out again. */
  | { ok: false; kind: "timeout"; message: string }
  /** A run that did not finish for reasons outside the document. Retryable. */
  | { ok: false; kind: "failed"; message: string };

/**
 * What each tool's users call the file and the program that saves it. Exported
 * so a page that quotes a refusal names the same command the refusal does.
 */
export const DOCUMENT_WORDS: Record<
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

/**
 * Where an OpenDocument file's password comes off: LibreOffice saves a copy
 * without one from Save As. Exported for the pages that quote the refusal.
 */
export const ODF_PASSWORD_REMOVAL = {
  app: "LibreOffice",
  steps: "File > Save As, saving a copy without its password",
} as const;

/**
 * The extensions each tool passes to LibreOffice. Exported for the tests that
 * hold it equal to the catalogue's `accept` row and walk it for the content
 * check. OpenDocument and RTF joined on 2026-11-04.
 */
export const OFFICE_INPUT_EXTENSIONS: Record<
  OfficeToPdfTool,
  readonly string[]
> = {
  [WORD_TO_PDF_TOOL]: ["docx", "doc", "odt", "rtf"],
  [EXCEL_TO_PDF_TOOL]: ["xlsx", "xls", "csv", "ods"],
  [POWERPOINT_TO_PDF_TOOL]: ["pptx", "ppt", "odp"],
};

/**
 * The words of the "could not be converted" advice, by the INPUT's extension.
 *
 * Until 2026-11-06 (audit #40) the advice was DOCUMENT_WORDS[tool] for every
 * input, so a damaged .odt or .rtf was told to open it in Word and "save it
 * again as .docx", an .ods to use Excel and .xlsx, an .odp PowerPoint and
 * .pptx. The extensions whose bytes say the file is NOT a Microsoft format —
 * the content-checked ones, `SIGNED_OFFICE_INPUTS` — now get their own: an
 * OpenDocument file goes back to LibreOffice (or the app that saved it) as
 * its own type, with the password route `ODF_PASSWORD_REMOVAL` names; an RTF
 * file, which cannot carry a password, back to the app that saved it. A
 * Microsoft format, legacy or current, keeps the tool's words.
 */
function resaveAdvice(tool: OfficeToPdfTool, ext: string): string {
  const signed = SIGNED_OFFICE_INPUTS[ext];
  if (signed?.format === "RTF")
    return `Open it in the app that saved it, save it again as .${ext}, and retry.`;
  if (signed)
    return `If it is password-protected, open it in ${ODF_PASSWORD_REMOVAL.app} (or the app that saved it) and choose ${ODF_PASSWORD_REMOVAL.steps}; otherwise open it there, save it again as .${ext}, and retry.`;
  const words = DOCUMENT_WORDS[tool];
  return `If it is password-protected, remove the password in ${words.app} and try again; otherwise open it in ${words.app}, save it again as ${words.ext}, and retry.`;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function supportsOfficeInput(
  tool: OfficeToPdfTool,
  filename: string,
): boolean {
  return OFFICE_INPUT_EXTENSIONS[tool].includes(extensionOf(filename));
}

export async function runOfficeToPdf(
  tool: OfficeToPdfTool,
  input: Uint8Array,
  filename: string,
  deps: OfficeConversionDeps,
  /** The attempt's abort signal, passed to LibreOffice. */
  signal?: AbortSignal,
): Promise<OfficeConversionRun> {
  if (!supportsOfficeInput(tool, filename)) {
    return {
      ok: false,
      kind: "invalid_input",
      message:
        "The uploaded file type does not match this Office conversion tool.",
    };
  }
  // Before LibreOffice, which converts by CONTENT: a spreadsheet named .odt
  // would otherwise come back from Word to PDF as a laid-out spreadsheet.
  const mismatch = officeContentRefusal(extensionOf(filename), input);
  if (mismatch !== null)
    return { ok: false, kind: "invalid_input", message: mismatch };
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
      // The number, not just the fact: the page stated one before the upload,
      // and a refusal that cannot be compared with it reads as a broken tool.
      message: `This document is larger than ${describeByteCeiling(maxInput)}, the most Office to PDF converts per file.`,
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
  // A locked OpenDocument file is still a readable ZIP with its own type
  // first, so the content check passes it; soffice then exits 0 with no PDF.
  if (isEncryptedOdf(input)) {
    return {
      ok: false,
      kind: "password_protected",
      message: `This ${words.noun} is password-protected. Open it in ${ODF_PASSWORD_REMOVAL.app} (or the app that saved it), choose ${ODF_PASSWORD_REMOVAL.steps}, and convert the copy.`,
    };
  }
  const unreadable: OfficeConversionRun = {
    ok: false,
    kind: "unreadable",
    message: `This ${words.noun} could not be converted. ${resaveAdvice(tool, extensionOf(filename))}`,
  };
  let output: Uint8Array;
  try {
    output = await deps.libreoffice.convertToPdf(
      input,
      filename,
      signalOption(signal),
    );
  } catch (error) {
    rethrowIfAttemptAbort(error);
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
