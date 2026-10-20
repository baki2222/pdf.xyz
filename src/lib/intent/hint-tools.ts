/**
 * Which tools give a preflight hint, and on what condition (redesign E.9) —
 * alone in its module so a runner can ask whether to probe a file without
 * loading the hint's words (`./hints`), which arrive with the probe.
 */
export type HintReason = "image-only" | "form-fields";

export const HINT_TOOLS: ReadonlyMap<string, HintReason> = new Map([
  ["pdf-to-text", "image-only"],
  ["pdf-to-markdown", "image-only"],
  ["compare-pdf", "image-only"],
  ["sign-pdf", "form-fields"],
  ["edit-pdf", "form-fields"],
  ["annotate-pdf", "form-fields"],
]);

/** What the probe must read for this tool's hint, or null for no hint. */
export function hintNeedFor(slug: string): HintReason | null {
  return HINT_TOOLS.get(slug) ?? null;
}
