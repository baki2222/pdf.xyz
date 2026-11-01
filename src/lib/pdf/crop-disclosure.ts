/**
 * What cropping does NOT do, said wherever the tool is.
 *
 * `cropPdf` only moves each page's CropBox: the MediaBox and every content
 * stream are left as they were (crop.ts says so, and `crop-disclosure.test.tsx`
 * pins it against the output). Anything outside the box is hidden, not
 * deleted: resetting the crop box in any editor shows it again.
 *
 * Measured, and the reason the sentence below does NOT say "search finds it":
 * pdf.js's text extraction drops text outside the crop box, so a viewer built
 * on it will not find the hidden words. The claim is scoped to what was
 * demonstrated — the bytes are there, and a reset recovers them. The page used to say nothing about this, to people
 * whose keywords were "cut pdf" and who were cropping away an account number
 * before sharing.
 *
 * A leaf, so the runner (client) and the facts (server) share one sentence.
 * The Redact pair is checked against the catalogue in `crop-disclosure.test.tsx`.
 */
export const REDACT_TOOL_NAME = "Redact PDF";
export const REDACT_TOOL_HREF = "/tools/redact-pdf";

export const CROP_KEEPS_CONTENT = `Cropping hides everything outside the box, but that content stays inside the file, and anyone with the file can bring it back by resetting the crop in another editor. To remove part of a page permanently, use ${REDACT_TOOL_NAME} on the original before you split it.`;

/**
 * The same disclosure for Split Pages in Half, whose halves are made the same
 * way: `splitPagesInHalf` gives each copy of a page a CropBox and leaves the
 * MediaBox and content streams alone, so each half page still holds the other
 * half, out of view. Pinned against the output, as above, in
 * `crop-disclosure.test.tsx`.
 */
export const SPLIT_HALF_KEEPS_CONTENT = `Each half page shows only its own half, but the other half is hidden rather than deleted: it stays inside the file, and anyone with the file can bring it back by resetting the crop in another editor. To remove part of a page permanently, use ${REDACT_TOOL_NAME} on the original before you split it.`;
