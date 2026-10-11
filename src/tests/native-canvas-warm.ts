/**
 * A setup file of the native-canvas project ONLY: load pdf.js before the
 * file's tests, so that none of them pays pdf.js's cold load inside its own
 * deadline. The defect, its measurements and the check are in
 * `./native-canvas-warm.test.ts`.
 *
 * What it leaves behind is what a file's first pdf.js call leaves anyway:
 * pdf.js's Node build polyfills `DOMMatrix` from the native canvas as it
 * loads, and its worker module puts its handler on `globalThis.pdfjsWorker`,
 * where pdf.js's fake worker looks first. From then on `loadPdfjs`
 * (`src/lib/pdf/pdfjs.ts`) takes the browser build, which runs in Node with
 * that handler — the state these tests ran under on threads, where pdf.js
 * stayed loaded from earlier files. The browser build is loaded here too.
 *
 * Never in the threads project: the Node build loads the native canvas,
 * which `./native-canvas-guard.ts` fails in a worker thread (`./native-canvas`
 * has why). Never in `sharedTestOptions` either, which
 * `pdfjs-load-order.vitest.config.ts` reuses for a run whose subject is a
 * file that loads pdf.js with no `DOMMatrix`.
 */
await import("pdfjs-dist/legacy/build/pdf.mjs");
await import(
  // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
  "pdfjs-dist/legacy/build/pdf.worker.mjs"
);
await import("pdfjs-dist");

export {};
