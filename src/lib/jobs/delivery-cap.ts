/**
 * What a job may DELIVER — decided by the server at submit time, carried to the
 * worker, and enforced where the work is produced.
 *
 * ── WHY A CAP EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * The free daily allowance is reserved in characters against a count the CLIENT
 * supplies (`declaredCharacters`). A claim is not a measurement: a browser can
 * send `1` and a twelve-page document. Without a cap the reservation is
 * decorative — worse than absent, because it looks enforced. **The rule this
 * type exists to make true is "a job delivers what it reserved, and no more."**
 *
 * ── WHY TWO BOUNDS AND NOT ONE ───────────────────────────────────────────────
 *
 * Each is blind in the dimension the other measures, and they fail for
 * different reasons:
 *
 *  - `characters` is the bound tied to money. It is what makes under-declaring
 *    unprofitable — declare one character and you are delivered one character's
 *    worth. It is also INEXACT, because the browser and the worker count
 *    differently (see `TRANSLATE_EXTRACTOR_HEADROOM`), so it rests on a chosen
 *    constant.
 *  - `pages` is EXACT. Both extractors read the same page tree and agree on
 *    which pages carry text — measured, including the invisible OCR text layers
 *    `ocr-pdf` produces — so for an honest caller this bound never binds. When
 *    it does bind, the document is not the document that was declared.
 *
 * **The second bound is what can see the first one being wrong.** The headroom
 * multiplier is a constant, and this codebase's rule about constants is that
 * they have no relationships to constrain them — nothing structural can tell
 * you a number is too small. A cut is therefore reported WITH the bound that
 * made it: a job that stops on `characters` while pages remain is the shape of
 * a headroom that does not cover some real geometry, and it is visible in the
 * artifact instead of arriving as a shorter translation nobody questions.
 *
 * ── IT IS SERVER-DERIVED, WHICH IS WHY IT IS NOT ON `CreateJobRequest` ───────
 *
 * The cap is computed by the route from what the caller declared, and it rides
 * beside the request rather than inside it. Putting it on the request type
 * would say, in the contract, that a caller may set its own cap — and a type
 * that permits the exploit is how the exploit eventually gets written.
 */

/** Which bound stopped a delivery. */
export type DeliveryBound = "characters" | "pages";

export interface JobDeliveryCap {
  /**
   * Total WORKER-EXTRACTED characters this job may translate.
   *
   * The unit is named because the two extractors disagree and this file's whole
   * subject is a claim measured in one unit bounding work measured in another.
   * It already carries the extractor headroom — it is `declared × h`, not
   * `declared`.
   */
  readonly characters: number;
  /**
   * Total pages WITH TEXT this job may translate, when the caller declared a
   * count.
   *
   * Pages with no text are dropped before chunking (`pageTextChunks`), so a
   * bound denominated in "pages" and a bound denominated in "pages that carry
   * text" are different numbers for any document with a blank, a whitespace-only
   * or an image-only page. This is the latter, and the client must declare the
   * latter — measured 2026-08-21 to agree exactly across both extractors on
   * blank, whitespace-only, image-only and invisible-OCR-layer pages.
   *
   * Absent when the caller could not count (a direct API caller has bytes, not
   * extracted text). Absent means unbounded in this dimension, never zero.
   */
  readonly pages?: number;
}

/**
 * Read a cap that has round-tripped through the queue's JSON.
 *
 * FAIL-CLOSED, and deliberately: a malformed cap must not read as "no cap".
 * Absent is a supported state that means unbounded; present-and-nonsense is a
 * bug on our own write path, and the convenient reading of a bug — deliver
 * everything — is exactly the outcome the cap exists to prevent. A guard that
 * can license the defect it guards against is worse than no guard.
 */
export function readDeliveryCap(
  value: unknown,
): { ok: true; cap: JobDeliveryCap | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, cap: null };
  if (typeof value !== "object") {
    return { ok: false, reason: "the delivery cap is not an object" };
  }
  const raw = value as { characters?: unknown; pages?: unknown };
  if (
    typeof raw.characters !== "number" ||
    !Number.isFinite(raw.characters) ||
    raw.characters <= 0
  ) {
    return {
      ok: false,
      reason: "the delivery cap has no positive character bound",
    };
  }
  if (raw.pages !== undefined) {
    if (
      typeof raw.pages !== "number" ||
      !Number.isInteger(raw.pages) ||
      raw.pages <= 0
    ) {
      return {
        ok: false,
        reason:
          "the delivery cap has a page bound that is not a positive whole number",
      };
    }
  }
  return {
    ok: true,
    cap: {
      characters: raw.characters,
      ...(raw.pages !== undefined ? { pages: raw.pages } : {}),
    },
  };
}
