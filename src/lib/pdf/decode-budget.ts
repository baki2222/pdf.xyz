import { PdfEngineError } from "./engine-errors";

/**
 * pdf-lib's decode budget, as seen from our side.
 *
 * pdf-lib (patched: patches/pdf-lib@1.17.1.patch) refuses to grow ONE decoded
 * stream past a byte budget, and throws an error carrying
 * {@link DECODE_BUDGET_CODE}. That single check sits in `DecodeStream`, under
 * every decode pdf-lib does: object streams and xref streams at load, content
 * streams when a page is embedded (n-up, overlay), and every
 * `decodePDFRawStream` call in our own code. Without it a 1 MB file inflated to
 * 1 GiB in the user's tab, and a 3 KB one did the same through two Flate layers.
 *
 * The same budget also bounds each OPERATION in total, through a ledger every
 * stream of that operation charges: one load (all its object and xref
 * streams) and one embedded page (every entry of its /Contents array). A
 * per-stream cap alone let twenty object streams of 100 MiB each, or one
 * 200 MiB stream named four times in /Contents, add up to GiBs. Decodes our
 * own code makes after a load are separate operations, each under its own
 * per-stream budget.
 *
 * The patch also stops pdf-lib's xref-stream parser from looping on a /W width
 * or an entry count the stream's data cannot hold (a 451-byte file hung the
 * tab forever); that part needs nothing from this module.
 */

/** The `code` the patched pdf-lib puts on its budget error. */
export const DECODE_BUDGET_CODE = "PDF_DECODE_BUDGET";

/**
 * The budget when none is scoped, in bytes, for one decoded stream. The patch
 * carries the same number as its own default; a test reads it back out of
 * every patched build file and compares.
 *
 * Why 256 MiB: it is 4x under the smallest bomb in the hostile matrix (1 GiB),
 * and a refused bomb costs at most 1.5x it (the doubling buffer's old half and
 * new whole). Above it, nothing a real producer writes outside an image: the
 * largest stream in the legit corpus decodes to 1,045,278 bytes (257x under;
 * a test keeps it at least 100x), and a dense vector page is tens of MB.
 * Images do not use it: extract-images scopes a budget from each image's own
 * declared size, which may legitimately reach 300 MB (100 MP RGB).
 */
export const DEFAULT_DECODE_BUDGET_BYTES = 256 * 1024 * 1024;

/** Where the patched pdf-lib reads a scoped budget (shared by every build). */
const BUDGET_KEY = Symbol.for("pdf-lib.decodeBudget");

/** Whether `err` (or anything in its `cause` chain) is pdf-lib's budget error. */
export function isDecodeBudgetError(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 8; depth += 1) {
    if ((e as { code?: unknown }).code === DECODE_BUDGET_CODE) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Run `fn` (synchronous) with a different budget for every pdf-lib decode it
 * makes, then put the previous one back. Synchronous only, so no other decode
 * can interleave with the scope.
 */
export function withDecodeBudget<T>(bytes: number, fn: () => T): T {
  const scope = globalThis as unknown as Record<symbol, unknown>;
  const previous = scope[BUDGET_KEY];
  scope[BUDGET_KEY] = bytes;
  try {
    return fn();
  } finally {
    scope[BUDGET_KEY] = previous;
  }
}

/** The budget in the units the copy states (MB, as the rest of the site does). */
const BUDGET_MB = DEFAULT_DECODE_BUDGET_BYTES / (1024 * 1024);

/**
 * The refusal copy. `subject` names what holds the data ("This PDF", or
 * "Overlay page 2" where two files are in play).
 */
export function decodeBudgetMessage(subject = "This PDF"): string {
  return `${subject} holds compressed data that unpacks to more than ${BUDGET_MB} MB, which is too large to process safely in your browser.`;
}

/** The typed refusal for a file pdf-lib stopped decoding at the budget. */
export class PdfDecodeBudgetError extends PdfEngineError {
  constructor(subject?: string, options?: ErrorOptions) {
    super(decodeBudgetMessage(subject), options);
    this.name = "PdfDecodeBudgetError";
  }
}

/** `err` as the typed refusal when it is a budget error, else `undefined`. */
export function asDecodeBudgetRefusal(
  err: unknown,
  subject?: string,
): PdfDecodeBudgetError | undefined {
  if (err instanceof PdfDecodeBudgetError) return err;
  return isDecodeBudgetError(err)
    ? new PdfDecodeBudgetError(subject, { cause: err })
    : undefined;
}
