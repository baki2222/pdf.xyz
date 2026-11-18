/**
 * Deflate a page image with the platform's own deflater, `CompressionStream`
 * — zlib format, which is what a PDF's `/FlateDecode` reads — or `null` where
 * there is none, so the caller falls back to pdf-lib's (pako, plain JS).
 *
 * Measured in Chromium on rendered Letter pages at 150 DPI: 50 lines of text
 * took 16.2 ms here against pako's 36.2 ms, for 231,746 against 232,336
 * bytes; a page of a 40-page noise scan 25.6 against 61.7 ms. Sizes differ
 * by under 1% either way (`grayscale-deflate.test.ts`, which also holds the
 * fallback).
 */
export async function deflateNatively(
  plane: Uint8Array,
): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== "function") return null;
  // Written straight to the stream, not through `Blob.stream()`: a Blob from
  // another realm (jsdom's, in the runner tests) has no `stream()`.
  const deflate = new CompressionStream("deflate");
  const writer = deflate.writable.getWriter();
  // Not awaited before reading: the stream would hold the write back until
  // its output is read.
  const written = Promise.all([
    writer.write(plane as Uint8Array<ArrayBuffer>),
    writer.close(),
  ]);
  const out = new Uint8Array(
    await new Response(deflate.readable).arrayBuffer(),
  );
  await written;
  return out;
}
