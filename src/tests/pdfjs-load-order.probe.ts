import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, expect } from "vitest";

/**
 * Setup file for the child run in `pdfjs-load-order.test.ts` only (added by
 * `pdfjs-load-order.vitest.config.ts`, never by the suite's own config).
 *
 * Appends one JSON line per file start and end to `PDFJS_LOAD_ORDER_LOG`,
 * saying whether `DOMMatrix` was defined. The check reads it to prove the
 * order did what it is there to do: the first file starts in a worker with no
 * `DOMMatrix` and reaches pdf.js's loader (the legacy build polyfills
 * `DOMMatrix` when it is evaluated, so "absent at start, present at end" is
 * the trace of pdf.js having been loaded during that file).
 */
const log = process.env.PDFJS_LOAD_ORDER_LOG;

const record = (at: "start" | "end") => {
  if (!log) return;
  appendFileSync(
    log,
    JSON.stringify({
      file: expect.getState().testPath ?? "",
      at,
      domMatrix: typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix,
    }) + "\n",
  );
};

beforeAll(() => record("start"));
afterAll(() => record("end"));
