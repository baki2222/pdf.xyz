/**
 * Translate PDF's reflowed-PDF bounds, as a LEAF: no imports at all, so the
 * browser's wait budget (`./client-wait`) and the worker's renderer
 * (`@/lib/workers/translate/pdf-render`) read one number each.
 *
 * Measured/decided 2026-11-15 (slice 1 of competitor-audit backlog #29):
 *
 * - {@link TRANSLATE_PDF_RENDER_TIMEOUT_MS}: the render runs AFTER the paid
 *   provider calls, so its bound is added to the browser's wait rather than
 *   hidden inside `PIPELINE_MARGIN_MS` (60 s, which is smaller than HTML to
 *   PDF's own 120 s Chromium budget — a panel waiting on the margin alone
 *   would abandon a paid job mid-render). The worker passes
 *   `min(html.timeoutMs, this)` to Chromium (`translatePdfRenderConfig`).
 *   MEASURED 2026-11-15 (development machine: Windows 11, Playwright's
 *   chrome-headless-shell 1234, Windows system fonts; three runs of
 *   `pdf-capability.chromium.test.ts` suite 1): a synthetic three-chunk
 *   translation of ~30,900 characters (3 × the 10,258 per-call ceiling) in
 *   en/bn/ja/ar/th printed and was read back in p50 676 ms, max 757 ms —
 *   about 1/80 of this bound. The worker-image figure is measured in the
 *   image (`pnpm worker:translate-pdf-proof`), not here.
 * - {@link TRANSLATE_PDF_MAX_OUTPUT_BYTES}: the same measurement produced
 *   81 KB (en, 13 pages) to 143 KB (ja, 24 pages) with subset fonts — about
 *   1/145 of this bound. 20 MB is a bound against a runaway, not a budget a
 *   real translation approaches.
 * - {@link TRANSLATE_RTL_LANGUAGES}: the targets the document is laid out
 *   right-to-left for. Arabic is the only RTL language Translate offers.
 */

export const TRANSLATE_PDF_RENDER_TIMEOUT_MS = 60_000;

export const TRANSLATE_PDF_MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export const TRANSLATE_RTL_LANGUAGES = ["ar"] as const;

/**
 * Why a successful translation came WITHOUT its reflowed PDF — the closed
 * vocabulary the worker writes (`meta.pdf.reason`), the job record re-bounds
 * (`@/lib/jobs/ai-results`) and the panel reads. One list, three readers.
 */
export const TRANSLATE_PDF_REASONS = [
  "no_renderer",
  "unproven_language",
  "render_failed",
  "timeout",
  "too_large",
  "not_conserved",
] as const;

export type TranslatePdfReason = (typeof TRANSLATE_PDF_REASONS)[number];
