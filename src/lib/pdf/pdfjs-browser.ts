import type { PdfjsForAccess } from "./encryption";

/**
 * The browser build of pdf.js, pointed at the bundled worker (once), for the
 * encryption probe in `./encryption`.
 *
 * ITS OWN MODULE, LOADED BY `import()`, because `import.meta.url` is a syntax
 * error under the CommonJS compiler Playwright loads the e2e suite with.
 * `e2e/client-proof/cases.ts` imports `organizePages` from `./engine`, which
 * imports `./encryption`; with this function inline there, the whole client
 * proof spec failed to load (`src/tests/e2e-cjs-load.test.ts`). A dynamic
 * edge is taken only when a probe actually runs — in the browser.
 */
let workerConfigured = false;

export async function loadBrowserPdfjs(): Promise<PdfjsForAccess> {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return pdfjs;
}
