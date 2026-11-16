/**
 * Summarize PDF's Run-time judgement of ONE extraction (competitor audit
 * summarize-pdf#5): may this document — or the part of it the person chose —
 * be summarized, which pages go on the wire, and how many characters are
 * declared for the charge.
 *
 * A LAZY module: `measureSummarizeRun` in `./summarize-client` imports it
 * with `import()` in PARALLEL with the text extraction, so the page grammar
 * (`parsePageList`) and the wire spans (`./page-spans-option` → responses)
 * never ride Summarize PDF's first load, and Run pays one round trip of
 * chunks, not two. The selection function arrives WITH the extraction
 * (`extractSelectionOnDemand`, its own parallel chunk), so the declaration
 * and the worker's read select through one function.
 *
 * ONE parse decides everything. Until 2026-11-16 the panel parsed the PDF
 * with pdfjs twice per Run (`preflightSummarize`, then
 * `countDeclaredCharacters`); now the preflight refusals, the page check
 * against the page count, the selection and the declaration all read the
 * same extraction, so a range the panel accepted is a range the counted text
 * covers.
 */

import { NO_SELECTABLE_TEXT_MESSAGE } from "@/lib/jobs/ai-no-text";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import type { selectExtraction } from "@/lib/pdf/page-selection";
import {
  NO_TEXT_IN_CHOSEN_PAGES_MESSAGE,
  pagesOutOfRangeSentence,
} from "@/lib/jobs/summarize-pages";
import type { PageSpan } from "@/lib/pdf/page-spans";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { coversEveryPage, typedPageSpans } from "@/lib/pdf/typed-page-spans";

/** What the person chose to summarize. */
export type SummarizeChoice =
  | { kind: "whole" }
  | { kind: "pages"; text: string }
  | { kind: "span"; span: PageSpan };

/** The verdict on one Run. */
export type SummarizeMeasure =
  | { ok: false; code: string; message: string }
  | {
      ok: true;
      /**
       * Characters declared for the charge: the chosen pages' text, or the
       * whole document's. `null` (a count pdfjs could not make) sends the job
       * undeclared, exactly as `countDeclaredCharacters` did.
       */
      declaredCharacters: number | null;
      /**
       * The canonical spans to send, or absent for the whole document. A
       * selection naming EVERY page is sent as the whole document: it reads
       * the same text, is charged exactly what a whole-document run is (no
       * `pages` JSON in the options count), and needs no `summarizePages`
       * admission.
       */
      pages?: PageSpan[];
    };

/** The extraction and the selection function, or what the read threw. */
export type SummarizeReading =
  | {
      ok: true;
      extracted: ExtractedPdfText;
      select: typeof selectExtraction;
    }
  | { ok: false; error: unknown };

const NOTHING_UPLOADED = "Nothing was uploaded.";

/** The pre-upload refusal for a file pdfjs could not open. */
function unreadable(error: unknown): SummarizeMeasure {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "PasswordException")
    return {
      ok: false,
      code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
      message: `This PDF is password-protected. Unlock it with Unlock PDF, then summarize it. ${NOTHING_UPLOADED}`,
    };
  return {
    ok: false,
    code: OFFICE_EXPORT_ERROR_CODES.unreadable,
    message:
      name === "InvalidPDFException"
        ? `This file could not be read as a PDF. If it is one, it may be damaged; Repair PDF can often fix that. ${NOTHING_UPLOADED}`
        : `This PDF could not be read. It may be damaged; Repair PDF can often fix that. ${NOTHING_UPLOADED}`,
  };
}

/** A pages refusal: no tool fixes it, so no next-step link. */
const pagesRefusal = (message: string): SummarizeMeasure => ({
  ok: false,
  code: "invalid_request",
  message: `${message} ${NOTHING_UPLOADED}`,
});

/** `countDeclaredCharacters`'s rule: only a positive integer is declared. */
const declared = (count: number): number | null =>
  Number.isInteger(count) && count > 0 ? count : null;

/**
 * Judge one Run from one extraction. Pure: the extraction is passed in, so
 * the caller decides how (and how many times — once) the PDF is parsed.
 */
export function judgeSummarizeRun(
  reading: SummarizeReading,
  choice: SummarizeChoice,
): SummarizeMeasure {
  if (!reading.ok) return unreadable(reading.error);
  const { extracted, select } = reading;
  if (!extracted.hasText || extracted.text.trim().length === 0)
    return {
      ok: false,
      code: OFFICE_EXPORT_ERROR_CODES.noText,
      // The worker's own sentence (one owner for both sides of the upload,
      // `@/lib/jobs/ai-no-text`), plus what this refusal before upload adds.
      message: `${NO_SELECTABLE_TEXT_MESSAGE["summarize-pdf"]} ${NOTHING_UPLOADED}`,
    };
  if (choice.kind === "whole")
    return { ok: true, declaredCharacters: declared(extracted.characterCount) };

  const pageCount = extracted.pageCount;
  // Every page chosen: the whole document, sent and charged as one.
  const whole: SummarizeMeasure = {
    ok: true,
    declaredCharacters: declared(extracted.characterCount),
  };
  let spans: PageSpan[];
  if (choice.kind === "pages") {
    // The typed text has one author (`@/lib/pdf/typed-page-spans`, shared
    // with Translate since slice 6 of audit #29); it returns `null` for a
    // selection naming every page.
    const typed = typedPageSpans(choice.text, pageCount);
    if (!typed.ok) return pagesRefusal(typed.message);
    if (typed.spans === null) return whole;
    spans = typed.spans;
  } else {
    const [first, last] = choice.span;
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 1 ||
      first > last ||
      last > pageCount
    )
      return pagesRefusal(pagesOutOfRangeSentence(pageCount, choice.span));
    spans = [[first, last]];
    // A section spanning every page is the whole document too: the same
    // rule, from its one author.
    if (coversEveryPage(spans, pageCount)) return whole;
  }

  const selected = select(extracted, spans);
  if (!selected.hasText || selected.text.trim().length === 0)
    return {
      ok: false,
      code: OFFICE_EXPORT_ERROR_CODES.noText,
      message: `${NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["summarize-pdf"]} ${NOTHING_UPLOADED}`,
    };
  return {
    ok: true,
    declaredCharacters: declared(selected.characterCount),
    pages: spans,
  };
}
