/**
 * Two vocabularies for Translate PDF's slice 7 (competitor audit #29), each
 * with the sentences that shipped carrying it. Not imported by product code.
 *
 *  1. The page-choice ADVERTISEMENT (`./translate-page-choice`): its shapes
 *     and the sentences first served on 2026-11-17. Read by
 *     `./translate-page-choice.test.ts` (served-equals-shipped, required
 *     surfaces) and by the `translatePageRange` subject in
 *     `./capability-hedges.test.ts`.
 *  2. The SPLIT-FIRST ADVICE it retires ("split it into smaller files",
 *     "as a separate document", ...): its shapes and every split sentence the
 *     product has shipped on a Translate surface, static or per job. Read by
 *     `./translate-page-choice.test.ts`, which bans every shape from the
 *     SERVED static Translate surfaces.
 *
 * RULE 1, BOTH DIRECTIONS, for each: every shipped sentence is caught by some
 * shape, and every shape catches one of them.
 *
 * WHAT THIS CANNOT SEE: an advertisement or a split instruction in words no
 * shape knows ("pick a chapter", "cut the PDF in two"). The capability-hedges
 * subject is the other net for the advertisement, with the same blind spot.
 */
import { AI_CHARACTER_ALLOWANCE_DELIVERED } from "@/lib/jobs/ai-allowance";
import { TRANSLATE_PAGE_CHOICE } from "./translate-page-choice";

/** The day's figure, as those sentences interpolated it then and now. */
const DAY = AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US");

export interface CopyShape {
  readonly name: string;
  readonly pattern: RegExp;
}

export const TRANSLATE_PAGE_CHOICE_SHAPES: readonly CopyShape[] = [
  {
    name: "the advertisement",
    pattern: /\bchoose which pages to translate\b/i,
  },
  {
    name: "the FAQ question",
    pattern: /\btranslat\w* only some pages\b/i,
  },
  {
    name: "only the chosen pages are sent",
    pattern: /\bonly the pages you choose\b/i,
  },
];

/**
 * Verbatim, as first served on 2026-11-17, with where. The phrase is the one
 * definition, so a reworded constant moves these with it and the
 * served-equals-shipped check still compares whole sentences.
 */
export const TRANSLATE_PAGE_CHOICE_SHIPPED: readonly {
  readonly at: string;
  readonly sentence: string;
}[] = [
  {
    at: "translate-pdf intro[2], faq (How much of my PDF...); guide sections[1], faq[0], faq[4]",
    sentence: `You can ${TRANSLATE_PAGE_CHOICE} instead, and translate more pages each time the allowance resets.`,
  },
  {
    at: "translate-pdf intro[2], faq (Can I translate only some pages?); guide sections[1]",
    sentence:
      "Only the pages you choose are sent to the AI model and count against the allowance, and the result names them.",
  },
  {
    at: "translate-pdf faq (Can I translate only some pages?)",
    sentence: "Can I translate only some pages?",
  },
  {
    at: "translate-pdf faq (Can I translate only some pages?)",
    sentence: `Before you press Translate PDF, you can ${TRANSLATE_PAGE_CHOICE} instead of the whole document.`,
  },
];

/** The split-first advice, by shape (house rule 1: no single spelling). */
export const SPLIT_ADVICE_SHAPES: readonly CopyShape[] = [
  { name: "smaller files", pattern: /\bsmaller files\b/i },
  {
    name: "split it / the file / the document",
    pattern: /\bsplit (?:it|them|the (?:file|document|PDF))\b/i,
  },
  { name: "has to be split", pattern: /\b(?:has|have|needs?) to be split\b/i },
  { name: "as a separate document", pattern: /\bas a separate document\b/i },
  { name: "one at a time", pattern: /\bone at a time\b/i },
];

/**
 * The split sentences shipped on Translate's STATIC surfaces before slice 6
 * (D12) neutralised them, verbatim, with the day's figure interpolated
 * from the same constant they used. History: no
 * served page carries them now, and the ban keeps it so.
 */
export const SPLIT_ADVICE_SHIPPED_STATIC: readonly {
  readonly at: string;
  readonly sentence: string;
}[] = [
  {
    at: "translate-pdf intro[2], until 2026-11-16 (#347, D12)",
    sentence: `The allowance is charged when the job is created, just after the upload: a document needing more than is left today is refused whole with nothing charged rather than half translated, and one over ${DAY} characters, the whole day's allowance, has to be split into smaller files first.`,
  },
  {
    at: "translate-pdf faq (How much of my PDF...), until 2026-11-16 (#347, D12)",
    sentence: `The whole document is charged against the free daily allowance when the job is created, so a document needing more than is left today is refused before it runs, with nothing charged, rather than half translated; one over ${DAY} characters, the whole day's allowance, has to be split into smaller files.`,
  },
];
