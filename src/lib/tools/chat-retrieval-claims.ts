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
 * the notice names the pages that were read, and never why those pages.
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
 */

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
  "For a longer file, a notice above the answer names the pages that were read, by number when the text allows.",
  "Past that point, the model is told not to claim the document lacks something but to say which pages it can see, and the notice above the answer names the pages that were read.",
  "When the same text returns with a follow-up, the provider may keep it in a short-lived cache, measured in minutes rather than days, which lowers the cost of reprocessing it.",
  "Past that point the model is told not to claim the document lacks something, and a notice above the answer names the pages that were read.",
  "When the same text goes with a follow-up, the provider may also hold it in a short-lived cache, measured in minutes rather than days.",
  "The document gets what the conversation leaves; for a longer one, a notice above the answer names the pages that were read, by number when the text allows, rather than treating the rest as absent.",
];

/** The shape names that catch `text`, or none. */
export function chatRetrievalShapesIn(text: string): string[] {
  return CHAT_RETRIEVAL_SHAPES.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );
}
