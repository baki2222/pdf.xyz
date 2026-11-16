/**
 * What Summarize PDF's page choice says when it cannot be honoured — said
 * once, for the route and the panel (competitor audit summarize-pdf#5).
 *
 * Dependency-free strings: the panel imports this module statically, so it
 * is on Summarize PDF's first load and must stay small.
 */

/**
 * `POST /api/jobs`'s refusal of a summarize job carrying `pages` when the
 * running worker does not prove `summarizePages` (`runningWorkerSummarizesPages`).
 *
 * "Nothing was charged" is true ONLY because the route refuses BEFORE the
 * ceiling peek and the allowance reservation; `summarize-pages.route.test.ts`
 * pins that order (the reserve spy is called zero times on every refusing
 * beat). Moving the gate below the reservation makes this sentence false.
 * The panel never shows it in normal use: it hides the control while the
 * key is unobserved.
 */
export const SUMMARIZE_PAGES_NOT_RUNNING_MESSAGE =
  "Choosing pages is not available on our server right now, so nothing was charged. Summarize the whole document, or try again later.";

/**
 * The panel's rollback warning: the person chose pages, and the completed
 * job's result does not confirm that only those pages were read
 * (`selectionConfirmed` in `./selection-echo`). Shown INSTEAD of the
 * selection sentence, never beside it.
 */
export const SUMMARIZE_PAGES_UNCONFIRMED_MESSAGE =
  "Our server did not confirm that it read only the pages you chose, so this summary may cover other pages. Check it against your PDF before relying on it.";
