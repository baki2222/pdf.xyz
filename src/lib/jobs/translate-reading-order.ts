/**
 * Translate's reading-order bound, as a LEAF: no imports at all, so the
 * browser's wait budget (`./client-wait`) and the worker's flow extractor
 * (`@/lib/workers/translate/native`, `translateFlowConfig`) read one number.
 *
 * {@link TRANSLATE_FLOW_TIMEOUT_MS} — CHOSEN 2026-11-16 (slice 3 of
 * competitor-audit backlog #29), not measured: the deadline of Translate's
 * SECOND `pdftotext` run (`-bbox-layout`, whose flow text is sent in place of
 * the `-layout` text; `@/lib/workers/translate/reading-order`). The worker
 * passes `min(pdfText.timeoutMs, this)`, so the run may be given less, never
 * more. A run that does not finish in time is not a failed job: the document
 * is sent as `-layout`, exactly as before (`readingOrder.source:
 * "bbox_failed"`).
 *
 * It is added to the browser's wait rather than hidden inside
 * `PIPELINE_MARGIN_MS`: that margin (60 s) is already smaller than the FIRST
 * extraction's own 120 s timeout, and the allowance is charged when the job is
 * created, so a second unbounded run could make the panel abandon a job the
 * user has already paid for. `client-wait.test.ts` holds the wait and the
 * worker's deadline together.
 */

export const TRANSLATE_FLOW_TIMEOUT_MS = 30_000;
