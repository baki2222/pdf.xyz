import {
  DOCUMENT_NOUNS,
  EXCEL_TO_PDF_TOOL,
  POWERPOINT_TO_PDF_TOOL,
  WORD_TO_PDF_TOOL,
  type OfficeToPdfTool,
} from "./tools";

/**
 * What each tool's users call the file and the program that saves it, for
 * the server engine's refusals and the tool pages that quote them, so a page
 * names the same command the refusal does. The noun comes from the browser
 * leaf (./tools DOCUMENT_NOUNS), so the drop zone and the refusals cannot
 * drift apart.
 */
export const DOCUMENT_WORDS: Record<
  OfficeToPdfTool,
  { noun: string; app: string; ext: string; protect: string }
> = {
  [WORD_TO_PDF_TOOL]: {
    noun: DOCUMENT_NOUNS[WORD_TO_PDF_TOOL],
    app: "Word",
    ext: ".docx",
    protect: "File > Info > Protect Document",
  },
  [EXCEL_TO_PDF_TOOL]: {
    noun: DOCUMENT_NOUNS[EXCEL_TO_PDF_TOOL],
    app: "Excel",
    ext: ".xlsx",
    protect: "File > Info > Protect Workbook",
  },
  [POWERPOINT_TO_PDF_TOOL]: {
    noun: DOCUMENT_NOUNS[POWERPOINT_TO_PDF_TOOL],
    app: "PowerPoint",
    ext: ".pptx",
    protect: "File > Info > Protect Presentation",
  },
};
