import type { PdfjsForAccess } from "./encryption";

/**
 * pdf.js for the encryption probe in `./encryption` — the ONE loader in
 * `./pdfjs` (the browser build pointed at the bundled worker, or the legacy
 * build where the DOM geometry the browser build needs is absent), reached
 * through this module.
 *
 * ITS OWN MODULE, LOADED BY `import()`, because `import.meta.url` is a syntax
 * error under the CommonJS compiler Playwright loads the e2e suite with.
 * `e2e/client-proof/cases.ts` imports `organizePages` from `./engine`, which
 * imports `./encryption`; with a static edge from there to the loader, the
 * whole client proof spec failed to load (`src/tests/e2e-cjs-load.test.ts`).
 * A dynamic edge is taken only when a probe actually runs — in the browser.
 *
 * Until the integration of wave1/l01-page-leak this file carried its own copy
 * of the worker set-up; that lane made `./pdfjs` the one loader, and a second
 * copy is how the two would come to point pdf.js at different workers.
 */
export async function loadBrowserPdfjs(): Promise<PdfjsForAccess> {
  return (await import("./pdfjs")).loadPdfjs();
}
