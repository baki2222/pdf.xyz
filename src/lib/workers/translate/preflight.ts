/**
 * What the Translate panel decides BEFORE anything is uploaded or charged.
 *
 * The panel extracts the text in the browser and refuses a document the worker
 * could never translate, because the daily AI allowance is consumed when the
 * job is created and the worker's own refusal cannot give it back. That check
 * is only worth having if it refuses for the RIGHT reason, and it did not:
 *
 *   `nothingFits = plan.chunks.length === 0` → "too long, split the file"
 *
 * "No chunks" has two causes and that line read both as one. A scanned PDF has
 * no text pages, so it also has no chunks — and was told it held "0 characters
 * of text" and should be split into smaller files. A single page larger than
 * one pass also has no chunks — and was told to split a file whose pages are
 * already the smallest unit translate will split at. Neither message could
 * help, and the first is the most common thing people try to translate.
 *
 * So the causes are told apart here, in the order the worker tells them apart
 * (`engine.ts`: no text → nothing deliverable → too long), and each gets the
 * sentence the worker would have said. It is a pure function over the
 * extraction so the decision can be run against a REAL extraction of a real
 * image-only PDF, not against a hand-built picture of what a scan looks like.
 */

import type { PageSpan } from "@/lib/pdf/page-spans";
import { pageTextChunks, type ExtractedPdfText } from "@/lib/pdf/text";
import {
  TRANSLATE_NO_TEXT_MESSAGE,
  translateEveryPageTooLongMessage,
  translateTooLongMessage,
} from "@/lib/jobs/translate-limits";
import { planTranslateChunks, type TranslatePlan } from "./chunking";

export interface TranslatePreflight {
  /**
   * The page blocks the worker will chunk — computed once, so the refusal and
   * the page count declared with the job describe the same document.
   */
  readonly textPages: { pageNumber: number; text: string }[];
  readonly plan: TranslatePlan;
  /** Why the document must not be submitted, or `null` when it may be. */
  readonly refusal: string | null;
}

export function translatePreflight(
  extracted: Pick<ExtractedPdfText, "pages" | "hasText" | "characterCount">,
  ceiling: number,
  /**
   * Whose pages `extracted` holds: "document" (the default, every caller that
   * checks a whole document) or "chosen" (a page selection), passed through
   * to the every-page-oversize sentence, which names its object.
   */
  scope: "document" | "chosen" = "document",
): TranslatePreflight {
  const textPages = pageTextChunks(extracted.pages);
  const plan = planTranslateChunks(textPages, ceiling);
  const noPageStructure = extracted.pages.length === 0;

  // NO TEXT FIRST, exactly as the worker orders it. Both conditions, because
  // they are computed differently — `hasText` from the joined text, the pages
  // from per-page normalisation — and the worker refuses on either.
  if (!extracted.hasText || (!noPageStructure && textPages.length === 0)) {
    return { textPages, plan, refusal: TRANSLATE_NO_TEXT_MESSAGE };
  }

  // NO PAGE STRUCTURE ⇒ NO SAFE SPLIT, so the whole-document ceiling is the
  // only honest bound — and the only case where "split the file" is advice
  // that can work.
  if (noPageStructure) {
    return {
      textPages,
      plan,
      refusal:
        extracted.characterCount > ceiling
          ? translateTooLongMessage(extracted.characterCount, ceiling)
          : null,
    };
  }

  // Every text page is accounted for as a chunk or as oversize (the planner's
  // conservation property), so no chunks with text present means every text
  // page is oversize. The second condition keeps a planner defect from being
  // reported as a sentence about the user's document.
  if (plan.chunks.length === 0 && plan.oversize.length > 0) {
    return {
      textPages,
      plan,
      refusal: translateEveryPageTooLongMessage(plan.oversize, ceiling, scope),
    };
  }

  return { textPages, plan, refusal: null };
}

/** What `declareTranslateRun` decided: the preflight of the counted pages, and the declaration. */
export interface TranslateRunDeclaration extends TranslatePreflight {
  /** The chosen spans sent as `pages`, or null for the whole document. */
  readonly pages: PageSpan[] | null;
  /**
   * The fields the job is created with, spread into `runWorkerTranslate`'s
   * input as they stand: the counts, and `pages` only when a selection
   * exists (a whole-document run carries no `pages` key).
   */
  readonly declared: {
    readonly declaredCharacters: number;
    readonly declaredTextPages: number;
    readonly pages?: PageSpan[];
  };
}

/**
 * THE PANEL'S RUN-TIME DECLARATION, one author for the Translate panel's Run
 * (`translate-worker-panel.tsx`) and the composed chain that proves it
 * (`src/tests/translate-page-range-chain.ts`, driven by
 * `translate-page-range.chain.test.ts` and
 * `translate-page-range.property.test.ts`).
 *
 * WHY IT IS A FUNCTION (review, 2026-11-16): the chain harness used to type
 * this step itself — `declaredCharacters = selected.characterCount`,
 * `declaredTextPages = preflight.textPages.length` — a copy of the panel's
 * two lines. A panel that declared the WHOLE document (M6) or the whole
 * document's text pages (M11) then turned only the panel test red; the chain
 * and the property, whose job is exactly "the charge equals the chosen
 * pages", stayed green, because they ran their own copy. Both now call this.
 *
 * `judged` is the lazy measure's answer (`judgeTranslatePages`), or null when
 * the Pages field was empty (or not offered): the whole document, today's
 * run byte for byte. Everything returned reads ONE object, the counted
 * pages, so the refusal, the declared counts and the wait budget (from
 * `plan`) describe the pages the worker will walk (D14). The every-page-
 * oversize sentence names its object: "chosen" only for a real selection.
 */
export function declareTranslateRun(
  document: ExtractedPdfText,
  judged: {
    readonly pages: PageSpan[] | null;
    readonly selected: ExtractedPdfText;
  } | null,
  ceiling: number,
): TranslateRunDeclaration {
  const pages = judged?.pages ?? null;
  const counted = judged ? judged.selected : document;
  const preflight = translatePreflight(
    counted,
    ceiling,
    pages ? "chosen" : "document",
  );
  return {
    ...preflight,
    pages,
    declared: {
      // The count the panel extracted, so the job reserves what it will use.
      declaredCharacters: counted.characterCount,
      // PAGES WITH TEXT, not the page count: blank and image-only pages are
      // dropped before chunking, and this bound is meant to be exact.
      declaredTextPages: preflight.textPages.length,
      ...(pages ? { pages } : {}),
    },
  };
}
