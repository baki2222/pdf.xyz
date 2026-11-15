/**
 * Compare PDF's Overlay (S3, 2026-11-15) run on real PDFs, for guards that
 * hold copy to what the overlay sees: the shipped `capturePairs` through
 * the shipped `capturePdfPages`, with pdf.js's legacy build painting onto
 * `@napi-rs/canvas` (pdf.js's own Node canvas). A test file that calls it
 * loads the native canvas and must carry `// @native-canvas`.
 *
 * The globals it needs (`document.createElement("canvas")`,
 * `globalThis.pdfjsWorker`) are set for the call and put back after it, in
 * a node or a jsdom environment alike: no `vi.mock` (the suite shares one
 * module cache).
 */
import { createRequire } from "node:module";
import { capturePdfPages } from "@/lib/pdf/render";
import {
  capturePairs,
  visualRender,
  type PairOutcome,
} from "@/components/tools/runner/compare/visual-pairs";

type Checked = Extract<PairOutcome, { status: "checked" }>;

const requireHere = createRequire(import.meta.url);

/** Draw page 1 of each file and compare them as the Overlay does. */
export async function overlayFirstPage(
  left: Uint8Array,
  right: Uint8Array,
): Promise<Checked> {
  const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
    "@napi-rs/canvas",
  ) as { createCanvas(w: number, h: number): HTMLCanvasElement };
  await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker: unknown = await import(
    // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  const g = globalThis as Record<string, unknown>;
  const hadWorker = "pdfjsWorker" in g;
  const prevWorker = g.pdfjsWorker;
  const hadDocument = typeof g.document !== "undefined";
  const doc = g.document as
    { createElement: (tag: string, o?: unknown) => unknown } | undefined;
  const prevCreate = doc?.createElement;
  const canvasFirst = (orig?: (tag: string, o?: unknown) => unknown) =>
    function (this: unknown, tag: string, o?: unknown) {
      if (tag.toLowerCase() === "canvas") return napi.createCanvas(1, 1);
      return orig?.call(this, tag, o);
    };
  g.pdfjsWorker = worker;
  if (hadDocument) doc!.createElement = canvasFirst(prevCreate);
  else g.document = { createElement: canvasFirst() };
  const prevCapture = visualRender.capture;
  visualRender.capture = capturePdfPages;
  try {
    const result = await capturePairs(left, right, [0]);
    const o = result.outcomes[0];
    if (o?.status !== "checked")
      throw new Error(
        `the overlay did not check page 1: ${JSON.stringify({ o, refused: result.refused, memory: result.memory })}`,
      );
    return o;
  } finally {
    visualRender.capture = prevCapture;
    if (hadDocument) doc!.createElement = prevCreate!;
    else delete g.document;
    if (hadWorker) g.pdfjsWorker = prevWorker;
    else delete g.pdfjsWorker;
  }
}
