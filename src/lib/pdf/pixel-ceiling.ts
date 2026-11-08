/**
 * The most pixels one decoded image may have, wherever an engine decodes an
 * image whose size it does not control: 100 megapixels.
 *
 * One figure, read wherever the browser decodes a stranger's pixels —
 * Extract Images (an image inside a PDF), JPG / PNG to PDF's TIFF pages
 * (`tiff.ts`), and, since 2026-11-08, its PNGs (`png-embed.ts`, before
 * inflating) — so they cannot drift into different answers to the same
 * memory question. A JPEG is NOT held to it: JPG / PNG to PDF and Extract
 * Images copy a JPEG's bytes without decoding them, so a 102 MP camera JPEG
 * goes in. `pixel-ceiling.test.ts` runs a file one row over it through the
 * PNG and TIFF readers, and the JPEG past it to show it is still embedded.
 * HISTORY (hostile matrix CI-04): this comment said "both engines" read it
 * while `png-embed.ts` inflated a 144 MP bomb without looking; and for a day
 * JPEGs were held to it too, refusing real photos (review, 2026-11-08). A leaf with
 * no imports: the TIFF reader is a lazy chunk and must not pull Extract
 * Images' engine in to learn a number.
 *
 * 100 MP takes a 600-dpi A3 scan (7,016 × 9,921 = 69.6 MP); A2 at 600 dpi
 * (139 MP) is over it. The pixels are what is checked BEFORE anything is
 * allocated: a 1 KB TIFF header can claim 60,000 × 60,000.
 */
export const MAX_DECODED_PIXELS = 100_000_000;
