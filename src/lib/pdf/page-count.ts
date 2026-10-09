/**
 * How many pages a PDF has — **and, when that cannot be answered, which of the
 * several different reasons applies.**
 *
 * This file used to return `number | null`, and so did a second copy of it in
 * `workers/ocr-native.ts`. Between them, `null` meant any of:
 *
 *   - the bytes are not a readable PDF;
 *   - the file is above the caller's parse ceiling and was never opened;
 *   - the document parsed fine and genuinely reports zero pages.
 *
 * Three different facts collapsed into one silent value. That is survivable for
 * a display hint on a file card, which is all this was ever used for — and fatal
 * for a gate, because a gate has to treat them differently. An output we produced
 * that our own parser cannot read is evidence against the artifact; an input
 * above the parse ceiling is merely unmeasured, and failing on it would break the
 * largest files a user has, which is precisely the pressure that ends with
 * someone deleting the gate. A counter that cannot tell those apart forces the
 * caller to guess, and the guess that gets made is always "fine".
 *
 * So the result is discriminated. Callers that only want a hint still get one
 * from {@link countPdfPages}, which is now a thin wrapper — one parse, one
 * behaviour, no second copy to drift.
 */

/** The reasons a page count can be unavailable. Never merge these. */
export type PageCountUnknown = "unparseable" | "too-large" | "zero-pages";

export type PageCountResult =
  | { readonly ok: true; readonly count: number }
  | { readonly ok: false; readonly unknown: PageCountUnknown };

/**
 * Count the pages in a PDF, distinguishing every reason the answer may be
 * unavailable. Never throws.
 *
 * `maxBytes` is the caller's own parse ceiling and is required rather than
 * defaulted: pdf-lib loads the whole document into memory, so the ceiling is a
 * real budget decision that belongs to whoever is spending it. Passing
 * `Number.POSITIVE_INFINITY` is a legitimate way to say "no ceiling", and it is
 * legible as a decision in a way that an omitted argument is not.
 *
 * Encrypted documents still expose their page tree, so `ignoreEncryption` is on:
 * without it a password-protected PDF reads as `unparseable`, which would be a
 * gate failing on a perfectly intact file.
 */
export async function countPdfPagesDetailed(
  bytes: Uint8Array,
  maxBytes: number,
): Promise<PageCountResult> {
  if (bytes.byteLength === 0) return { ok: false, unknown: "unparseable" };
  if (bytes.byteLength > maxBytes) return { ok: false, unknown: "too-large" };
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: true,
    });
    return pageCountFromDoc(doc);
  } catch {
    return { ok: false, unknown: "unparseable" };
  }
}

/**
 * The count of an ALREADY-PARSED document, with the same reasons as above —
 * the one behaviour, shared by every reader that has a `PDFDocument` in hand
 * (the file probe parses once for pages, fields and its text sample, and must
 * not count pages a second way). Never throws.
 */
export function pageCountFromDoc(doc: {
  getPageCount(): number;
}): PageCountResult {
  let count: number;
  try {
    count = doc.getPageCount();
  } catch {
    return { ok: false, unknown: "unparseable" };
  }
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, unknown: "unparseable" };
  }
  // A document that parses and reports no pages is a FACT, not a failure to
  // measure. It is still not a number a comparison can use, so it is reported
  // as its own kind of unknown rather than as `0`.
  if (count === 0) return { ok: false, unknown: "zero-pages" };
  return { ok: true, count };
}

/**
 * Best-effort page count for a display hint: the number, or `null` when it
 * cannot be established for any reason.
 *
 * This is the progressive-enhancement shape the workspace file cards use. It is
 * deliberately lossy and deliberately a WRAPPER — the parse happens once, in
 * {@link countPdfPagesDetailed}, so a fix there reaches every caller. Do not use
 * this in a gate: collapsing the reasons is exactly what a gate must not do.
 */
export async function countPdfPages(
  bytes: Uint8Array,
  maxBytes: number = Number.POSITIVE_INFINITY,
): Promise<number | null> {
  const result = await countPdfPagesDetailed(bytes, maxBytes);
  return result.ok ? result.count : null;
}
