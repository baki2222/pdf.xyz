/**
 * "Recognise text in scans (OCR)" on the PDF to Office exports, per tool:
 * which exports offer it and what the switch's hint says for each. Its own
 * module (2026-11-08, audit pdf-to-excel#2) so only the export panel and the
 * export tool pages import it: nothing first-load or shared grows.
 *
 * The worker runs the OCR PDF processor on the file (OCRmyPDF, which keeps
 * pages that already have text) and converts the searchable PDF it returns,
 * in one job (`workers/processor/pdf-office-export.ts`, `OCR_FIRST_TOOLS`,
 * which the chain test holds to this list).
 */
import { WORD_OCR_HINT } from "./pdf-office-export";

/** The exports whose panel offers the OCR switch. */
export const OFFICE_OCR_TOOLS = ["pdf-to-word", "pdf-to-excel"] as const;
export type OfficeOcrTool = (typeof OFFICE_OCR_TOOLS)[number];

export function offersOfficeOcr(tool: string): tool is OfficeOcrTool {
  return (OFFICE_OCR_TOOLS as readonly string[]).includes(tool);
}

/** The switch's hint, per export: what the file gains from the OCR pass. */
export const OFFICE_OCR_HINTS: Record<OfficeOcrTool, string> = {
  "pdf-to-word": WORD_OCR_HINT,
  "pdf-to-excel":
    "Runs OCR on our secure server first, in the languages you pick, then converts, all in one job. Recognised words are placed into cells by where they sit on the page; pages that already have text are kept as they are.",
};
