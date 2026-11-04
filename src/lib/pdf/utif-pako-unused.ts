/**
 * What UTIF gets for its `require("pako")` in the browser bundle, and only
 * UTIF: wired in `next.config.mjs` (`utifPakoStub`), held by
 * `src/deploy/lazy-chunks.test.ts` ("pako stays inside …") against the
 * built chunks.
 *
 * UTIF requires pako when it loads, for its own Deflate decoder. `tiff.ts`
 * never calls that decoder: it inflates Deflate strips itself, with the
 * browser's `DecompressionStream`, and hands UTIF only CCITT and JPEG strips.
 * Bundled, that unused pako moved out of pdf-lib's chunk into a chunk shared
 * with UTIF: one more request on every page where pdf-lib loads, and one more
 * entry in the webpack runtime that every page loads.
 *
 * If a change ever routes a strip through UTIF's Deflate path, this throws,
 * naming the reason, rather than decoding nothing.
 */
export function inflate(): never {
  throw new Error(UTIF_PAKO_UNUSED);
}

/** The message, exported so the bundle test can find this module by it. */
export const UTIF_PAKO_UNUSED =
  "UTIF's Deflate decoder is not bundled: tiff.ts inflates Deflate strips itself.";
