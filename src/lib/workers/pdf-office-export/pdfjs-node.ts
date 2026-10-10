/**
 * pdf.js on the worker: the legacy build, its own canvas, and its decoders
 * read from disk.
 *
 * `@/lib/pdf/pdfjs` is the browser's loader. Its asset options are same-origin
 * URL paths (`/pdfjs-wasm/…`), which resolve to nothing under Node, and without
 * them pdf.js does not fail: a JPEG 2000 or JBIG2 image decodes to NOTHING and
 * a non-embedded CJK font draws NOTHING (`@/lib/pdf/wasm-assets` has the
 * measurements). So this module points the same three options at the
 * installed package, as FILESYSTEM directories: pdf.js joins `${dir}${file}`
 * and hands the string to `fs.readFile`, which reads a path and not a
 * `file://` URL, and it insists on a trailing "/" even on Windows.
 *
 * ── WHY pdf.js, AND WHY THE LEGACY BUILD ────────────────────────────────────
 *
 * This file's neighbours said, until 2026-10-10, that "pdfjs is browser-only
 * and throws under Node before reading a byte". That was true of the MAIN
 * build, which constructs a `DOMMatrix` at import. The legacy build runs in
 * Node with a fake worker and paints through `@napi-rs/canvas` (pdf.js's own
 * optional dependency, reached through its `NodeCanvasFactory`), measured on
 * Node 22 and 24 on 2026-10-10. PDF to PowerPoint needs what only a renderer
 * knows — where each picture is painted, which font and colour each glyph is
 * drawn in, and the page with its text and pictures left out — and pdftotext
 * knows none of it.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 * It does not isolate the document from the process: pdf.js runs in the
 * daemon's own thread, like the pdf-lib repack Compress PDF's lossless path
 * runs. Its memory is bounded by the CALLER, before pdf.js decodes anything:
 * the page scan reads from the file what each page will decode and sets this
 * module's pixel ceiling (`maxImageSize`) per page from a byte budget
 * (`./page-scan`, `decodeBudgetPlan`). The other bounds are no system fonts,
 * no XFA, and the caller's own deadline; this pdf.js release has no `eval`
 * path left to switch off (the option was removed with it). A single
 * synchronous decode cannot be interrupted.
 *
 * ── WHY NOTHING HERE NAMES A PACKAGE TO THE BUNDLER ─────────────────────────
 *
 * The web tier's route handlers reach this file: `@/lib/workers` re-exports
 * the processors, the PowerPoint processor imports its engine, and the engine
 * imports the page scan. On 2026-10-10 `next build` FAILED on it: webpack read
 * `createRequire(…).resolve("@napi-rs/canvas")` as a dependency, followed it
 * into the canvas's native `.node` binary, and could not parse the binary.
 * Every vitest suite was green, because vitest does not bundle. So `require`
 * is made at RUN time, through `process.getBuiltinModule`, which no bundler
 * reads — the same door pdf.js itself uses to reach the same canvas, so it
 * asks nothing of Node that pdf.js does not (pdfjs-dist 6.2 needs Node 22.13
 * or later). `src/deploy/server-bundle-native-free.test.ts` holds every
 * module the web build compiles to it, this one by name among its controls.
 */
import path from "node:path";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { MAX_DECODED_IMAGE_PIXELS } from "./picture-limits";

export type NodePdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type LoadingTask = ReturnType<NodePdfjs["getDocument"]>;
export type NodePdfDocument = Awaited<LoadingTask["promise"]>;
export type NodePdfPage = Awaited<ReturnType<NodePdfDocument["getPage"]>>;

/** What `@napi-rs/canvas` hands back through pdf.js's canvas factory. */
export interface NodeCanvas {
  width: number;
  height: number;
  /** `image/png`, or `image/jpeg` with a 0–100 quality. */
  toBuffer(mime: "image/png" | "image/jpeg", quality?: number): Uint8Array;
}
export interface NodeCanvasContext {
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray };
  createImageData(w: number, h: number): { data: Uint8ClampedArray };
  putImageData(image: unknown, x: number, y: number): void;
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
}
export interface NodeCanvasAndContext {
  canvas: NodeCanvas;
  context: NodeCanvasContext;
}
export interface NodeCanvasFactory {
  create(width: number, height: number): NodeCanvasAndContext;
  destroy(canvasAndContext: NodeCanvasAndContext): void;
}

