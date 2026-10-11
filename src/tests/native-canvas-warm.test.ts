// @vitest-environment node
// @native-canvas
/**
 * A native-canvas test file begins with pdf.js already loaded, so no test in
 * it waits out pdf.js's cold load inside its own deadline.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * The native-canvas project runs one process per file (`vitest.config.ts`
 * says why). On threads, pdf.js loaded once per worker and stayed loaded for
 * every later file; in a fresh process the FIRST pdf.js call of every file
 * paid the whole load — pdf.js's Node build and the native canvas it
 * requires — and that call sat inside a testing-library wait of 1 s.
 *
 * Measured on 2026-10-11, the command CI's suite splits into
 * (`vitest run src/lib/tools src/app src/lib/privacy src/components
 * src/lib/workers/pdf-office-export src/lib/workers/processor src/tests`,
 * files in parallel), with a copy-restored timer in `loadPdfjs`: the legacy
 * import took 102–1,336 ms as a process's first pdf.js call and 0 ms after
 * it, and a timer in `countDeclaredCharacters` read 202–1,490 ms cold against
 * 6–14 ms warm. In 2 of 3 runs one AI panel test failed — the Translate
 * panel's password copy and its OCR-first copy, Summarize's and Extract's
 * positive controls, in other runs. No exception was swallowed (every count
 * was logged, and only the two deliberately unreadable inputs threw) and no
 * build raced (905 loads logged, every browser-build load with pdf.js's
 * worker in place). It was the load, inside the wait. A positive control that
 * timed out also posted its job late into the NEXT test's network stub, which
 * then read a body without `declaredCharacters`: one slow load, two reds.
 *
 * `./native-canvas-warm.ts`, a setup file of that project only, loads pdf.js
 * before the file's tests. The state it leaves is the state a file's first
 * pdf.js call leaves anyway — the canvas's `DOMMatrix` on globalThis, pdf.js's
 * worker handler as `globalThis.pdfjsWorker` — only earlier, outside every
 * test's deadline. No timeout was lengthened.
 *
 * ── WHAT THIS READS, AND WHERE ──────────────────────────────────────────────
 *
 * The process's state at the top of a test file, which is the point of
 * consumption: after the setup files, before any test. Nothing this file
 * imports statically can load pdf.js, so what it reads there is what the
 * setup files left. It is one file, and it speaks for all of them through
 * two relationships held elsewhere: every marked file is in this project
 * (`native-canvas-pool.test.ts` asks vitest), and a project's setup files run
 * before each of its files.
 *
 * Its real negative is its own first run: before the warm-up existed this
 * file read `{ canvas: false, domMatrix: false, worker: false }` at its top
 * (2026-10-11), and with the warm-up's worker import cut out it read
 * `worker: false`. It does not import pdf.js's worker module itself:
 * `pdfjs-load-order.test.ts` takes every file that does for a driver of the
 * browser build, and ran this one, red, in a child with no warm-up.
 *
 * Not checked here, because Node offers no way to ask its ES module cache:
 * that the warm-up also loaded pdf.js's BROWSER build, which `loadPdfjs`
 * takes once `DOMMatrix` exists. Its first import measured 0–58 ms before the
 * warm-up, so it is warmed for completeness, not because it was the cause.
 */
import { createRequire } from "node:module";
import { isMainThread } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { nativeCanvasModules } from "./native-canvas";

interface Warmth {
  /** The native canvas is in this process's module cache. */
  canvas: boolean;
  /** `DOMMatrix` exists, which pdf.js's Node build polyfills as it loads. */
  domMatrix: boolean;
  /** pdf.js's worker module has put its handler on globalThis. */
  worker: boolean;
}

function warmth(ids: Iterable<string>, scope: object): Warmth {
  const g = scope as {
    DOMMatrix?: unknown;
    pdfjsWorker?: { WorkerMessageHandler?: unknown };
  };
  return {
    canvas: nativeCanvasModules(ids).length > 0,
    domMatrix: typeof g.DOMMatrix === "function",
    worker: typeof g.pdfjsWorker?.WorkerMessageHandler === "function",
  };
}

const cache = createRequire(import.meta.url).cache;
/** Read before any test, after the setup files. */
const AT_START = warmth(Object.keys(cache), globalThis);

describe("a native-canvas test file begins with pdf.js loaded", () => {
  it("pdf.js's Node build, its native canvas and its worker are loaded before the first test", () => {
    // Health: this is the native-canvas project's own kind of process — a
    // forked child, not a worker thread — or the reading is of another pool.
    expect(isMainThread).toBe(true);
    expect(typeof process.send).toBe("function");
    expect(AT_START).toEqual({ canvas: true, domMatrix: true, worker: true });
  });

  it("control: the reading is cold where nothing is loaded, field by field, and sees this OS's real canvas", async () => {
    // Negative: nothing in the cache, nothing on the globals.
    expect(warmth([], {})).toEqual({
      canvas: false,
      domMatrix: false,
      worker: false,
    });
    // Each field answers for its own thing only: a `DOMMatrix` alone is not
    // a loaded worker, and a `pdfjsWorker` without its handler is not one.
    expect(warmth([], { DOMMatrix: class {} })).toEqual({
      canvas: false,
      domMatrix: true,
      worker: false,
    });
    expect(warmth([], { pdfjsWorker: {} }).worker).toBe(false);
    // Through the real module and this OS's real paths: the canvas pdf.js's
    // Node build loads is recognised in this process's own cache. (A
    // predicate matching "/" only once found nothing on Windows: a blind
    // reading reports the safest pass.)
    await import("pdfjs-dist/legacy/build/pdf.mjs");
    expect(warmth(Object.keys(cache), globalThis).canvas).toBe(true);
  });
});
