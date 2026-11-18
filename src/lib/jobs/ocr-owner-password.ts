/**
 * OCR PDF's owner password for a restricted PDF (competitor-audit backlog
 * #11, 2026-11-17): the option's name, and what `POST /api/jobs` says when
 * the running worker cannot use it.
 *
 * A leaf with no imports, so the job route reads it without the OCR
 * contract, and the OCR panel's first load (which carries `./ocr`) gains
 * nothing from it.
 *
 * Copy: walked by `copyFiles()` (listed singly; `src/lib/jobs` is not a
 * walked root).
 */

/** The job option that carries it. Sealed like every password field. */
export const OCR_OWNER_PASSWORD_OPTION = "ownerPassword";

/** Does this OCR job's options bag carry an owner password at all? */
export function carriesOcrOwnerPassword(
  options: Record<string, unknown> | undefined,
): boolean {
  return options?.[OCR_OWNER_PASSWORD_OPTION] !== undefined;
}

/**
 * Said when an OCR job carries an owner password but the running worker
 * does not prove it can use one (`ocrOwnerPassword` on its heartbeat): an
 * image built before the feature would drop the password and refuse the
 * file, so the job is refused here, before anything is queued.
 */
export const OCR_OWNER_PASSWORD_NOT_RUNNING_MESSAGE =
  "Our OCR server can't use an owner password right now, so this restricted PDF was not sent for OCR. Remove its restrictions with Unlock PDF and run OCR again, or try again later. Nothing was processed.";
