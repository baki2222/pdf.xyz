/**
 * The most pixels one decoded image may have, wherever an engine decodes an
 * image whose size it does not control: 100 megapixels.
 *
 * One figure, read by both engines that decode a stranger's pixels in the
 * browser — Extract Images (an image inside a PDF) and JPG / PNG to PDF's TIFF
 * pages (`tiff.ts`) — so the two cannot drift into two answers to the same
 * memory question. A leaf with no imports: the TIFF reader is a lazy chunk and
 * must not pull Extract Images' engine in to learn a number.
 *
 * 100 MP takes a 600-dpi A3 scan (7,016 × 9,921 = 69.6 MP); A2 at 600 dpi
 * (139 MP) is over it. The pixels are what is checked BEFORE anything is
 * allocated: a 1 KB TIFF header can claim 60,000 × 60,000.
 */
export const MAX_DECODED_PIXELS = 100_000_000;
