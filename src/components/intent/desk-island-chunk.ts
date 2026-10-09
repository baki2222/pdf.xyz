/**
 * A string only the home desk's chunk carries — the desk renders it as its
 * `data-island`, which keeps it through minification — so the bundle tests
 * can tell the desk's own chunk from a shared one by content
 * (`bundle-budget.test.ts`, "keeps the homepage clear of the tool pages'
 * weight"). Alone in its module so a test can import it without the desk.
 */
export const DESK_ISLAND_MARKER = "pdfxyz:island:home-desk";
