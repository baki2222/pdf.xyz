/**
 * The viewer's open, as Compare PDF's page view fetches it (`compare-docs.ts`).
 *
 * A module of its own so that the chunk the page view's `import()` makes
 * starts at THIS module, not at `@/lib/pdf/viewer`. That chunk is never
 * split (`next.config.mjs`, `compareBorn`), so it carries its own copy of
 * the viewer's open; started at the viewer's module, it had the same root as
 * PDF Viewer's open chunk, and webpack's deterministic ids gave the shared
 * id to the comparison's copy and a new one to PDF Viewer's, which changed
 * PDF Viewer's runner on its first load (review r1, 2026-11-15).
 */
export { openViewerPdf } from "@/lib/pdf/viewer";
