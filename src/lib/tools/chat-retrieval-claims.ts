/**
 * Shapes that describe HOW Chat with PDF chooses the pages of a longer file
 * (audit #30, chat-with-pdf#2, slice 3), and the corpus that proves each
 * one bites.
 *
 * ── THE PROPERTY ─────────────────────────────────────────────────────────────
 *
 * Which pages a question is sent is a fact about ONE worker image. The web
 * tier auto-deploys and the worker image is built by hand, so a static page
 * can be served beside an image that reads only the opening pages (every
 * image before this slice) or one that chooses pages by the question (this
 * slice's). Static copy must therefore stay true of BOTH: it may say that
 * the notice says that only part was read, naming the pages when it can,
 * and never why those pages. (Not "names the pages that were read": when
 * the first page alone overflows the budget, the notice can name none.)
 * The only surface allowed to describe the choice is the panel line gated on
 * an OBSERVED `chatRetrieval: true` heartbeat (`chatRetrievalPanelLine`),
 * plus the model prompt, where the engine knows what it did.
 *
 * ── EXIT CONDITION (house rule 2: the property, not the mechanism) ──────────
 *
 * This ban lifts when "the image serving production chooses pages by the
 * question", OBSERVED ON THE WIRE: the published heartbeat carries
 * `chatRetrieval: true` with the new image's fingerprint, and a real
 * question's job record shows `selection: "relevance"`. NOT when this code
 * is merged, and not when the worker image is built. Slice 4 (the static
 * copy flip) inverts the tests that use this module, keeping their history
 * in the file, and only after that production proof holds.
 *
 * ── RULE 1, BOTH DIRECTIONS ─────────────────────────────────────────────────
 *
 * Every shape carries, in `shipped`, a sentence the product has really
 * shipped, with its source; a shape with no shipped exemplar was DROPPED
 * rather than kept with an invented one. Dropped at authoring (2026-11-16),
 * because `git log -S` over origin/main found no shipped sentence they
 * catch in content, guides/catalog.ts, tool-facts.ts or the chat panel:
 * "best match" (only the tools explorer's search UI and an e2e regex),
 * "pages that match your question", "reads the whole document" (chat's
 * content module never said "whole document"). A bare /every page/ or
 * /whole document/ was never a candidate: the intro's true "the model
 * receives your PDF's text with every page that has text marked by its
 * number" would be red on day one.
 *
 * `honest` holds the static sentences this slice wrote to replace the
 * prefix-only wording; none of them may be caught.
 *
 * The model notice is a shipped sentence too, and review found no shape
 * caught it: "the opening pages and pages chosen by the words they share
 * with the question" appended to the chat intro passed every test. Its
 * exemplars are now COMPOSED from the engine's own words
 * (`chatRelevanceNotice` through `modelTruncationNotice`), so a reworded
 * notice moves the corpus with it rather than slipping out of it.
 *
 * Two shapes ("every page is read / sent", "reads every page") are held by
 * sentences other tools shipped (an Extract Tables guide answer, the
 * watermark page), not chat's. Review asked whether that makes them
 * decoration. They are kept: rule 1 asks that every pattern catch a sentence
 * the PRODUCT shipped, and these did, in the same files the chat corpus is
 * drawn from. Said of chat by an image that reads only the opening pages,
 * either sentence would be false, which is the claim this module bans.
 */
import {
  describeSelection,
  modelTruncationNotice,
} from "@/lib/workers/ai/truncation";
import { chatRelevanceNotice } from "@/lib/workers/chat-with-pdf/relevance-notice";
import type { RelevanceSource } from "@/lib/pdf/page-retrieval";

/**
 * The sentence of chat's relevance model notice that says how the pages were
 * chosen, exactly as the engine composes it (a 70-page document, pages 1–3
 * and 60 sent), for one arm of `chatRelevanceNotice`.
 */
export function chatModelNoticeSentence(
  anchored: boolean,
  source: RelevanceSource,
): string {
  const notice = modelTruncationNotice(
    describeSelection(100_000, 8_000, 70, [1, 2, 3, 60], null),
    () => "",
    chatRelevanceNotice(anchored, source),
  );
  const line = notice
    .split("\n")
    .find((l) => l.startsWith("The text above covers "));
  if (!line) throw new Error("chat's relevance notice has no covers line");
  return line;
}

export interface ChatRetrievalShape {
  readonly name: string;
  readonly pattern: RegExp;
  /** Verbatim shipped sentences, each with where it shipped. */
  readonly shipped: readonly {
    readonly text: string;
    readonly source: string;
  }[];
}

