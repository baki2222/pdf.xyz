/**
 * The chat page-selection proof's two questions and its recording
 * provider's answer (2026-11-16, audit #30 slice 3). A phrase module of
 * their own so the copy walk reads them (`copy-surface.ts`) without walking
 * `retrieval-capability.ts`, which computes with the read ceiling and
 * states none.
 *
 * The planted question names the token only page 60 carries. The negative
 * question shares no informative term with the proof's filler or its
 * extracted pages; `retrieval-capability.ts` checks that at run time (g).
 */
export const CHAT_RETRIEVAL_PLANTED_QUESTION =
  "What does the Zephyrine clause say?";
export const CHAT_RETRIEVAL_NEGATIVE_QUESTION =
  "What is the governing currency?";

/** What the proof's recording provider answers: it spends nothing. */
export const CHAT_RETRIEVAL_PROOF_ANSWER =
  "The pages provided were read. [p.1]";
