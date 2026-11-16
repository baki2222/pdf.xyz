/**
 * Translate PDF's Run-time judgement of the pages the person typed
 * (competitor audit #29, slice 6): which pages go on the wire, and which
 * part of the ONE extraction the panel already holds is counted, checked and
 * declared for them.
 *
 * A LAZY module: the panel imports it with `import()` only when the Pages
 * field holds text at Run, started BEFORE the extraction is awaited (the
 * lazy-chunk waterfall rule), so the page grammar (`parsePageList`), the wire
 * spans and the selection function never ride Translate PDF's first load and
 * an empty field fetches nothing new.
 *
 * ONE extraction for everything (D14). The panel parses the PDF once per file
 * (`extractionFor`); the page check reads that extraction's page count, and
 * the preflight, the declaration and the wait budget read the selection
 * returned here, so a range the panel accepted is a range the counted text
 * covers, and the worker walks the same pages under the cap it was charged.
 *
 * `page-selection` and `typed-page-spans` are imported by the SAME
 * specifiers Summarize's lazy measure and `selection-lazy` use: one
 * definition each. The bundler does NOT emit them as one shared async chunk
 * (measured 2026-11-16 on the merged build): both are small enough that
 * webpack's async split minimum keeps them inlined, so `typed-page-spans`
 * and `../jobs/chosen-pages-no-text` sit in both tools' measure chunks and
 * `page-selection` in this chunk and in Summarize's selection chunk. No page
 * fetches two of those chunks (each is one tool's Run), and a shared chunk
 * would add a request to every Run, so it is not forced; bundle-budget's S6
 * entry records the bytes.
 */

import { NO_TEXT_IN_CHOSEN_PAGES_MESSAGE } from "@/lib/jobs/chosen-pages-no-text";
import {
  TRANSLATE_MAX_INPUT_CHARS,
  TRANSLATE_NO_TEXT_MESSAGE,
} from "@/lib/jobs/translate-limits";
import { selectExtraction } from "@/lib/pdf/page-selection";
import type { PageSpan } from "@/lib/pdf/page-spans";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { typedPageSpans } from "@/lib/pdf/typed-page-spans";
import { translatePreflight } from "./translate/preflight";

const NOTHING_UPLOADED = "Nothing was uploaded.";

/** The verdict on the typed pages. */
export type TranslatePagesJudgement =
  | { ok: false; message: string }
  | {
      ok: true;
      /**
       * The canonical spans to send, or `null` for the whole document (an
       * empty field never reaches here; a selection naming every page is the
       * whole document: no `pages` key, no admission, today's charge).
       */
      pages: PageSpan[] | null;
      /** The extraction the run counts, checks and declares: the selection. */
      selected: ExtractedPdfText;
    };

/**
 * Judge `text` against `extracted`. Pure: the panel passes the extraction it
 * already holds. A refusal is the grammar's own sentence (or the chosen-pages
 * no-text sentence), plus that nothing was uploaded.
 */
export function judgeTranslatePages(
  extracted: ExtractedPdfText,
  text: string,
): TranslatePagesJudgement {
  const typed = typedPageSpans(text, extracted.pageCount);
  if (!typed.ok)
    return { ok: false, message: `${typed.message} ${NOTHING_UPLOADED}` };
  if (typed.spans === null)
    return { ok: true, pages: null, selected: extracted };
  const selected = selectExtraction(extracted, typed.spans);
  // Chosen pages without text in a document WITH text: say so about the
  // choice. A document with no text at all keeps the panel's own refusal
  // (the scan path), so the whole document's verdict decides the branch.
  if (
    translatePreflight(selected, TRANSLATE_MAX_INPUT_CHARS, "chosen")
      .refusal === TRANSLATE_NO_TEXT_MESSAGE &&
    translatePreflight(extracted, TRANSLATE_MAX_INPUT_CHARS).refusal !==
      TRANSLATE_NO_TEXT_MESSAGE
  )
    return {
      ok: false,
      message: `${NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["translate-pdf"]} ${NOTHING_UPLOADED}`,
    };
  return { ok: true, pages: typed.spans, selected };
}
