/**
 * The shapes of Summarize PDF's page-choice advertisement (PR 5b), and the
 * sentences that shipped carrying it — the vocabulary for
 * `./summarize-page-choice.test.ts` and the `summarizePages` subject in
 * `./capability-hedges.test.ts`. Not imported by product code.
 *
 * RULE 1, BOTH DIRECTIONS: every sentence in {@link SUMMARIZE_PAGE_CHOICE_SHIPPED}
 * is caught by some shape, and every shape catches one of them. The test
 * also holds the shipped list EQUAL to what the catalogue serves, so the
 * list cannot go stale in either direction: a served sentence no entry
 * names is red, and so is an entry nothing serves any more.
 *
 * WHAT THIS CANNOT SEE: an advertisement in words no shape knows ("pick a
 * chapter", "a range of pages"). The served-equals-shipped check reads only
 * sentences some shape matches, so a new spelling is invisible to it. The
 * capability-hedges subject is the other net for those, and it has the
 * same blind spot.
 */
import { SUMMARIZE_PAGE_CHOICE } from "./summarize-page-choice";

export interface PageChoiceShape {
  readonly name: string;
  readonly pattern: RegExp;
}

export const SUMMARIZE_PAGE_CHOICE_SHAPES: readonly PageChoiceShape[] = [
  {
    name: "the advertisement",
    pattern: /\bchoose pages or a bookmarked section\b/i,
  },
  {
    name: "the FAQ question",
    pattern: /\bsummar\w* only some pages\b/i,
  },
  {
    name: "only the chosen part is read",
    pattern: /\bonly the part you choose\b/i,
  },
];

/**
 * Verbatim, as first served on 2026-11-16, with where. The advertisement's
 * phrase is the one definition, so a reworded constant moves these with it
 * and the served-equals-shipped check still compares whole sentences.
 */
export const SUMMARIZE_PAGE_CHOICE_SHIPPED: readonly {
  readonly at: string;
  readonly sentence: string;
}[] = [
  {
    at: "summarize-pdf intro[0]; guide:how-to-summarize-a-pdf sections[0]",
    sentence: `You can also ${SUMMARIZE_PAGE_CHOICE} instead of the whole document.`,
  },
  {
    at: "summarize-pdf faq (Can I summarize only some pages?)",
    sentence: "Can I summarize only some pages?",
  },
  {
    at: "summarize-pdf faq (Can I summarize only some pages?)",
    sentence: `Before you press Summarize PDF, you can ${SUMMARIZE_PAGE_CHOICE} instead of the whole document.`,
  },
  {
    at: "summarize-pdf faq; guide:how-to-summarize-a-pdf sections[0]",
    sentence:
      "Only the part you choose is sent to the AI model, and the result says which pages the summary covers.",
  },
];