export const CHAT_RETRIEVAL_SHAPES: readonly ChatRetrievalShape[] = [
  {
    name: "shares the most … words",
    // Rewritten from the design's `share(s)? the most words` to match the
    // gated line as worded ("share the most of its less common words").
    pattern: /\bshares? the most\b[^.]*\bwords\b/i,
    shipped: [
      {
        text: "For a longer file, each question is sent the opening pages and the pages that share the most of its less common words.",
        source:
          "this slice: chatRetrievalPanelLine(> 0), src/lib/pdf/chat-retrieval-anchor.ts, the gated panel line",
      },
      {
        text: "For a longer file, each question is sent the pages that share the most of its less common words, or the opening pages when none do.",
        source:
          "this slice: chatRetrievalPanelLine(0), src/lib/pdf/chat-retrieval-anchor.ts, the gated panel line's other arm",
      },
    ],
  },
  {
    name: "pages chosen by … words / question",
    pattern:
      /\bpages? (?:are |were |is |was )?chosen by\b[^.]*\b(?:words?|question)\b/i,
    shipped: [
      {
        text: chatModelNoticeSentence(true, "words"),
        source:
          'this slice: chatRelevanceNotice(true, "words") via modelTruncationNotice, src/lib/workers/chat-with-pdf/relevance-notice.ts, the model notice’s anchor arm',
      },
      {
        text: chatModelNoticeSentence(false, "words"),
        source:
          'this slice: chatRelevanceNotice(false, "words") via modelTruncationNotice, the model notice’s other arm',
      },
    ],
  },
  {
    // A follow-up whose sent page came only from the previous answer's
    // citations. Said by static copy it would be false of an image that
    // reads only the opening pages.
    name: "pages the previous answer cited",
    pattern: /\bpages? (?:that )?the previous answer cited\b/i,
    shipped: [
      {
        text: chatModelNoticeSentence(true, "cited"),
        source:
          'this slice: chatRelevanceNotice(true, "cited") via modelTruncationNotice, the model notice’s seed-only anchor arm',
      },
      {
        text: chatModelNoticeSentence(false, "cited"),
        source:
          'this slice: chatRelevanceNotice(false, "cited") via modelTruncationNotice, the model notice’s seed-only arm',
      },
    ],
  },
  {
    // Cited and scored pages together: the neutral wording.
    name: "pages chosen for … question",
    pattern: /\bpages? (?:are |were |is |was )?chosen for\b[^.]*\bquestion\b/i,
    shipped: [
      {
        text: chatModelNoticeSentence(true, "mixed"),
        source:
          'this slice: chatRelevanceNotice(true, "mixed") via modelTruncationNotice, the model notice’s mixed anchor arm',
      },
      {
        text: chatModelNoticeSentence(false, "mixed"),
        source:
          'this slice: chatRelevanceNotice(false, "mixed") via modelTruncationNotice, the model notice’s mixed arm',
      },
    ],
  },
  {
    name: "every page is read / sent",
    pattern: /\bevery page is (?:read|sent)\b/i,
    shipped: [
      {
        text: "No. There is no page choice: every page is read.",
        source:
          "4e31caa3:src/lib/guides/catalog.ts (an Extract Tables guide answer, still served)",
      },
      {
        text: "No. There are no options: every page is read.",
        source: "d221a5ec:src/lib/guides/catalog.ts (its first wording)",
      },
    ],
  },
  {
    name: "reads every page",
    pattern: /\breads? every page\b/i,
    shipped: [
      {
        text: "A course pack, report or design portfolio can go out marked SAMPLE at low opacity: prospective buyers can read every page, but a clean copy is not what they receive.",
        source: "0d655c18:src/lib/tools/content/watermark-pdf.ts",
      },
    ],
  },
];

/**
 * The static sentences this slice wrote (brief step 7), each true of an
 * image that reads only the opening pages AND of one that chooses pages by
 * the question. None may be caught by {@link CHAT_RETRIEVAL_SHAPES}.
 */
export const CHAT_RETRIEVAL_HONEST: readonly string[] = [
  // Shipped before this slice and true on both images; the reason a bare
  // /every page/ is not a shape.
  `Ask "What is the notice period?" and the model receives your PDF's text with every page that has text marked by its number, plus an instruction to answer from that text alone and to cite what it used as [p.4].`,
  "For a longer file, a notice above the answer says that only part of it was read, naming the pages when it can.",
  "Past that point, the model is told not to claim the document lacks something but to say which part it can see, and the notice above the answer says that only part was read, naming the pages when it can.",
  "When the same text returns with a follow-up, the provider may keep it in a short-lived cache, measured in minutes rather than days, which lowers the cost of reprocessing it.",
  "Past that point the model is told not to claim the document lacks something, and a notice above the answer says that only part of the document was read, naming the pages when it can.",
  "When the same text goes with a follow-up, the provider may also hold it in a short-lived cache, measured in minutes rather than days.",
  "The document gets what the conversation leaves; for a longer one, a notice above the answer says that only part of it was read, naming the pages when it can, rather than treating the rest as absent.",
];

/** The shape names that catch `text`, or none. */
export function chatRetrievalShapesIn(text: string): string[] {
  return CHAT_RETRIEVAL_SHAPES.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );
}