/** Node's `createRequire`, fetched when called. See the docblock above. */
function runtimeRequire(from: string): NodeJS.Require {
  return process.getBuiltinModule("node:module").createRequire(from);
}

let loaded: Promise<NodePdfjs> | undefined;

/** The legacy build, imported once. Hidden from bundlers: Node only. */
export function loadNodePdfjs(): Promise<NodePdfjs> {
  loaded ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs"
  ) as Promise<NodePdfjs>;
  return loaded;
}

/**
 * The installed package's asset directories, as pdf.js wants them under Node:
 * forward slashes and a trailing "/". Throws if the package cannot be found,
 * which only a broken install can cause.
 */
export function nodePdfjsAssetDirs(): {
  wasmUrl: string;
  cMapUrl: string;
  standardFontDataUrl: string;
} {
  const root = path.dirname(
    runtimeRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  );
  const dir = (name: string) =>
    `${path.join(root, name).split(path.sep).join("/")}/`;
  return {
    wasmUrl: dir("wasm"),
    cMapUrl: dir("cmaps"),
    standardFontDataUrl: dir("standard_fonts"),
  };
}

/** True when the legacy build and its canvas resolve here. Never imports them. */
export function nodePdfjsAvailable(
  resolve: (specifier: string) => string = (specifier) =>
    runtimeRequire(import.meta.url).resolve(specifier),
): boolean {
  try {
    const pdfjs = resolve("pdfjs-dist/legacy/build/pdf.mjs");
    // pdf.js requires the canvas from its OWN directory, so ask from there.
    runtimeRequire(pdfjs).resolve("@napi-rs/canvas");
    return true;
  } catch {
    return false;
  }
}

/**
 * The pixel ceiling for one decoded image (width × height) when the caller
 * knows nothing better, defined in `./picture-limits` (the tool's page
 * states it). pdf.js REMOVES a larger image from the page without a word, so
 * a caller that opens with this ceiling must know, from the file itself,
 * which images it removed: the page scan reads that from `./page-inventory`
 * and sets the ceiling per page from a BYTE budget (`decodeBudgetPlan`), with
 * this as the floor for images the inventory did not see.
 */
export { MAX_DECODED_IMAGE_PIXELS };

/**
 * Open `bytes` with the legacy build. The loading task is handed to
 * `awaitPdfjsDocument`, so a password refusal or an unreadable file arrives as
 * the engine's typed error, not pdf.js's own.
 *
 * `maxImageSize` is pdf.js's own option: images of more pixels are removed
 * from every page (see {@link MAX_DECODED_IMAGE_PIXELS}); -1 removes none.
 */
export async function openNodePdf(
  bytes: Uint8Array,
  { maxImageSize = MAX_DECODED_IMAGE_PIXELS }: { maxImageSize?: number } = {},
): Promise<{ pdfjs: NodePdfjs; doc: NodePdfDocument; close(): Promise<void> }> {
  const pdfjs = await loadNodePdfjs();
  const loadingTask = pdfjs.getDocument({
    // pdf.js may detach the buffer it is given; the caller's bytes stay whole.
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...nodePdfjsAssetDirs(),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    enableXfa: false,
    maxImageSize,
  });
  const doc = await awaitPdfjsDocument(loadingTask);
  return {
    pdfjs,
    doc,
    close: () => loadingTask.destroy().catch(() => {}),
  };
}

/**
 * pdf.js's canvas factory, or a throw. A missing factory must not degrade to
 * "nothing drawn": a blank layer agrees with every "is this blank?" check,
 * which is the convenient direction for a defect to hide in.
 */
export function canvasFactoryOf(doc: NodePdfDocument): NodeCanvasFactory {
  const factory = (doc as unknown as { canvasFactory?: NodeCanvasFactory })
    .canvasFactory;
  if (!factory || typeof factory.create !== "function")
    // For the log: the engine reports its own sentence for any throw here.
    throw new Error("pdf.js has no canvas factory here: nothing can be drawn");
  return factory;
}
