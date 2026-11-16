/**
 * What Translate PDF says about pages it withheld because the job's
 * reservation ran out (`boundBy: "characters"`): one sentence, said by the
 * package's in-place marker (`workers/translate/chunking.ts`) and by the
 * panel's notice (`components/tools/delivery-notice.tsx`).
 *
 * IT REPLACED A REMEDY THAT DOES NOT WORK (2026-11-17). Both surfaces ended
 * "Translate the remaining pages as a separate document." A job reserves
 * `declared × TRANSLATE_EXTRACTOR_HEADROOM` characters, and a characters-bound
 * withhold means our server read more than that. A rerun of those pages is
 * declared by the same browser count, so its reservation is short in the same
 * proportion: `translate-withheld-remedy.chain.test.ts` runs it (100
 * characters a page declared, 500 read) and the rerun of the withheld page is
 * refused before any model call. The sentence below says what happened and
 * offers no step.
 *
 * WHY "MORE TEXT THAN WAS COUNTED", NOT "ON THESE PAGES". The reservation is
 * spent in page order, so a page can be withheld because EARLIER pages held
 * more than was counted; the withheld page itself may hold less. What is
 * always true of a characters-bound withhold is the document's (or the chosen
 * pages') total: the server read more than `declared × h ≥ declared`.
 *
 * The PAGE bound keeps its own remedies, which do work: a page count the
 * browser declares is exact (pdf.js and the worker agree on pages), so the
 * document uploaded again, or the remaining pages chosen, are declared
 * correctly.
 */
export const WITHHELD_UNDERCOUNT_SENTENCE =
  "Our server found more text than was counted before the upload, so these pages could not be translated in this job.";
