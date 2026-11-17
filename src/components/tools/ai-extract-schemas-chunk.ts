/**
 * A string only AI Data Extraction's saved-schemas chunk carries
 * (`./ai-extract-schemas`): save, load, delete, export and import of a field
 * list. Its root renders this as `data-chunk`, which keeps it through
 * minification, so `src/deploy/lazy-chunks.test.ts` can find the chunk by
 * content and hold that no page loads it with the page. Alone in its module
 * so tests can import it without importing the component.
 */
export const AI_EXTRACT_SCHEMAS_CHUNK = "pdfxyz:lazy:ai-extract-schemas";
