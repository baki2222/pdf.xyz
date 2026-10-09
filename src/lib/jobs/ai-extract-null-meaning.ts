/**
 * What a null means in AI Data Extraction — said ONCE, here, and rendered by
 * every surface that explains one: the tool page (its intro, its use cases,
 * its FAQ and the FAQPage JSON-LD built from it), the package a user
 * downloads (README.txt, manifest.json's notice, extraction.md's null cell
 * and footer) and the panel.
 *
 * WHY ONE SOURCE (2026-10-09). Three review rounds each found a surface's
 * own paraphrase that a regex guard did not catch: "not found" alone, then
 * "matches more than once" (a value printed twice is ONE value, which a model
 * returns), then "may not have found one" with the second reason dropped,
 * "missing", "does not answer the question". Every paraphrase was a new
 * wording to ban. So no surface words a null itself any more: it renders the
 * phrases below, and `src/lib/workers/ai-extract/null-meaning.test.ts` reads
 * every surface as served and refuses any sentence that speaks of a null and
 * is not, whole, one of these. Every export here is a whole sentence (or the
 * whole table cell), because the test discovers them from the exports: a
 * fragment exported here would be one a surface could build any claim around.
 *
 * WHAT IS TRUE OF THE ENGINE. Its system prompt says "When a requested value
 * is not present in the text, use null — never a guess". A single-value field
 * whose text holds several DIFFERENT values has no one right answer, and a
 * model may answer null rather than pick one — the production proof of
 * ai-extract failed that way (one `region` asked of a four-row table). Nothing
 * makes it answer null there, and nothing stops it returning one of the
 * values instead. So a null has two possible reasons, neither certain, and a
 * value that is not null is not proof there was only one.
 *
 * A LEAF MODULE: no imports, so the worker, the page content and a client
 * component can all take their words from it.
 */

/** The second reason, as every phrase below words it. */
const SEVERAL_DIFFERENT_VALUES = "several different values";

/** THE sentence: what a null means, with both of its possible reasons. */
export const AI_EXTRACT_NULL_MEANING = `A null means the model gave no single value: it may not have found one, or the text may hold ${SEVERAL_DIFFERENT_VALUES} for the field.`;

/** The engine's instruction, as a user is told it. */
export const AI_EXTRACT_NULL_INSTRUCTION =
  "The model is told to answer null rather than guess.";

/**
 * The other half: a value is not proof that it was the only one — and the way
 * to get every value, in either mode.
 */
export const AI_EXTRACT_NOT_NULL_WARNING = `A value that is not null may still be one of ${SEVERAL_DIFFERENT_VALUES}, so to get every value, ask for a list: the array type in a field schema, or a list in your prompt.`;

/**
 * pdf.xyz's own null: a requested field the model left out of its reply is
 * filled with null in extraction.json, and named in the manifest.
 */
export const AI_EXTRACT_UNRETURNED_NULL =
  "A requested field the model did not return at all is null in extraction.json too, and manifest.json lists it under extraction.missingKeys.";

/**
 * The two reasons as a label. NOT exported: a fragment is not a phrase a
 * surface may build its own sentence around — only the cell and the legend
 * below carry it.
 */
const NULL_LABEL = `not found, or ${SEVERAL_DIFFERENT_VALUES}`;

/** extraction.md's cell for a null value: a table cell of its own. */
export const AI_EXTRACT_NULL_CELL = `_(${NULL_LABEL})_`;

/** How a surface that describes extraction.md says what a null looks like there. */
export const AI_EXTRACT_NULL_CELL_LEGEND = `In extraction.md a null reads "${NULL_LABEL}".`;

/** What a cut window means for a null: the value may lie past the cut. */
export const AI_EXTRACT_NULL_PAST_CUT =
  "A null was judged only on the text that was read, so the value may still appear later in the document.";
