/**
 * The tools the Office-conversion engine owns, as a LEAF module: no imports.
 *
 * They live apart from `engine.ts` (which re-exports them) because the web
 * tier needs to know WHICH tools LibreOffice runs — to state and enforce that
 * engine's per-file ceiling (`@/lib/workers/engine-file-ceilings`) in the
 * upload API and the browser driver — and `engine.ts` pulls pdf-lib in through
 * its output validator. One definition, importable from both tiers.
 */
export const WORD_TO_PDF_TOOL = "word-to-pdf";
export const EXCEL_TO_PDF_TOOL = "excel-to-pdf";
export const POWERPOINT_TO_PDF_TOOL = "powerpoint-to-pdf";
export const OFFICE_TO_PDF_TOOLS = [
  WORD_TO_PDF_TOOL,
  EXCEL_TO_PDF_TOOL,
  POWERPOINT_TO_PDF_TOOL,
] as const;
export type OfficeToPdfTool = (typeof OFFICE_TO_PDF_TOOLS)[number];

/**
 * What each tool's users call the file and the program that saves it. Exported
 * so a page that quotes a refusal names the same command the refusal does, and
 * so the Office panel's drop zone ("Add your workbook, or browse") uses the
 * refusals' noun. Here, in the leaf, because that panel is browser code.
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
