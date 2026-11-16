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
 * ── INVERTED 2026-11-16 (slice 4) ───────────────────────────────────────────
 *
 * The exit condition held, observed on the wire after #337 deployed:
 * production's `/api/worker/status` published `chatRetrieval: true`, and one
 * real question through the live page (`.claude/prove-chat-retrieval.ts`, a
 * 70-page document, the fact on page 60) came back with
 * `selection: "relevance"`, pages 1–21 and 60 sent, and a citation of page
 * 60. So the ban on describing the choice is now a REQUIRED row: wherever
 * the static copy says the notice reports that only part was read, the same
 * entry must say how the pages were chosen ({@link CHAT_SELECTION_REQUIRED},
 * the panel line's own shape). The clause is one definition,
 * `CHAT_PAGE_SELECTION` in `./chat-page-selection`, which also records the
 * second bound: the claim is tied to the `chatRetrieval` key that CI makes
 * the built image prove. What stays BANNED is the overclaim
 * ({@link CHAT_RETRIEVAL_OVERCLAIMS}): every page read. Nothing may say the
 * right page is always found either, but the product never shipped such a
 * sentence, so per rule 1 that is held by a REQUIRED limit rather than by a
 * shape with an invented exemplar: every ENTRY that claims selection (not
 * merely its page: the tool-facts answer also ships alone, as FAQ JSON-LD)
 * must say that matching is by words and can miss
 * ({@link CHAT_SELECTION_LIMIT}). The sentences slice 3 wrote are kept in
 * {@link CHAT_RETRIEVAL_SLICE3_HEDGES}, and the unconditional clause slice 4
 * first shipped in {@link CHAT_PAGE_SELECTION_UNCONDITIONAL}; their tests
 * assert they are no longer served.
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
 * `honest` held the static sentences slice 3 wrote to replace the
 * prefix-only wording; none of them could be caught. Since slice 4 it holds
 * the served sentences about reading a longer file, and no OVERCLAIM may
 * catch them.
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
import {
  CHAT_PAGE_SELECTION,
  CHAT_SELECTION_MISS,
} from "./chat-page-selection";

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

/**
 * What static copy may do with a shape (slice 4):
 *  - `required`: the static page-selection claim's own shape; see
 *    {@link CHAT_SELECTION_REQUIRED}.
 *  - `describes`: true of the production image, said by the model notice;
 *    static copy may say it (until slice 4, every such shape was banned).
 *  - `overclaim`: false of chat on any image; banned from static copy.
 */
export type ChatRetrievalRole = "required" | "describes" | "overclaim";

export interface ChatRetrievalShape {
  readonly name: string;
  readonly role: ChatRetrievalRole;
  readonly pattern: RegExp;
  /** Verbatim shipped sentences, each with where it shipped. */
  readonly shipped: readonly {
    readonly text: string;
    readonly source: string;
  }[];
}

export const CHAT_RETRIEVAL_SHAPES: readonly ChatRetrievalShape[] = [
  {
    name: "shares the most / enough … words",
    role: "required",
    // Rewritten from the design's `share(s)? the most words` to match the
    // gated line as worded ("share the most of its less common words").
    // Widened 2026-11-16 (review) to "share enough": the static clause became
    // conditional, because the selector sends only the opening pages when no
    // page shares enough of the question's words (the coverage gate and the
    // no-signal fallback). The gated panel line still says "the most".
    pattern: /\bshares? (?:the most|enough)\b[^.]*\bwords\b/i,
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
      {
        text: `A longer file is sent ${CHAT_PAGE_SELECTION}.`,
        source:
          "slice 4: CHAT_PAGE_SELECTION, src/lib/tools/content/chat-with-pdf.ts, the reading FAQ",
      },
      {
        text: `When a file is longer than that, each question is sent ${CHAT_PAGE_SELECTION}.`,
        source:
          "slice 4: CHAT_PAGE_SELECTION, src/lib/guides/catalog.ts, the chat guide's long-documents section",
      },
    ],
  },
  {
    name: "pages chosen by … words / question",
    role: "describes",
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
    role: "describes",
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
    role: "describes",
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
    role: "overclaim",
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
    role: "overclaim",
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
 * The served sentences about reading a longer file (slice 4), none of which
 * an OVERCLAIM may catch. Each must be found in the derived copy verbatim,
 * so this is not a list of sentences nobody serves.
 */
export const CHAT_RETRIEVAL_HONEST: readonly string[] = [
  // Shipped before slice 3 and true on every image; the reason a bare
  // /every page/ is not a shape.
  `Ask "What is the notice period?" and the model receives your PDF's text with every page that has text marked by its number, plus an instruction to answer from that text alone and to cite what it used as [p.4].`,
  `For a longer file, each question is sent ${CHAT_PAGE_SELECTION}, within that limit, and a notice above the answer says that only part of it was read, naming the pages when it can.`,
  `A longer file is sent ${CHAT_PAGE_SELECTION}.`,
  "That match is by words, so a question that puts the point in other words than the document does can miss the page that answers it; the document's own terms work best.",
  "The model is told not to claim the document lacks something but to say which part it can see, and the notice above the answer says that only part was read, naming the pages when it can.",
  "When the same text returns with a follow-up, the provider may keep it in a short-lived cache, measured in minutes rather than days, which lowers the cost of reprocessing it.",
  `When a file is longer than that, each question is sent ${CHAT_PAGE_SELECTION}.`,
  "The match is by words, so a question worded differently from the document can miss the page it needs.",
  "The model is told not to claim the document lacks something, and a notice above the answer says that only part of the document was read, naming the pages when it can.",
  "When the same text goes with a follow-up, the provider may also hold it in a short-lived cache, measured in minutes rather than days.",
  `The document gets what the conversation leaves; a longer one is sent ${CHAT_PAGE_SELECTION}, and a notice above the answer says that only part of it was read, naming the pages when it can, rather than treating the rest as absent.`,
];

/**
 * HISTORY, inverted not deleted (slice 4). The four sentences slice 3 wrote
 * that said only that part was read, true of both images, before the
 * production proof let static copy say how the pages were chosen. Each is
 * now served with {@link CHAT_PAGE_SELECTION} beside it, so none may be
 * served verbatim: restoring one restores a claim that names the pages read
 * without saying how they were chosen.
 */
export const CHAT_RETRIEVAL_SLICE3_HEDGES: readonly {
  readonly text: string;
  readonly source: string;
}[] = [
  {
    text: "For a longer file, a notice above the answer says that only part of it was read, naming the pages when it can.",
    source: "6d18e3ed:src/lib/tools/content/chat-with-pdf.ts intro[1]",
  },
  {
    text: "Past that point, the model is told not to claim the document lacks something but to say which part it can see, and the notice above the answer says that only part was read, naming the pages when it can.",
    source: "6d18e3ed:src/lib/tools/content/chat-with-pdf.ts, the reading FAQ",
  },
  {
    text: "Past that point the model is told not to claim the document lacks something, and a notice above the answer says that only part of the document was read, naming the pages when it can.",
    source: "6d18e3ed:src/lib/guides/catalog.ts, the chat guide",
  },
  {
    text: "The document gets what the conversation leaves; for a longer one, a notice above the answer says that only part of it was read, naming the pages when it can, rather than treating the rest as absent.",
    source: "6d18e3ed:src/lib/tools/tool-facts.ts, the chat read FAQ",
  },
];

/**
 * HISTORY, inverted not deleted (review, 2026-11-16). The clause slice 4
 * first shipped (39405f42) said every longer-file question is sent "the
 * opening pages and the pages that share the most of the question's less
 * common words", with no condition. The worker sends ONLY the opening pages
 * when the coverage gate (`CHAT_RETRIEVAL_MIN_COVERAGE`, "low-coverage") or
 * the no-signal fallback fires, so the clause was false in those states. It
 * is now conditional (`chatPageSelection`); neither the clause nor any of
 * the sentences it was served in may be served again.
 */
export const CHAT_PAGE_SELECTION_UNCONDITIONAL = {
  clause:
    "the opening pages and the pages that share the most of the question's less common words",
  sentences: [
    {
      text: "For a longer file, each question is sent the opening pages and the pages that share the most of the question's less common words, within that limit, and a notice above the answer says that only part of it was read, naming the pages when it can.",
      source: "39405f42:src/lib/tools/content/chat-with-pdf.ts intro[1]",
    },
    {
      text: "A longer file is sent the opening pages and the pages that share the most of the question's less common words.",
      source:
        "39405f42:src/lib/tools/content/chat-with-pdf.ts, the reading FAQ",
    },
    {
      text: "When a file is longer than that, each question is sent the opening pages and the pages that share the most of the question's less common words.",
      source: "39405f42:src/lib/guides/catalog.ts, the chat guide",
    },
    {
      text: "The document gets what the conversation leaves; a longer one is sent the opening pages and the pages that share the most of the question's less common words, and a notice above the answer says that only part of it was read, naming the pages when it can, rather than treating the rest as absent.",
      source: "39405f42:src/lib/tools/tool-facts.ts, the chat read FAQ",
    },
  ],
} as const;

/**
 * The REQUIRED row (slice 4): the static page-selection claim's shape,
 * which is also the panel line's. Wherever the static copy says the notice
 * reports that only part was read ({@link CHAT_NOTICE_CLAIM}), the same entry
 * must carry a sentence this catches.
 */
export const CHAT_SELECTION_REQUIRED: ChatRetrievalShape = (() => {
  const required = CHAT_RETRIEVAL_SHAPES.filter((s) => s.role === "required");
  if (required.length !== 1)
    throw new Error(`expected one required shape, found ${required.length}`);
  return required[0]!;
})();

/** The overclaims static copy may never make. */
export const CHAT_RETRIEVAL_OVERCLAIMS: readonly ChatRetrievalShape[] =
  CHAT_RETRIEVAL_SHAPES.filter((s) => s.role === "overclaim");

/** The static clause about the notice that the selection claim must sit beside. */
export const CHAT_NOTICE_CLAIM = /\bnaming the pages when it can\b/;

/**
 * The honest limit every ENTRY that claims selection must carry (since
 * review, 2026-11-16; before, once per page): matching is by words, so a
 * question in other words can miss the page. Every shipped spelling is an
 * exemplar (rule 1, direction A, in the test).
 */
export const CHAT_SELECTION_LIMIT: ChatRetrievalShape = {
  name: "matching by words can miss",
  role: "required",
  pattern:
    /\b(?:match is by words|worded differently from)\b[^.]*\bcan miss the page\b/i,
  shipped: [
    {
      text: "That match is by words, so a question that puts the point in other words than the document does can miss the page that answers it; the document's own terms work best.",
      source:
        "slice 4: src/lib/tools/content/chat-with-pdf.ts, the reading FAQ",
    },
    {
      text: "The match is by words, so a question worded differently from the document can miss the page it needs.",
      source: "slice 4: src/lib/guides/catalog.ts, the chat guide",
    },
    {
      text: CHAT_SELECTION_MISS,
      source:
        "review 2026-11-16: CHAT_SELECTION_MISS, the chat intro, the tool-facts read answer and the chat guide",
    },
  ],
};

/** The shape names that catch `text`, or none. */
export function chatRetrievalShapesIn(text: string): string[] {
  return CHAT_RETRIEVAL_SHAPES.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );
}

/** The OVERCLAIM shape names that catch `text`, or none. */
export function chatRetrievalOverclaimsIn(text: string): string[] {
  return CHAT_RETRIEVAL_OVERCLAIMS.filter(({ pattern }) =>
    pattern.test(text),
  ).map(({ name }) => name);
}
