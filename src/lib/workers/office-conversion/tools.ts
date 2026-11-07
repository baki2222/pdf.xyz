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
 * What each tool's users call the file: the Office panel's drop zone ("Add
 * your workbook, or browse") and the refusals both use it. Only the noun
 * lives here, in the leaf the browser panel imports. The program names and
 * Protect commands the refusals quote are in ./document-words, which only
 * the server engine and the tool pages read. Measured 2026-11-07: carrying
 * them here put about 120 B gz on every page that loads this leaf (every
 * worker tool page, /status, and the home desk's ticket).
 */
export const DOCUMENT_NOUNS: Record<OfficeToPdfTool, string> = {
  [WORD_TO_PDF_TOOL]: "document",
  [EXCEL_TO_PDF_TOOL]: "workbook",
  [POWERPOINT_TO_PDF_TOOL]: "presentation",
};
