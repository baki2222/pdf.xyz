/**
 * The documents the production proofs of the AI tools upload, as text — one
 * definition the fixtures draw (`@/tests/ai-proof-fixtures`) and the proofs
 * read back.
 *
 * ── THE MEMO (summarize-pdf, translate-pdf) ─────────────────────────────────
 *
 * Until 2026-10-09 both proofs uploaded the harness's three-line `textPdf`
 * ("pdf.xyz deployment proof …"). Nothing in it is distinctive, and it has no
 * page without text, so the proof could not tell the declared text pages from
 * the page count (`./ai-proof-declaration`): both were 1.
 *
 * So the memo is a short, ordinary document about something specific, with
 * names no other document carries, followed by a BLANK page. The names are in
 * it so a correct summary or translation has something it must carry; the
 * blank page is there so a declaration of the page count instead of the pages
 * WITH TEXT is a different number.
 */

/** The memo's heading, drawn above its sentences. */
export const PROOF_MEMO_TITLE = "Kestrel Bridge inspection memo";

/**
 * The memo, one sentence per drawn line. Each is short enough to fit the
 * page's width on one line, so an extractor returns it whole.
 */
export const PROOF_MEMO_SENTENCES: readonly string[] = [
  "The Kestrel Bridge carries the coast road over the Varrow River.",
  "Engineer Ingrid Halvorsen inspected the bridge on 14 March.",
  "She found corrosion on four of the twelve steel cables that hold the main span.",
  "Two of those cables have lost more than a tenth of their strength.",
  "The repair will replace all four cables and will take nine weeks.",
  "It is expected to cost 2,480,000 euros, paid from the regional roads fund.",
  "Trucks over seven tonnes may not cross the bridge while the work goes on.",
  "Cars and bicycles may still cross, but only in one lane at a time.",
  "A ferry from Ostby harbour will carry trucks across the river instead.",
  "The city council must approve the budget before the end of April.",
  "If the work is delayed past June, the bridge will close to all traffic.",
  "Halvorsen also recommends replacing the other eight cables within five years.",
  "The next full inspection of the Kestrel Bridge is due in two years.",
];

/** Pages the memo PDF has: the memo, then one blank page. */
export const PROOF_MEMO_PAGES = 2;
