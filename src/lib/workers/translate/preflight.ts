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
      refusal: translateEveryPageTooLongMessage(plan.oversize, ceiling),
    };
  }

  return { textPages, plan, refusal: null };
}
