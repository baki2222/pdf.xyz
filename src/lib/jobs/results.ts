/**
 * The client-facing **result metadata** a completed job may attach to its record.
 *
 * This is the safe, bounded seam Phase 26 threads from a processor's success all
 * the way onto the {@link import("./types").Job} record and out through the job
 * status API. It is the job-level home for the structural facts a tool observed
 * about what it produced — today only OCR — kept deliberately separate from the
 * per-download {@link import("./types").JobArtifact} (bytes + signed URL) so a job
 * can describe its output ("3 pages, English, a 1,240-character sidecar") without
 * the description ever becoming a second copy of the output or a leak vector.
 *
 * Honesty and privacy rules (enforced by {@link sanitizeJobResults}):
 *  - every field is a hard structural fact or a bounded COUNT — never recognized
 *    text, an input filename, an object key, a signed URL, a temp path, a binary
 *    path, an env value, or a scanner detail;
 *  - metadata is namespaced by tool family, so a job only ever carries the block
 *    for the work it actually did — a compression job never grows an `ocr` block;
 *  - the shape is schema-stable and is re-bounded at the persistence boundary, so
 *    a buggy or hostile runner can never write an unsafe value into a job record;
 *  - absent/empty is always acceptable and is normalized to *no* `results` field —
 *    metadata is never fabricated to fill a gap.
 */

import {
  buildOcrResultMeta,
  isOcrOutputMode,
  normalizeOcrEngineFamily,
  type OcrResultMeta,
} from "./ocr";

/**
 * Namespaced, content-free result metadata attached to a completed {@link Job}.
 * Each key is a tool family; a block is present ONLY when that tool ran and
 * produced the described output. Extend it alongside a processor that genuinely
 * reports safe metadata — never speculatively.
 */
export interface JobResults {
  /**
   * Safe OCR result metadata (engine family, validated languages, produced
   * artifact kinds, page/character counts). Present only on a completed OCR job.
   */
  ocr?: OcrResultMeta;
}

/** True when a {@link JobResults} carries at least one populated block. */
export function hasJobResults(results: JobResults | null | undefined): boolean {
  return !!results && Object.values(results).some((block) => block != null);
}

/**
 * Normalize untrusted {@link JobResults} into a bounded, client-safe value for
 * persistence — the single redaction boundary every write path funnels through.
 *
 * It re-runs each block through its canonical builder ({@link buildOcrResultMeta}
 * for OCR), which sanitizes the engine token, filters languages to the allowlist,
 * clamps counts to bounded non-negative integers, and keeps a confidence only when
 * it is a real number in range — so even a malformed or hostile block cannot carry
 * a path, key, secret, or recognized text onto a job record. A block with an
 * unrecognized output mode (a sign the value did not come from the real contract)
 * is dropped whole rather than coerced. Returns `undefined` when nothing safe and
 * populated survives, so an empty result is simply *no* `results` field — never a
 * misleading empty object.
 */
export function sanitizeJobResults(
  results: JobResults | null | undefined,
): JobResults | undefined {
  if (!results || typeof results !== "object") return undefined;

  const clean: JobResults = {};

  const ocr = results.ocr;
  // Only accept an OCR block that plausibly came from the real contract: a valid
  // output mode is the discriminant. Everything else is re-bounded by the builder,
  // and the engine is collapsed to the closed client-facing family set so it can
  // only ever read `ocrmypdf`, `tesseract`, or `unknown`.
  if (ocr && typeof ocr === "object" && isOcrOutputMode(ocr.outputMode)) {
    const built = buildOcrResultMeta(ocr);
    clean.ocr = { ...built, engine: normalizeOcrEngineFamily(built.engine) };
  }

  return hasJobResults(clean) ? clean : undefined;
}
