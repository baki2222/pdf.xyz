/**
 * Where pdfjs finds its image decoders — and why every `getDocument` call must
 * say so.
 *
 * pdfjs ships its JPEG2000 (openjpeg), JBIG2 and ICC (qcms) decoders as
 * WebAssembly and reaches them ONLY through the `wasmUrl` option. Without it
 * there is no decoder and no fallback either: the library builds the
 * JS-fallback specifier as `${wasmUrl}${filename}`, so a missing option
 * produces the literal specifier `nullopenjpeg_nowasm_fallback.js`, which
 * cannot resolve. Observed on production before this module existed:
 *
 *   #instantiateWasm: UnknownErrorException: Ensure that the `wasmUrl` API
 *     parameter is provided.
 *   #getJsModule: TypeError: Failed to resolve module specifier
 *     'nullopenjpeg_nowasm_fallback.js'
 *   Unable to decode image "img_p0_1": "JpxError: OpenJPEG failed to initialize".
 *
 * The consequence was not a broken thumbnail. `rasterizePdf` feeds pdf-to-jpg,
 * pdf-to-png, grayscale-pdf and redact-pdf, so a scanned document — scanners
 * being exactly where JBIG2 and JPEG2000 live — rendered blank into the file
 * the user downloaded, with the tool reporting success and nothing logged.
 *
 * The assets are served from OUR origin. A CDN would put the rendering of the
 * user's document on someone else's host, which contradicts the promise every
 * tool page makes.
 */

/**
 * The pdfjs release whose decoders we serve. Pinned deliberately: the URL is
 * version-stamped so the assets can be cached immutably, which means this
 * constant and the installed package must agree. `wasm-assets.test.ts` fails
 * when they drift, so a `pdfjs-dist` bump cannot silently point the browser at
 * a stale directory.
 */
export const PDFJS_WASM_VERSION = "6.1.200";

/** Directory pdfjs appends its filenames to. Must keep the trailing slash. */
export const PDFJS_WASM_URL = `/pdfjs-wasm/${PDFJS_WASM_VERSION}/`;

/**
 * Exactly what gets copied out of the package, and nothing else.
 *
 * `quickjs-eval.wasm` is DELIBERATELY EXCLUDED. It belongs to
 * `pdf.sandbox.mjs`, the engine that executes JavaScript embedded inside a
 * PDF. We never enable scripting, and running a stranger's JavaScript because
 * it arrived inside their document is an attack surface to take on
 * deliberately or not at all — its 458 KB is the smaller half of that
 * argument. Adding "the rest of the wasm folder" means arguing with this
 * paragraph first.
 *
 * The two `*_nowasm_fallback.js` files ARE copied: pdfjs falls back to them
 * when WebAssembly itself is unavailable, and shipping the wasm while leaving
 * the fallback unresolvable would recreate a smaller version of the very
 * defect this module exists to fix. They are fetched only if wasm fails.
 */
export const PDFJS_WASM_ASSETS = [
  "openjpeg.wasm",
  "openjpeg_nowasm_fallback.js",
  "jbig2.wasm",
  "jbig2_nowasm_fallback.js",
  "qcms_bg.wasm",
] as const;

/**
 * Options every `getDocument` call in this codebase spreads.
 *
 * Shared rather than repeated because the defect was one missing option, and
 * four call sites each hand-writing their own is how a fifth would miss it
 * again. `wasm-assets.test.ts` pins that no call site constructs these by
 * hand.
 */
export const PDFJS_DOCUMENT_DEFAULTS = {
  verbosity: 0,
  wasmUrl: PDFJS_WASM_URL,
} as const;
