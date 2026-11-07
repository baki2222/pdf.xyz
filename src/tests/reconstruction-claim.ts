/**
 * The CLAIM's shape, not one wording of it: "<verb> what <was|had to be>
 * <reconstructed|fixed>". The first fix pinned only "names what was
 * reconstructed" and left two synonyms served — the tool page's How it
 * works step ("says what was reconstructed") and the guide's meta
 * description ("see what had to be fixed"). Every alternative below is
 * exercised by a sentence the product shipped (the controls), and every
 * shipped sentence is caught (CLAUDE.md rule 1, both directions) —
 * stale-claims-audit-41.test.ts holds both. Read by that test (the guide and
 * the tool page) and by pdf-structure-worker-panel.test.tsx (the notice).
 */
export const RECONSTRUCTION_CLAIM =
  /\b(says|names|see|is) what (was|had to be) (reconstructed|fixed)\b/i;
export const SHIPPED_RECONSTRUCTION_CLAIMS = [
  // catalog-how.ts, repair-pdf step 3, until 2026-11-06
  "If the file had to be rebuilt, a list above the download says what was reconstructed.",
  // guides/catalog.ts, the repair guide's description, until 2026-11-06
  "Rebuild a damaged PDF with qpdf on a secure server that deletes the input when the job finishes, and see what had to be fixed. No account needed.",
  // tool-facts.ts REPAIR_WARNINGS_ANSWER, until 2026-11-06
  "names what had to be reconstructed",
  // the repair guide's step, until 2026-11-06
  "names what was reconstructed",
  // repair-warnings.tsx, the notice body, until 2026-11-06
  "The repair succeeded; what follows is what had to be reconstructed.",
];
